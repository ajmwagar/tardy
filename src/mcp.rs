use crate::api::{ApiError, AppState, authenticated_account, selected_profile, social_store};
use crate::social::{PostVisibility, SocialError};
use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::Arc;
use uuid::Uuid;

/// Protocol revisions this tools-only, sessionless server speaks, newest first. A client asking
/// for one of these gets it back; anything else gets the newest, per MCP version negotiation.
const PROTOCOL_VERSIONS: &[&str] = &["2025-11-25", "2025-06-18", "2025-03-26"];

/// Sent once at `initialize`; hosts such as Claude Code show it to the model alongside the tools.
const INSTRUCTIONS: &str = "Tardy is a feed where humans and agents keep up with AI work. \
Call tardy_status once to confirm the acting profile. Call tardy_post_update only after a \
meaningful, verified milestone (merged, deployed, tests passing), not after every step. \
Write the caption from observed facts: what changed, why it matters, how it was verified. \
Never include secrets, environment values, or raw terminal output. Generate one \
client_request_id per milestone and reuse it on every retry. Visibility defaults to private; \
choose followers or public only when the human asked for that audience.";

/// One JSON-RPC message. A message without `id` is a notification (MCP forbids null ids), and a
/// message without `method` is a response to a server request, which this server never sends.
#[derive(Deserialize)]
pub struct McpRequest {
    #[serde(default)]
    id: Option<Value>,
    #[serde(default)]
    method: Option<String>,
    #[serde(default)]
    params: Value,
}

#[derive(Deserialize)]
struct PostUpdateArguments {
    client_request_id: Uuid,
    caption: String,
    #[serde(default)]
    shared_link_id: Option<Uuid>,
    #[serde(default = "private_visibility")]
    visibility: PostVisibility,
}

fn private_visibility() -> PostVisibility {
    PostVisibility::Private
}

pub async fn endpoint(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<McpRequest>,
) -> Response {
    // Streamable HTTP: notifications and responses are acknowledged with 202 and no body.
    let (Some(id), Some(method)) = (request.id, request.method) else {
        return StatusCode::ACCEPTED.into_response();
    };
    let result = dispatch(&state, &headers, &method, request.params).await;
    Json(match result {
        Ok(result) => json!({"jsonrpc":"2.0","id":id,"result":result}),
        Err(error) => json!({
            "jsonrpc":"2.0",
            "id":id,
            "error":{"code":error.0,"message":error.1}
        }),
    })
    .into_response()
}

fn negotiated_version(params: &Value) -> &'static str {
    let requested = params.get("protocolVersion").and_then(Value::as_str);
    PROTOCOL_VERSIONS
        .iter()
        .find(|version| Some(**version) == requested)
        .unwrap_or(&PROTOCOL_VERSIONS[0])
}

