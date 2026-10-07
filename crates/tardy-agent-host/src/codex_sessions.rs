//! Shared-daemon discovery. No history-file scraping and no implicit daemon start.
use crate::BoxError;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::time::Duration;
use tokio::net::UnixStream;
use tokio_tungstenite::{WebSocketStream, tungstenite::Message};

async fn connect_socket() -> Result<WebSocketStream<UnixStream>, BoxError> {
    let path = if let Some(path) = std::env::var_os("TARDY_CODEX_SOCKET") {
        std::path::PathBuf::from(path)
    } else {
        let home = std::env::var_os("CODEX_HOME")
            .map(std::path::PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME").map(|home| std::path::PathBuf::from(home).join(".codex"))
            })
            .ok_or("Codex home unavailable; set TARDY_CODEX_SOCKET")?;
        home.join("app-server-control/app-server-control.sock")
    };
    tokio::time::timeout(Duration::from_secs(10), async {
        let unix = UnixStream::connect(&path).await?;
        let (socket, _) = tokio_tungstenite::client_async("ws://localhost/", unix).await?;
        Ok::<_, BoxError>(socket)
    })
    .await
    .map_err(|_| "Codex socket handshake timed out")?
}

pub(crate) struct RelayGuard(tokio::task::JoinHandle<()>);
impl Drop for RelayGuard {
    fn drop(&mut self) {
        self.0.abort();
    }
}

/// Keep the existing JSONL event parser transport-independent. The shared server
/// speaks WebSocket over Unix; host-owned processes continue to speak stdio JSONL.
pub(crate) async fn jsonl_socket() -> Result<(tokio::io::DuplexStream, RelayGuard), BoxError> {
    let socket = connect_socket().await?;
    Ok(relay_socket(socket))
}

fn relay_socket(socket: WebSocketStream<UnixStream>) -> (tokio::io::DuplexStream, RelayGuard) {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    let (mut sink, mut stream) = socket.split();
    let (host, relay) = tokio::io::duplex(64 * 1024);
    let (read, mut write) = tokio::io::split(relay);
    let task = tokio::spawn(async move {
        let outgoing = async {
            let mut lines = BufReader::new(read).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if sink.send(Message::Text(line.into())).await.is_err() {
                    break;
                }
            }
        };
        let incoming = async {
            while let Some(Ok(frame)) = stream.next().await {
                if let Message::Text(text) = frame {
                    if write.write_all(text.as_bytes()).await.is_err()
                        || write.write_all(b"\n").await.is_err()
                    {
                        break;
                    }
                }
            }
        };
        tokio::select! { _ = outgoing => {}, _ = incoming => {} }
    });
    (host, RelayGuard(task))
}

struct Connection {
    socket: WebSocketStream<UnixStream>,
    next_id: u64,
}

impl Connection {
    async fn connect() -> Result<Self, BoxError> {
        let mut connection = Self {
            socket: connect_socket().await?,
            next_id: 0,
        };
        connection.call("initialize", json!({"clientInfo":{"name":"tardy_session_discovery","version":env!("CARGO_PKG_VERSION")}})).await?;
        connection
            .socket
            .send(Message::Text(
                json!({"method":"initialized"}).to_string().into(),
            ))
            .await?;
        Ok(connection)
    }

