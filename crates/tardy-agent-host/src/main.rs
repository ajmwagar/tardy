use axum::{
    Json, Router,
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::{get, post},
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tardy_agent_host::{
    AgentCommand, AgentCredential, BoxError, CodexRunner, ConversationMessage, HostData,
    InboxEvent, PendingReply, QueuedEvent, TapbackDecider, WorkActivation, activation_prompt,
    dispatchable_deliveries, load_json, store_json, verify_signature,
};
use tokio::sync::{Mutex, Notify};

#[derive(Clone)]
struct App {
    credential: AgentCredential,
    data: Arc<Mutex<HostData>>,
    data_path: PathBuf,
    client: reqwest::Client,
    runner: Arc<CodexRunner>,
    notify: Arc<Notify>,
    tapbacks: Option<Arc<TapbackDecider>>,
}

struct ActiveWork {
    queued: QueuedEvent,
    abort: tokio::task::AbortHandle,
}

#[tokio::main]
async fn main() -> Result<(), BoxError> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    let command = std::env::args().nth(1).unwrap_or_else(|| "run".into());
    if matches!(command.as_str(), "help" | "--help" | "-h") {
        print_help();
        return Ok(());
    }
    if command == "doctor" {
        return doctor().await;
    }
    if command != "run" {
        return Err(format!("unknown command {command}; expected run, doctor, or help").into());
    }
    let credential_path = expand_path(&env_or("TARDY_STATE_PATH", "~/.config/tardy/agent.json"));
    let data_path = expand_path(&env_or(
        "TARDY_AGENT_HOST_STATE",
        "~/.local/state/tardy-agent-host/state.json",
    ));
    let workspace = std::fs::canonicalize(env_or("TARDY_AGENT_WORKSPACE", "."))?;
    let credential: AgentCredential =
        serde_json::from_slice(&tokio::fs::read(&credential_path).await?)?;
    if credential.subscription_id.is_none() {
        return Err("Tardy inbox is not configured; run `tardy subscribe --mode poll` or configure a webhook".into());
    }
    let data_exists = tokio::fs::try_exists(&data_path).await?;
    let mut data = load_json::<HostData>(&data_path).await?;
    if !data_exists {
        // The CLI owns inbox consumption until the host is installed. Start at its durable
        // cursor so adopting an existing identity cannot replay already handled work.
        data.cursor = credential.cursor;
        store_json(&data_path, &data).await?;
    }
    let runner = CodexRunner::new(
        workspace,
        env_or("TARDY_CODEX_SANDBOX", "workspace-write"),
        data_path.parent().unwrap_or(Path::new(".")).join("runs"),
    );
    let app = App {
        credential,
        data: Arc::new(Mutex::new(data)),
        data_path,
        client: reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()?,
        runner: Arc::new(runner),
        notify: Arc::new(Notify::new()),
        tapbacks: if std::env::var("TARDY_TAPBACK_RLCD").as_deref() == Ok("yes") {
            Some(Arc::new(TapbackDecider::from_env()?))
        } else {
            None
        },
    };
    let worker = tokio::spawn(work_loop(app.clone()));
    let mode = env_or("TARDY_AGENT_DELIVERY", "poll");
    if mode == "webhook" {
        serve_webhook(app.clone()).await?;
    } else if mode == "poll" {
        poll_loop(app.clone()).await?;
    } else {
        return Err("TARDY_AGENT_DELIVERY must be poll or webhook".into());
    }
    worker.abort();
    Ok(())
}

async fn doctor() -> Result<(), BoxError> {
    let credential_path = expand_path(&env_or("TARDY_STATE_PATH", "~/.config/tardy/agent.json"));
    let credential: AgentCredential =
        serde_json::from_slice(&tokio::fs::read(&credential_path).await?)?;
    let subscription = credential
        .subscription_id
        .as_deref()
        .ok_or("Tardy inbox is missing; run `tardy subscribe --mode poll`")?;
    let codex = tokio::process::Command::new("codex")
        .arg("--version")
        .output()
        .await?;
    if !codex.status.success() {
        return Err("Codex CLI is installed but unhealthy".into());
    }
    let workspace = std::fs::canonicalize(env_or("TARDY_AGENT_WORKSPACE", "."))?;
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()?
        .get(format!(
            "{}/v1/feed-subscriptions/{subscription}/events",
            credential.api.trim_end_matches('/')
        ))
        .query(&[("after", credential.cursor), ("limit", 1_i64)])
        .bearer_auth(&credential.api_token)
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(format!("Tardy inbox is unhealthy: HTTP {}", response.status()).into());
    }
    println!(
        "@{} is ready; subscription={}, workspace={}, {}",
        credential.handle,
        subscription,
        workspace.display(),
        String::from_utf8_lossy(&codex.stdout).trim()
    );
    Ok(())
}