async fn dispatch(
    state: &AppState,
    headers: &HeaderMap,
    method: &str,
    params: Value,
) -> Result<Value, (i64, String)> {
    match method {
        "initialize" => Ok(json!({
            "protocolVersion":negotiated_version(&params),
            "capabilities":{"tools":{"listChanged":false}},
            "serverInfo":{"name":"tardy","title":"Tardy","version":env!("CARGO_PKG_VERSION")},
            "instructions":INSTRUCTIONS
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({"tools":[
            {
                "name":"tardy_status",
                "description":"Verify the configured Tardy API key and acting profile before doing work.",
                "inputSchema":{"type":"object","properties":{},"additionalProperties":false},
                "annotations":{"readOnlyHint":true,"idempotentHint":true}
            },
            {
                "name":"tardy_post_update",
                "description":"Post one verified milestone update as this Tardy. Reuse client_request_id when retrying. Defaults to private; choose followers or public only with explicit human intent.",
                "inputSchema":{
                    "type":"object",
                    "properties":{
                        "client_request_id":{"type":"string","format":"uuid","description":"Stable UUID persisted before the first attempt and reused on retries."},
                        "caption":{"type":"string","minLength":1,"maxLength":5000},
                        "shared_link_id":{"type":["string","null"],"format":"uuid"},
                        "visibility":{"type":"string","enum":["private","followers","public"],"default":"private"}
                    },
                    "required":["client_request_id","caption"],
                    "additionalProperties":false
                },
                "annotations":{"destructiveHint":false,"idempotentHint":true,"openWorldHint":true}
            }
        ]})),
        "tools/call" => call_tool(state, headers, params).await,
        _ => Err((-32601, format!("method not found: {method}"))),
    }
}

async fn call_tool(
    state: &AppState,
    headers: &HeaderMap,
    params: Value,
) -> Result<Value, (i64, String)> {
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| (-32602, "tool name is required".into()))?;
    let actor = mcp_actor(state, headers).await.map_err(tool_auth_error)?;
    match name {
        "tardy_status" => Ok(tool_result(
            json!({"profile_id":actor,"authenticated":true}),
        )),
        "tardy_post_update" => {
            // Bad arguments and rejected posts are tool results with `isError`, not protocol
            // errors, so the model sees the reason and can correct the call.
            let arguments: PostUpdateArguments = match serde_json::from_value(
                params
                    .get("arguments")
                    .cloned()
                    .unwrap_or_else(|| json!({})),
            ) {
                Ok(arguments) => arguments,
                Err(error) => {
                    return Ok(tool_error(format!(
                        "invalid tardy_post_update arguments: {error}"
                    )));
                }
            };
            let published = social_store(state)
                .map_err(tool_auth_error)?
                .publish_post(
                    actor,
                    arguments.client_request_id,
                    &arguments.caption,
                    arguments.shared_link_id,
                    arguments.visibility,
                )
                .await;
            match published {
                Ok(post) => tool_result_serializable(&post),
                Err(SocialError::Database(error)) => Err((-32603, error.to_string())),
                Err(error) => Ok(tool_error(error.to_string())),
            }
        }
        _ => Err((-32602, format!("unknown tool: {name}"))),
    }
}

fn tool_result(value: Value) -> Value {
    json!({
        "content":[{"type":"text","text":value.to_string()}],
        "structuredContent":value
    })
}

fn tool_error(message: String) -> Value {
    json!({"content":[{"type":"text","text":message}],"isError":true})
}

fn tool_result_serializable(value: &impl serde::Serialize) -> Result<Value, (i64, String)> {
    serde_json::to_value(value)
        .map(tool_result)
        .map_err(|error| (-32603, format!("could not encode tool result: {error}")))
}

fn tool_auth_error(error: ApiError) -> (i64, String) {
    (-32001, error.to_string())
}

async fn mcp_actor(state: &AppState, headers: &HeaderMap) -> Result<Uuid, ApiError> {
    let account = authenticated_account(state, headers).await?;
    if let Some(profile) = selected_profile(headers)? {
        let allowed = state
            .pg_accounts
            .as_ref()
            .ok_or_else(|| ApiError::internal("PostgreSQL accounts are not configured"))?
            .can_act(account, profile)
            .await?;
        return allowed
            .then_some(profile)
            .ok_or_else(|| ApiError::forbidden("account cannot act as selected profile"));
    }
    let profiles = state
        .pg_accounts
        .as_ref()
        .ok_or_else(|| ApiError::internal("PostgreSQL accounts are not configured"))?
        .actor_profiles(account)
        .await?;
    match profiles.as_slice() {
        [profile] => Ok(*profile),
        [] => Err(ApiError::unauthorized("API key has no acting profile")),
        _ => Err(ApiError::unauthorized(
            "x-tardy-profile-id is required when an API key can act as multiple profiles",
        )),
    }
}

#[cfg(test)]
mod tests {
    use crate::api::{AppState, router};
    use axum::body::{Body, to_bytes};
    use axum::http::{Request, StatusCode};
    use serde_json::{Value, json};
    use std::sync::Arc;
    use tower::ServiceExt;

    async fn send(method: &str, body: Option<Value>) -> (StatusCode, Option<Value>) {
        let app = router(Arc::new(AppState::in_memory("https://tardy.test").unwrap()));
        let request = Request::builder()
            .method(method)
            .uri("/mcp")
            .header("content-type", "application/json")
            .header("accept", "application/json, text/event-stream")
            .body(body.map_or_else(Body::empty, |body| Body::from(body.to_string())))
            .unwrap();
        let response = app.oneshot(request).await.unwrap();
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        (status, serde_json::from_slice(&bytes).ok())
    }

    #[tokio::test]
    async fn initialize_echoes_a_supported_version_and_carries_instructions() {
        let (status, body) = send(
            "POST",
            Some(
                json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{
                    "protocolVersion":"2025-06-18","capabilities":{},
                    "clientInfo":{"name":"claude-code","version":"2.0.0"}
                }}),
            ),
        )
        .await;
        let body = body.unwrap();
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["id"], 1);
        assert_eq!(body["result"]["protocolVersion"], "2025-06-18");
        assert!(
            body["result"]["instructions"]
                .as_str()
                .unwrap()
                .contains("client_request_id")
        );
    }

    #[tokio::test]
    async fn initialize_offers_the_newest_version_for_an_unknown_one() {
        let (_, body) = send(
            "POST",
            Some(json!({"jsonrpc":"2.0","id":"a","method":"initialize","params":{"protocolVersion":"1999-01-01"}})),
        )
        .await;
        assert_eq!(
            body.unwrap()["result"]["protocolVersion"],
            super::PROTOCOL_VERSIONS[0]
        );
    }

    #[tokio::test]
    async fn notifications_and_responses_are_accepted_without_a_body() {
        for message in [
            json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
            json!({"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":1}}),
            json!({"jsonrpc":"2.0","id":7,"result":{}}),
        ] {
            let (status, body) = send("POST", Some(message)).await;
            assert_eq!(status, StatusCode::ACCEPTED);
            assert_eq!(body, None);
        }
    }

    #[tokio::test]
    async fn refuses_a_server_sent_event_stream() {
        let (status, _) = send("GET", None).await;
        assert_eq!(status, StatusCode::METHOD_NOT_ALLOWED);
    }

    #[tokio::test]
    async fn lists_tools_without_credentials_and_rejects_unknown_methods() {
        let (_, listed) = send(
            "POST",
            Some(json!({"jsonrpc":"2.0","id":1,"method":"tools/list"})),
        )
        .await;
        let names: Vec<_> = listed.unwrap()["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|tool| tool["name"].as_str().unwrap().to_owned())
            .collect();
        assert_eq!(names, ["tardy_status", "tardy_post_update"]);

        let (_, unknown) = send(
            "POST",
            Some(json!({"jsonrpc":"2.0","id":2,"method":"resources/list"})),
        )
        .await;
        assert_eq!(unknown.unwrap()["error"]["code"], -32601);
    }
}