    async fn call(&mut self, method: &str, params: Value) -> Result<Value, BoxError> {
        let id = self.next_id;
        self.next_id += 1;
        self.socket
            .send(Message::Text(
                json!({"id":id,"method":method,"params":params})
                    .to_string()
                    .into(),
            ))
            .await?;
        tokio::time::timeout(Duration::from_secs(15), async {
            loop {
                let frame = self
                    .socket
                    .next()
                    .await
                    .ok_or("shared Codex daemon disconnected")??;
                let Message::Text(text) = frame else {
                    continue;
                };
                let message: Value = serde_json::from_str(&text)?;
                if message.get("id").and_then(Value::as_u64) != Some(id) {
                    continue;
                }
                if let Some(error) = message.get("error") {
                    return Err(format!("Codex {method}: {error}").into());
                }
                return message
                    .get("result")
                    .cloned()
                    .ok_or_else(|| "Codex response omitted result".into());
            }
        })
        .await
        .map_err(|_| "Codex control request timed out")?
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CodexSession {
    pub id: String,
    pub title: String,
}

pub async fn discover() -> Result<Vec<CodexSession>, BoxError> {
    let mut connection = Connection::connect().await?;
    let mut ids = std::collections::BTreeSet::new();
    let mut cursor = Value::Null;
    loop {
        let result = connection
            .call("thread/loaded/list", json!({"limit":100,"cursor":cursor}))
            .await?;
        let data = result
            .get("data")
            .and_then(Value::as_array)
            .ok_or("Codex loaded list omitted data")?;
        ids.extend(data.iter().filter_map(Value::as_str).map(str::to_owned));
        cursor = result.get("nextCursor").cloned().unwrap_or(Value::Null);
        if cursor.is_null() {
            break;
        }
    }
    let mut sessions = Vec::new();
    for id in ids {
        let result = connection
            .call("thread/read", json!({"threadId":id,"includeTurns":false}))
            .await?;
        if let Some(session) = result.get("thread").and_then(session_metadata) {
            sessions.push(session);
        }
    }
    Ok(sessions)
}

pub async fn interrupt(thread: &str) -> Result<(), BoxError> {
    let mut connection = Connection::connect().await?;
    let result = connection
        .call("thread/resume", json!({"threadId":thread}))
        .await?;
    if let Some(turn) = active_turn(&result) {
        connection
            .call("turn/interrupt", json!({"threadId":thread,"turnId":turn}))
            .await?;
    }
    Ok(())
}

pub(crate) fn active_turn(result: &Value) -> Option<String> {
    result
        .pointer("/thread/turns")
        .and_then(Value::as_array)
        .and_then(|turns| {
            turns
                .iter()
                .rev()
                .find(|turn| turn.get("status").and_then(Value::as_str) == Some("inProgress"))
        })
        .and_then(|turn| turn.get("id"))
        .and_then(Value::as_str)
        .map(str::to_owned)
}

fn session_metadata(value: &Value) -> Option<CodexSession> {
    if let Some(source) = value.get("source") {
        if source.is_object()
            || source
                .as_str()
                .is_some_and(|kind| !matches!(kind, "cli" | "vscode" | "appServer"))
        {
            return None;
        }
    }
    let id = value.get("id")?.as_str()?;
    if id.is_empty() || id.len() > 120 {
        return None;
    }
    let fallback = format!("Codex · {}", id.chars().take(8).collect::<String>());
    let title = value
        .get("name")
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(&fallback);
    let project = value
        .get("cwd")
        .and_then(Value::as_str)
        .and_then(|cwd| std::path::Path::new(cwd).file_name())
        .and_then(|name| name.to_str());
    let title = match project {
        Some(project) => format!("{project} · {title}"),
        None => title.to_owned(),
    };
    let title = if id.len() > 8 {
        format!(
            "{} · {}",
            title.chars().take(90).collect::<String>(),
            id.chars()
                .rev()
                .take(6)
                .collect::<String>()
                .chars()
                .rev()
                .collect::<String>()
        )
    } else {
        title
    };
    Some(CodexSession {
        id: id.into(),
        title: title.chars().take(100).collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn unix_websocket_is_bridged_as_json_lines() {
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
        let (client, server) = UnixStream::pair().unwrap();
        let remote = tokio::spawn(async move {
            let mut socket = tokio_tungstenite::accept_async(server).await.unwrap();
            let frame = socket.next().await.unwrap().unwrap();
            assert_eq!(frame.into_text().unwrap(), "{\"id\":7}");
            socket
                .send(Message::Text("{\"id\":7,\"result\":{}}".into()))
                .await
                .unwrap();
        });
        let (socket, _) = tokio_tungstenite::client_async("ws://localhost/", client)
            .await
            .unwrap();
        let (mut host, _guard) = relay_socket(socket);
        host.write_all(b"{\"id\":7}\n").await.unwrap();
        let response = tokio::time::timeout(
            Duration::from_secs(3),
            BufReader::new(host).lines().next_line(),
        )
        .await
        .unwrap()
        .unwrap()
        .unwrap();
        assert_eq!(response, "{\"id\":7,\"result\":{}}");
        remote.await.unwrap();
    }
    #[test]
    fn metadata_does_not_publish_preview_or_history() {
        let session = session_metadata(
            &json!({"id":"one","name":"Project","preview":"SECRET","turns":["SECRET"]}),
        )
        .unwrap();
        assert_eq!(
            serde_json::to_value(session).unwrap(),
            json!({"id":"one","title":"Project"})
        );
        assert!(session_metadata(&json!({"id":""})).is_none());
    }
    #[test]
    fn only_in_progress_turns_can_be_controlled() {
        assert_eq!(active_turn(&json!({"thread":{"turns":[{"id":"old","status":"completed"},{"id":"live","status":"inProgress"}]}})).as_deref(), Some("live"));
        assert!(active_turn(&json!({"thread":{"turns":[]}})).is_none());
    }
    #[test]
    fn interactive_threads_have_distinct_project_titles_without_private_paths() {
        let session = session_metadata(&json!({"id":"thread-123456","source":"cli","cwd":"/private/customer/work/project","name":"Continue"})).unwrap();
        assert_eq!(session.title, "project · Continue · 123456");
        assert!(session_metadata(&json!({"id":"subagent","source":{"subAgent":{}}})).is_none());
        assert!(session_metadata(&json!({"id":"batch","source":"exec"})).is_none());
    }
}