async fn poll_loop(app: App) -> Result<(), BoxError> {
    let subscription = app
        .credential
        .subscription_id
        .clone()
        .ok_or("missing subscription")?;
    loop {
        let cursor = app.data.lock().await.cursor;
        let response = app
            .client
            .get(format!(
                "{}/v1/feed-subscriptions/{subscription}/events",
                api(&app)
            ))
            .query(&[("after", cursor), ("limit", 50_i64)])
            .bearer_auth(&app.credential.api_token)
            .send()
            .await?;
        if !response.status().is_success() {
            tracing::warn!(status = %response.status(), "Tardy inbox poll failed");
            tokio::time::sleep(Duration::from_secs(3)).await;
            continue;
        }
        for event in response.json::<Vec<InboxEvent>>().await? {
            enqueue(&app, format!("poll:{}", event.id), event).await?;
        }
        tokio::select! {
            _ = tokio::signal::ctrl_c() => return Ok(()),
            _ = tokio::time::sleep(Duration::from_millis(900)) => {}
        }
    }
}

async fn serve_webhook(app: App) -> Result<(), BoxError> {
    if app.credential.webhook_secret.is_none() {
        return Err("webhook delivery requires webhook_secret in the Tardy state file".into());
    }
    let router = Router::new()
        .route("/healthz", get(|| async { Json(json!({"ok": true})) }))
        .route("/webhooks/tardy", post(webhook))
        .with_state(app);
    let address = env_or("TARDY_AGENT_BIND", "127.0.0.1:8788");
    let listener = tokio::net::TcpListener::bind(&address).await?;
    tracing::info!(%address, "Tardy agent webhook listening");
    axum::serve(listener, router)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}

async fn webhook(
    State(app): State<App>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, (StatusCode, String)> {
    let signature = header(&headers, "x-tardy-signature")?;
    let delivery = header(&headers, "x-tardy-delivery")?;
    let secret = app.credential.webhook_secret.as_deref().ok_or((
        StatusCode::SERVICE_UNAVAILABLE,
        "webhook secret unavailable".into(),
    ))?;
    if !verify_signature(secret, &body, signature) {
        return Err((StatusCode::UNAUTHORIZED, "invalid signature".into()));
    }
    let event: InboxEvent = serde_json::from_slice(&body)
        .map_err(|error| (StatusCode::BAD_REQUEST, error.to_string()))?;
    enqueue(&app, delivery.to_owned(), event)
        .await
        .map_err(internal)?;
    Ok(StatusCode::ACCEPTED)
}

async fn enqueue(app: &App, delivery_id: String, event: InboxEvent) -> Result<(), BoxError> {
    let mut data = app.data.lock().await;
    if data.processed_deliveries.contains(&delivery_id)
        || data
            .queue
            .iter()
            .any(|queued| queued.delivery_id == delivery_id)
    {
        return Ok(());
    }
    data.queue.push_back(QueuedEvent { delivery_id, event });
    store_json(&app.data_path, &*data).await?;
    drop(data);
    app.notify.notify_one();
    Ok(())
}

async fn work_loop(app: App) {
    let (finished_tx, mut finished_rx) = tokio::sync::mpsc::unbounded_channel();
    let mut active = std::collections::BTreeMap::<String, ActiveWork>::new();
    loop {
        let queued = {
            app.data
                .lock()
                .await
                .queue
                .iter()
                .cloned()
                .collect::<Vec<_>>()
        };

        // Commands bypass a busy conversation slot, making /stop responsive.
        if let Some((queued, activation, command)) = queued.iter().find_map(|queued| {
            let activation = WorkActivation::from_event(&queued.event)?;
            match AgentCommand::parse_for_agent(&activation.body, &app.credential.handle) {
                Ok(Some(command)) => Some((queued.clone(), activation, Ok(command))),
                Err(help) => Some((queued.clone(), activation, Err(help))),
                Ok(None) => None,
            }
        }) {
            let response = match command {
                Ok(command) => run_agent_command(&app, command, &activation, &mut active).await,
                Err(help) => Ok(Some(help.to_owned())),
            };
            match response {
                Ok(body) => {
                    if !activation.message_id.is_empty() {
                        let _ = acknowledge(&app, &activation).await;
                    }
                    let delivered = if let Some(body) = body {
                        let reply = PendingReply {
                            conversation_id: activation.conversation_id,
                            body,
                            legacy_dm: activation.legacy_dm,
                            context_cursor: activation.sequence,
                        };
                        send_reply(&app, &reply).await
                    } else {
                        Ok(())
                    };
                    if let Err(error) = delivered {
                        tracing::error!(%error, "agent command reply failed; retained for retry");
                    } else if let Err(error) = finish_delivery(&app, &queued).await {
                        tracing::error!(%error, "failed to commit agent command");
                    }
                }
                Err(error) => tracing::error!(%error, "agent command failed; retained for retry"),
            }
            continue;
        }

        let paused = { app.data.lock().await.paused_conversations.clone() };
        let active_keys = active.keys().cloned().collect();
        let durable_queue = queued.iter().cloned().collect();
        let selected = dispatchable_deliveries(&durable_queue, &active_keys, &paused, 4)
            .into_iter()
            .collect::<std::collections::BTreeSet<_>>();
        for queued in queued {
            if !selected.contains(&queued.delivery_id) {
                continue;
            }
            let Some(activation) = WorkActivation::from_event(&queued.event) else {
                let _ = finish_delivery(&app, &queued).await;
                continue;
            };
            let key = activation.key;
            let task_app = app.clone();
            let task_queued = queued.clone();
            let task_key = key.clone();
            let tx = finished_tx.clone();
            let task = tokio::spawn(async move {
                let result = process_one(&task_app, &task_queued).await;
                let _ = tx.send((task_key, task_queued, result));
            });
            active.insert(
                key,
                ActiveWork {
                    queued,
                    abort: task.abort_handle(),
                },
            );
        }

        tokio::select! {
            Some((key, queued, result)) = finished_rx.recv() => {
                active.remove(&key);
                match result {
                    Ok(()) => {
                        if let Err(error) = finish_delivery(&app, &queued).await {
                            tracing::error!(%error, "failed to commit processed activation");
                        }
                    }
                    Err(error) => {
                        tracing::error!(delivery = %queued.delivery_id, %error, "activation failed; retained for retry");
                        tokio::time::sleep(Duration::from_secs(3)).await;
                    }
                }
            }
            _ = app.notify.notified() => {}
            _ = tokio::time::sleep(Duration::from_millis(250)) => {}
        }
    }
}

async fn finish_delivery(app: &App, queued: &QueuedEvent) -> Result<(), BoxError> {
    let mut data = app.data.lock().await;
    data.queue
        .retain(|candidate| candidate.delivery_id != queued.delivery_id);
    data.pending_replies.remove(&queued.delivery_id);
    data.processed_deliveries.insert(queued.delivery_id.clone());
    while data.processed_deliveries.len() > 2_000 {
        if let Some(first) = data.processed_deliveries.first().cloned() {
            data.processed_deliveries.remove(&first);
        }
    }
    if queued.delivery_id.starts_with("poll:") {
        data.cursor = data.cursor.max(queued.event.id);
    }
    store_json(&app.data_path, &*data).await
}

async fn run_agent_command(
    app: &App,
    command: AgentCommand,
    activation: &WorkActivation,
    active: &mut std::collections::BTreeMap<String, ActiveWork>,
) -> Result<Option<String>, BoxError> {
    let conversation = &activation.conversation_id;
    let key = &activation.key;
    match command {
        AgentCommand::Status => {
            let data = app.data.lock().await;
            let state = if data.paused_conversations.contains(conversation) {
                "paused"
            } else if active.contains_key(key) {
                "working"
            } else {
                "ready"
            };
            let session = if data.sessions.contains_key(key) {
                "resumable"
            } else {
                "new"
            };
            Ok(Some(format!(
                "Agent is {state}. This conversation's session is {session}."
            )))
        }
        AgentCommand::Stop => {
            if let Some(work) = active.remove(key) {
                work.abort.abort();
                finish_delivery(app, &work.queued).await?;
            }
            let mut data = app.data.lock().await;
            data.paused_conversations.insert(conversation.clone());
            store_json(&app.data_path, &*data).await?;
            drop(data);
            let _ = set_typing(app, conversation, false).await;
            Ok(Some("Stopped and paused this conversation. Send /resume when you want me to continue.".into()))
        }
        AgentCommand::Resume => {
            let mut data = app.data.lock().await;
            data.paused_conversations.remove(conversation);
            store_json(&app.data_path, &*data).await?;
            drop(data);
            app.notify.notify_one();
            Ok(Some("Resumed this conversation. Queued messages can run again.".into()))
        }
        AgentCommand::ResetSession => {
            if let Some(work) = active.remove(key) {
                work.abort.abort();
                finish_delivery(app, &work.queued).await?;
            }
            let mut data = app.data.lock().await;
            data.sessions.remove(key);
            data.context_cursors.remove(key);
            data.paused_conversations.remove(conversation);
            store_json(&app.data_path, &*data).await?;
            drop(data);
            let _ = set_typing(app, conversation, false).await;
            Ok(Some("Reset this conversation's Codex session. The next request starts fresh from its granted Tardy context.".into()))
        }
        AgentCommand::NewWorktree => Ok(Some("This host does not have isolated worktrees enabled yet, so nothing was changed. Use /reset-session for a fresh Codex session.".into())),
        AgentCommand::Tardy => {
            publish_last_result_as_tardy(app, activation).await?;
            Ok(None)
        }
    }
}

async fn publish_last_result_as_tardy(
    app: &App,
    activation: &WorkActivation,
) -> Result<(), BoxError> {
    let saved = app
        .data
        .lock()
        .await
        .last_results
        .get(&activation.key)
        .cloned();
    let result = if let Some(result) = saved {
        result
    } else {
        let response = app
            .client
            .get(format!(
                "{}/v1/social/conversations/{}/messages",
                api(app),
                activation.conversation_id
            ))
            .query(&[("after", 0_i64), ("limit", 100_i64)])
            .bearer_auth(&app.credential.api_token)
            .header("x-tardy-profile-id", &app.credential.profile_id)
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(format!("Tardy history lookup returned HTTP {}", response.status()).into());
        }
        response
            .json::<Vec<ConversationMessage>>()
            .await?
            .into_iter()
            .rev()
            .find(|message| message.sender_profile_id == app.credential.profile_id)
            .map(|message| message.body)
            .ok_or("There is no completed agent result in this conversation yet")?
    };
    let caption = result.chars().take(5_000).collect::<String>();
    let digest = Sha256::digest(format!("tardy:{}", activation.message_id).as_bytes());
    let mut request_bytes = [0_u8; 16];
    request_bytes.copy_from_slice(&digest[..16]);
    request_bytes[6] = (request_bytes[6] & 0x0f) | 0x40;
    request_bytes[8] = (request_bytes[8] & 0x3f) | 0x80;
    let client_request_id = uuid::Uuid::from_bytes(request_bytes);
    let response = app
        .client
        .post(format!("{}/v1/social/posts", api(app)))
        .bearer_auth(&app.credential.api_token)
        .header("x-tardy-profile-id", &app.credential.profile_id)
        .json(&json!({
            "client_request_id": client_request_id.to_string(),
            "caption": caption,
            "media": [],
            "shared_link_id": null,
            "visibility": "private"
        }))
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(format!("private Tardy publish returned HTTP {}", response.status()).into());
    }
    let post: Value = response.json().await?;
    let post_id = post
        .get("id")
        .and_then(Value::as_str)
        .ok_or("private Tardy response omitted id")?;
    let link_response = app
        .client
        .post(format!("{}/v1/social/shared-links", api(app)))
        .bearer_auth(&app.credential.api_token)
        .header("x-tardy-profile-id", &app.credential.profile_id)
        .json(&json!({"url": format!("https://tardy.news/t/{post_id}")}))
        .send()
        .await?;
    if !link_response.status().is_success() {
        return Err(format!(
            "private Tardy chat attachment returned HTTP {}",
            link_response.status()
        )
        .into());
    }
    let link: Value = link_response.json().await?;
    let link_id = link
        .get("id")
        .and_then(Value::as_str)
        .ok_or("shared-link response omitted id")?;
    request_ok(
        app.client
            .post(format!(
                "{}/v1/social/conversations/{}/messages",
                api(app),
                activation.conversation_id
            ))
            .bearer_auth(&app.credential.api_token)
            .header("x-tardy-profile-id", &app.credential.profile_id)
            .json(&json!({
                "body": format!("@{} turned this into a Tardy. It is private until you promote it.", app.credential.handle),
                "shared_link_id": link_id
            })),
    )
    .await
}

async fn process_one(app: &App, queued: &QueuedEvent) -> Result<(), BoxError> {
    let Some(activation) = WorkActivation::from_event(&queued.event) else {
        return Ok(());
    };
    if !activation.legacy_dm && !activation.message_id.is_empty() {
        acknowledge(app, &activation).await?;
    }
    let typing_renewal = if activation.legacy_dm {
        None
    } else {
        set_typing(app, &activation.conversation_id, true).await?;
        let (stop_typing, mut stopped) = tokio::sync::oneshot::channel();
        let typing_app = app.clone();
        let typing_conversation = activation.conversation_id.clone();
        let renewal = tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = &mut stopped => break,
                    _ = tokio::time::sleep(Duration::from_secs(3)) => {
                        if let Err(error) = set_typing(&typing_app, &typing_conversation, true).await {
                            tracing::warn!(%error, "failed to renew typing lease");
                        }
                    }
                }
            }
        });
        Some((stop_typing, renewal))
    };
    let result = async {
        let existing = {
            app.data
                .lock()
                .await
                .pending_replies
                .get(&queued.delivery_id)
                .cloned()
        };
        let pending = if let Some(pending) = existing {
            pending
        } else {
            let thread_id = { app.data.lock().await.sessions.get(&activation.key).cloned() };
            let context_after = {
                let data = app.data.lock().await;
                data.context_cursors
                    .get(&activation.key)
                    .copied()
                    .unwrap_or_else(|| activation.context_from_sequence.unwrap_or(1) - 1)
            };
            let context = if activation.legacy_dm {
                Vec::new()
            } else {
                fetch_context(app, &activation, context_after).await?
            };
            let context_cursor = context
                .last()
                .map(|message| message.sequence)
                .or(activation.sequence);
            let result = app
                .runner
                .dispatch(
                    thread_id.as_deref(),
                    &activation_prompt(&app.credential.handle, &activation, &context),
                )
                .await?;
            let pending = PendingReply {
                conversation_id: activation.conversation_id.clone(),
                body: result.reply,
                legacy_dm: activation.legacy_dm,
                context_cursor,
            };
            let mut data = app.data.lock().await;
            data.last_results
                .insert(activation.key.clone(), pending.body.clone());
            data.sessions
                .insert(activation.key.clone(), result.thread_id);
            if let Some(cursor) = pending.context_cursor {
                data.context_cursors.insert(activation.key.clone(), cursor);
            }
            data.pending_replies
                .insert(queued.delivery_id.clone(), pending.clone());
            store_json(&app.data_path, &*data).await?;
            pending
        };
        send_reply(app, &pending).await
    }
    .await;
    if let Some((stop_typing, renewal)) = typing_renewal {
        let _ = stop_typing.send(());
        let _ = renewal.await;
    }
    let typing_result = if activation.legacy_dm {
        Ok(())
    } else {
        set_typing(app, &activation.conversation_id, false).await
    };
    result?;
    typing_result?;
    Ok(())
}

async fn fetch_context(
    app: &App,
    activation: &WorkActivation,
    after: i64,
) -> Result<Vec<ConversationMessage>, BoxError> {
    let response = app
        .client
        .get(format!(
            "{}/v1/social/conversations/{}/messages",
            api(app),
            activation.conversation_id
        ))
        .query(&[("after", after), ("limit", 100_i64)])
        .bearer_auth(&app.credential.api_token)
        .header("x-tardy-profile-id", &app.credential.profile_id)
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(format!(
            "Tardy context fetch returned HTTP {}: {}",
            response.status(),
            response.text().await?.chars().take(500).collect::<String>()
        )
        .into());
    }
    let mut messages = response.json::<Vec<ConversationMessage>>().await?;
    if let Some(through) = activation.sequence {
        messages.retain(|message| message.sequence <= through);
    }
    for message in &mut messages {
        let Some(link_id) = message.shared_link_id.as_deref() else {
            continue;
        };
        let response = app
            .client
            .get(format!("{}/v1/social/shared-links/{link_id}", api(app)))
            .bearer_auth(&app.credential.api_token)
            .header("x-tardy-profile-id", &app.credential.profile_id)
            .send()
            .await?;
        if response.status().is_success() {
            message.shared_link = Some(response.json().await?);
        } else {
            tracing::warn!(
                link_id,
                status = %response.status(),
                "shared link context fetch failed; retaining its durable id"
            );
        }
    }
    Ok(messages)
}

async fn acknowledge(app: &App, activation: &WorkActivation) -> Result<(), BoxError> {
    let kind = if let Some(decider) = app.tapbacks.as_ref() {
        let decider = Arc::clone(decider);
        let handle = app.credential.handle.clone();
        let body = activation.body.clone();
        match tokio::task::spawn_blocking(move || decider.decide(&handle, &body)).await {
            Ok(Ok(tapback)) => tapback.as_api_kind(),
            Ok(Err(error)) => {
                tracing::warn!(%error, "RLCD tapback failed; using seen");
                "seen"
            }
            Err(error) => {
                tracing::warn!(%error, "RLCD tapback task failed; using seen");
                "seen"
            }
        }
    } else {
        "seen"
    };
    request_ok(
        app.client
            .put(format!(
                "{}/v1/social/conversations/{}/messages/{}/reaction",
                api(app),
                activation.conversation_id,
                activation.message_id
            ))
            .bearer_auth(&app.credential.api_token)
            .header("x-tardy-profile-id", &app.credential.profile_id)
            .json(&json!({"kind":kind})),
    )
    .await
}

async fn set_typing(app: &App, conversation: &str, active: bool) -> Result<(), BoxError> {
    let method = if active {
        reqwest::Method::PUT
    } else {
        reqwest::Method::DELETE
    };
    request_ok(
        app.client
            .request(
                method,
                format!("{}/v1/social/conversations/{conversation}/typing", api(app)),
            )
            .bearer_auth(&app.credential.api_token)
            .header("x-tardy-profile-id", &app.credential.profile_id),
    )
    .await
}

async fn send_reply(app: &App, reply: &PendingReply) -> Result<(), BoxError> {
    let route = if reply.legacy_dm {
        format!(
            "{}/v1/dm-threads/{}/messages",
            api(app),
            reply.conversation_id
        )
    } else {
        format!(
            "{}/v1/social/conversations/{}/messages",
            api(app),
            reply.conversation_id
        )
    };
    request_ok(
        app.client
            .post(route)
            .bearer_auth(&app.credential.api_token)
            .header("x-tardy-profile-id", &app.credential.profile_id)
            .json(&json!({"body": reply.body})),
    )
    .await
}

async fn request_ok(builder: reqwest::RequestBuilder) -> Result<(), BoxError> {
    let response = builder.send().await?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!(
            "Tardy API returned HTTP {}: {}",
            response.status(),
            response.text().await?.chars().take(500).collect::<String>()
        )
        .into())
    }
}

fn api(app: &App) -> &str {
    app.credential.api.trim_end_matches('/')
}
fn env_or(name: &str, default: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| default.into())
}
fn expand_path(value: &str) -> PathBuf {
    if let Some(rest) = value.strip_prefix("~/") {
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home).join(rest);
        }
    }
    PathBuf::from(value)
}
fn header<'a>(headers: &'a HeaderMap, name: &str) -> Result<&'a str, (StatusCode, String)> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .ok_or((StatusCode::BAD_REQUEST, format!("missing {name}")))
}
fn internal(error: BoxError) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
}

fn print_help() {
    println!(
        "Tardy agent host\n\nUsage:\n  tardy-agent-host doctor\n  tardy-agent-host run\n\nEnvironment:\n  TARDY_STATE_PATH         Agent credential from `tardy onboard`\n  TARDY_AGENT_WORKSPACE    Workspace this agent may access\n  TARDY_AGENT_HOST_STATE   Durable session and outbox state\n  TARDY_AGENT_DELIVERY     poll (default) or webhook\n  TARDY_CODEX_SANDBOX      read-only or workspace-write (default)\n  TARDY_AGENT_BIND         Webhook bind address"
    );
}

#[allow(dead_code)]
fn _json_type_anchor(_: Value) {}
