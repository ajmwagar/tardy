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
    InboxEvent, OpenCodeRunner, PendingMedia, PendingReply, QueuedEvent, RuntimeActivity,
    RuntimeEvent, RuntimeKind, RuntimeRunner, Tapback, TapbackDecider, WorkActivation,
    activation_prompt, delivery_request_id, dispatchable_deliveries, extract_image_directives,
    extract_manim_directives, extract_mermaid_directives, extract_tardy_caption, load_json,
    obvious_presence_reply, obvious_tapback, should_publish_tardy, store_json, verify_signature,
};
use tokio::sync::{Mutex, Notify};

#[derive(Clone)]
struct App {
    credential: AgentCredential,
    data: Arc<Mutex<HostData>>,
    data_path: PathBuf,
    client: reqwest::Client,
    runner: Arc<RuntimeRunner>,
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
    if command == "tapback" {
        let body = std::env::args().skip(2).collect::<Vec<_>>().join(" ");
        if body.trim().is_empty() {
            return Err("tapback requires a message to classify".into());
        }
        let decision = tokio::task::spawn_blocking(move || {
            if let Some(obvious) = obvious_tapback(&body) {
                return Ok::<_, BoxError>(obvious);
            }
            TapbackDecider::from_env()?.decide("host-doctor", &body)
        })
        .await??;
        println!("{}", decision.as_choice());
        return Ok(());
    }
    if command == "doctor" {
        return doctor().await;
    }
    if matches!(command.as_str(), "peers" | "ask-agent" | "read-chat") {
        let credential: AgentCredential = serde_json::from_slice(
            &tokio::fs::read(expand_path(&env_or(
                "TARDY_STATE_PATH",
                "~/.config/tardy/agent.json",
            )))
            .await?,
        )?;
        let args = std::env::args().skip(2).collect::<Vec<_>>();
        let result = tardy_agent_host::chat_cli::run(&credential, &command, &args).await?;
        println!("{}", serde_json::to_string_pretty(&result)?);
        return Ok(());
    }
    if command == "sessions" {
        println!(
            "{}",
            serde_json::to_string_pretty(&tardy_agent_host::codex_sessions::discover().await?)?
        );
        return Ok(());
    }
    if command == "render-manim" {
        let path = std::env::args()
            .nth(2)
            .ok_or("render-manim requires a workspace-relative request.json path")?;
        let rendered = render_manim(&[tardy_agent_host::ManimDirective {
            path: PathBuf::from(path),
            alt_text: None,
        }])
        .await?;
        for artifact in rendered {
            println!("{}", artifact.path.display());
        }
        return Ok(());
    }
    if command != "run" {
        return Err(format!(
            "unknown command {command}; expected run, doctor, sessions, tapback, render-manim, or help"
        )
        .into());
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
    let runtime = RuntimeKind::parse(&env_or("TARDY_AGENT_RUNTIME", "codex"))?;
    let runner = match runtime {
        RuntimeKind::Codex => {
            let network_access = match env_or("TARDY_CODEX_NETWORK", "enabled").as_str() {
                "enabled" => true,
                "disabled" => false,
                value => {
                    return Err(format!(
                        "TARDY_CODEX_NETWORK must be enabled or disabled, got {value}"
                    )
                    .into());
                }
            };
            RuntimeRunner::Codex(CodexRunner::new(
                workspace,
                env_or("TARDY_CODEX_SANDBOX", "workspace-write"),
                network_access,
                data_path.parent().unwrap_or(Path::new(".")).join("runs"),
            ))
        }
        RuntimeKind::OpenCode => {
            let pure = match env_or("TARDY_OPENCODE_PURE", "no").as_str() {
                "yes" => true,
                "no" => false,
                value => {
                    return Err(
                        format!("TARDY_OPENCODE_PURE must be yes or no, got {value}").into(),
                    );
                }
            };
            RuntimeRunner::OpenCode(OpenCodeRunner::new(
                workspace,
                PathBuf::from(env_or("TARDY_OPENCODE_BIN", "opencode")),
                optional_env("TARDY_OPENCODE_MODEL"),
                optional_env("TARDY_OPENCODE_AGENT"),
                pure,
            ))
        }
    };
    let tapbacks = if std::env::var("TARDY_TAPBACK_RLCD").as_deref() == Ok("yes") {
        Some(Arc::new(
            tokio::task::spawn_blocking(TapbackDecider::from_env).await??,
        ))
    } else {
        None
    };
    let app = App {
        credential,
        data: Arc::new(Mutex::new(data)),
        data_path,
        client: reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()?,
        runner: Arc::new(runner),
        notify: Arc::new(Notify::new()),
        tapbacks,
    };
    let worker = tokio::spawn(work_loop(app.clone()));
    let presence = tokio::spawn(installation_presence_loop(app.clone(), runtime.as_str()));
    let sessions =
        if runtime == RuntimeKind::Codex && env_or("TARDY_CODEX_AUTO_CONNECT", "yes") == "yes" {
            Some(tokio::spawn(session_discovery_loop(app.clone())))
        } else {
            None
        };
    let mode = env_or("TARDY_AGENT_DELIVERY", "poll");
    if mode == "webhook" {
        serve_webhook(app.clone()).await?;
    } else if mode == "poll" {
        poll_loop(app.clone()).await?;
    } else {
        return Err("TARDY_AGENT_DELIVERY must be poll or webhook".into());
    }
    worker.abort();
    presence.abort();
    if let Some(sessions) = sessions {
        sessions.abort();
    }
    Ok(())
}

async fn session_discovery_loop(app: App) {
    loop {
        if let Err(error) = sync_codex_sessions(&app).await {
            tracing::warn!(%error, "Codex auto-connect unavailable; existing host chats remain available");
        }
        tokio::time::sleep(Duration::from_secs(30)).await;
    }
}

async fn sync_codex_sessions(app: &App) -> Result<(), BoxError> {
    let installation = env_or("TARDY_AGENT_INSTALLATION_KEY", "local");
    for session in tardy_agent_host::codex_sessions::discover().await? {
        let response = app
            .client
            .post(format!(
                "{}/v1/agents/{}/installations/{installation}/sessions",
                api(app),
                app.credential.profile_id
            ))
            .bearer_auth(&app.credential.api_token)
            .header("x-tardy-profile-id", &app.credential.profile_id)
            .json(&json!({"thread_id":session.id,"title":session.title}))
            .send()
            .await?
            .error_for_status()?;
        let body: Value = response.json().await?;
        let conversation = body
            .get("conversation_id")
            .and_then(Value::as_str)
            .ok_or("session registration omitted conversation_id")?;
        let mut data = app.data.lock().await;
        let key = format!("conversation:{conversation}");
        let binding = format!("codex:shared:{}", session.id);
        if data
            .sessions
            .get(&key)
            .is_some_and(|existing| existing != &binding)
        {
            return Err("session chat already bound to another runtime".into());
        }
        data.sessions.insert(key, binding);
        store_json(&app.data_path, &*data).await?;
    }
    Ok(())
}

async fn installation_presence_loop(app: App, runtime: &'static str) {
    let key = env_or("TARDY_AGENT_INSTALLATION_KEY", "local");
    let name = env_or("TARDY_AGENT_INSTALLATION_NAME", &key);
    let capabilities = ["chat", "streaming", "tools", "media"];
    loop {
        let result = request_ok(
            app.client
                .put(format!(
                    "{}/v1/agents/{}/installations/{}",
                    api(&app),
                    app.credential.profile_id,
                    key
                ))
                .bearer_auth(&app.credential.api_token)
                .header("x-tardy-profile-id", &app.credential.profile_id)
                .json(&json!({
                    "display_name": name,
                    "runtime": runtime,
                    "capabilities": capabilities,
                    "status": "available"
                })),
        )
        .await;
        if let Err(error) = result {
            tracing::warn!(%error, "agent installation heartbeat failed");
        }
        tokio::time::sleep(Duration::from_secs(30)).await;
    }
}

async fn doctor() -> Result<(), BoxError> {
    let credential_path = expand_path(&env_or("TARDY_STATE_PATH", "~/.config/tardy/agent.json"));
    let credential: AgentCredential =
        serde_json::from_slice(&tokio::fs::read(&credential_path).await?)?;
    let subscription = credential
        .subscription_id
        .as_deref()
        .ok_or("Tardy inbox is missing; run `tardy subscribe --mode poll`")?;
    let runtime = RuntimeKind::parse(&env_or("TARDY_AGENT_RUNTIME", "codex"))?;
    let binary = match runtime {
        RuntimeKind::Codex => "codex".to_owned(),
        RuntimeKind::OpenCode => env_or("TARDY_OPENCODE_BIN", "opencode"),
    };
    let runtime_version = tokio::process::Command::new(&binary)
        .arg("--version")
        .output()
        .await?;
    if !runtime_version.status.success() {
        return Err(format!("{} CLI is installed but unhealthy", runtime.as_str()).into());
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
        String::from_utf8_lossy(&runtime_version.stdout).trim()
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
        let response = match app
            .client
            .get(format!(
                "{}/v1/feed-subscriptions/{subscription}/events",
                api(&app)
            ))
            .query(&[("after", cursor), ("limit", 50_i64)])
            .bearer_auth(&app.credential.api_token)
            .header(reqwest::header::CONNECTION, "close")
            .timeout(Duration::from_secs(5))
            .send()
            .await
        {
            Ok(response) => response,
            Err(error) => {
                tracing::warn!(%error, "Tardy inbox poll request failed; retrying");
                tokio::time::sleep(Duration::from_secs(3)).await;
                continue;
            }
        };
        if !response.status().is_success() {
            tracing::warn!(status = %response.status(), "Tardy inbox poll failed");
            tokio::time::sleep(Duration::from_secs(3)).await;
            continue;
        }
        let events = match response.json::<Vec<InboxEvent>>().await {
            Ok(events) => events,
            Err(error) => {
                tracing::warn!(%error, "Tardy inbox poll body failed; retrying");
                tokio::time::sleep(Duration::from_secs(3)).await;
                continue;
            }
        };
        for event in events {
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
    let activation = WorkActivation::from_event(&event);
    let mut data = app.data.lock().await;
    if data.processed_deliveries.contains(&delivery_id) {
        return Ok(());
    }
    if let Some(target) = event
        .payload
        .get("target_installation")
        .and_then(Value::as_str)
    {
        if target != env_or("TARDY_AGENT_INSTALLATION_KEY", "local") {
            if delivery_id.starts_with("poll:") {
                data.cursor = data.cursor.max(event.id);
            }
            data.processed_deliveries.insert(delivery_id);
            store_json(&app.data_path, &*data).await?;
            return Ok(());
        }
        let thread = event
            .payload
            .get("codex_thread_id")
            .and_then(Value::as_str)
            .ok_or("targeted session omitted thread id")?;
        if app.runner.kind() != RuntimeKind::Codex {
            return Err("a Codex session activation cannot run on another runtime".into());
        }
        if let Some(activation) = &activation {
            data.sessions
                .insert(activation.key.clone(), format!("codex:shared:{thread}"));
        }
    }
    let already_queued = data
        .queue
        .iter()
        .any(|queued| queued.delivery_id == delivery_id);
    if !already_queued {
        data.queue.push_back(QueuedEvent { delivery_id, event });
        store_json(&app.data_path, &*data).await?;
    }
    drop(data);
    // Acknowledgement is a fast, independent lane. A busy Codex/OpenCode session must not
    // delay the human-visible receipt for work that is already durably queued.
    if let Some(activation) = activation
        && !activation.legacy_dm
        && !activation.message_id.is_empty()
        && let Err(error) = acknowledge(app, &activation).await
    {
        // The durable queue remains the retry boundary: process_one calls acknowledge again
        // before dispatch, and acknowledged message ids keep successful sends idempotent.
        tracing::warn!(%error, "immediate message acknowledgement failed; retained for retry");
    }
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
                            request_id: Some(delivery_request_id(&queued.delivery_id)),
                            conversation_id: activation.conversation_id,
                            body,
                            media: Vec::new(),
                            legacy_dm: activation.legacy_dm,
                            context_cursor: activation.sequence,
                            publish_tardy: false,
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

        let durable_queue = {
            let data = app.data.lock().await;
            // Outbox delivery is not execution; paused chats must still receive saved replies.
            queued
                .iter()
                .filter(|queued| {
                    data.pending_replies.contains_key(&queued.delivery_id)
                        || WorkActivation::from_event(&queued.event).is_none_or(|activation| {
                            !data
                                .paused_conversations
                                .contains(&activation.conversation_id)
                        })
                })
                .cloned()
                .collect()
        };
        let active_keys = active.keys().cloned().collect();
        let selected =
            dispatchable_deliveries(&durable_queue, &active_keys, &Default::default(), 4)
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
    data.dispatched_deliveries.remove(&queued.delivery_id);
    data.completed_runs.remove(&queued.delivery_id);
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
            let shared = app.data.lock().await.sessions.get(key)
                .and_then(|id| id.strip_prefix("codex:shared:")).map(str::to_owned);
            if let Some(thread) = shared {
                tardy_agent_host::codex_sessions::interrupt(&thread).await?;
            }
            // Do not discard active control state before native interruption succeeds.
            if let Some(work) = active.remove(key) {
                work.abort.abort();
                finish_delivery(app, &work.queued).await?;
            }
            let mut data = app.data.lock().await;
            data.paused_conversations.insert(conversation.clone());
            store_json(&app.data_path, &*data).await?;
            drop(data);
            let _ = set_typing(app, conversation, false).await;
            if let Err(error) = clear_draft(app, conversation).await {
                tracing::warn!(%error, "native work stopped but stream cleanup failed");
            }
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
            if app.data.lock().await.sessions.get(key).is_some_and(|id| id.starts_with("codex:shared:")) {
                return Ok(Some("This chat is attached to an existing Codex session. Start a new session in Codex for a fresh context; /reset-session does not replace it.".into()));
            }
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
            Ok(Some("Reset this conversation's agent session. The next request starts fresh from its granted Tardy context.".into()))
        }
        AgentCommand::NewWorktree => Ok(Some("This host does not have isolated worktrees enabled yet, so nothing was changed. Use /reset-session for a fresh agent session.".into())),
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
    let (saved, saved_media, saved_caption) = {
        let data = app.data.lock().await;
        (
            data.last_results.get(&activation.key).cloned(),
            data.last_media
                .get(&activation.key)
                .cloned()
                .unwrap_or_default(),
            data.last_captions.get(&activation.key).cloned(),
        )
    };
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
    let caption = saved_caption
        .unwrap_or(result)
        .chars()
        .take(5_000)
        .collect::<String>();
    let video = saved_media.iter().find(|item| {
        item.content_type
            .as_deref()
            .is_some_and(|kind| kind.starts_with("video/"))
    });
    let post_media = if let Some(video) = video {
        let poster = saved_media.iter().find(|item| {
            item.content_type
                .as_deref()
                .is_some_and(|kind| kind.starts_with("image/"))
        });
        vec![json!({
            "type": "video",
            "asset_id": video.asset_id,
            "poster_asset_id": poster.map(|item| &item.asset_id),
            "url": video.url.as_deref().ok_or("completed reel upload omitted its URL")?,
            "poster_url": poster.and_then(|item| item.url.as_deref()),
            "width": video.width.ok_or("reel upload omitted width")?,
            "height": video.height.ok_or("reel upload omitted height")?,
            "duration_ms": video.duration_ms.ok_or("reel upload omitted duration")?
        })]
    } else {
        saved_media
            .iter()
            .filter_map(|item| {
                item.content_type
                    .as_deref()
                    .filter(|kind| kind.starts_with("image/"))?;
                Some(json!({
                    "type": "image",
                    "asset_id": item.asset_id,
                    "url": item.url.as_deref()?,
                    "poster_url": null,
                    "width": item.width?,
                    "height": item.height?,
                    "duration_ms": 0
                }))
            })
            .take(4)
            .collect()
    };
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
            "media": post_media,
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
    let post_url = format!("https://tardy.news/viewer.html?id={post_id}");
    let link_response = app
        .client
        .post(format!("{}/v1/social/shared-links", api(app)))
        .bearer_auth(&app.credential.api_token)
        .header("x-tardy-profile-id", &app.credential.profile_id)
        .json(&json!({"url": post_url}))
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
                "body": post_url,
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
    {
        let mut data = app.data.lock().await;
        if data.needs_dispatch_recovery(&queued.delivery_id) {
            // A crash or runtime transport error can happen after turn/start was accepted.
            // At-least-once inbox delivery must not turn into at-least-once execution.
            data.paused_conversations
                .insert(activation.conversation_id.clone());
            data.pending_replies.insert(queued.delivery_id.clone(), PendingReply {
                request_id: Some(delivery_request_id(&queued.delivery_id)),
                conversation_id: activation.conversation_id.clone(),
                body: "I lost confirmation from the coding session. Work may still be running; I have paused this chat rather than repeat your request. Check the original session, then use /resume and send a new instruction.".into(),
                media: Vec::new(), legacy_dm: activation.legacy_dm,
                context_cursor: None, publish_tardy: false,
            });
            store_json(&app.data_path, &*data).await?;
        }
    }
    if let Some(body) = obvious_presence_reply(&activation.body) {
        return send_reply(
            app,
            &PendingReply {
                request_id: Some(delivery_request_id(&queued.delivery_id)),
                conversation_id: activation.conversation_id,
                body: body.to_owned(),
                media: Vec::new(),
                legacy_dm: activation.legacy_dm,
                context_cursor: activation.sequence,
                publish_tardy: false,
            },
        )
        .await;
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
    let result: Result<(), BoxError> = async {
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
            let resumes_selected_runtime = app.runner.accepts_session(thread_id.as_deref());
            let context_after = {
                let data = app.data.lock().await;
                if resumes_selected_runtime {
                    data.context_cursors
                        .get(&activation.key)
                        .copied()
                        .unwrap_or_else(|| activation.context_from_sequence.unwrap_or(1) - 1)
                } else {
                    // A runtime switch creates a fresh local session. Replay the complete
                    // granted Tardy context so the new runtime does not inherit a false
                    // assumption that it can see the previous runtime's private state.
                    activation.context_from_sequence.unwrap_or(1) - 1
                }
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
            let cached_run = { app.data.lock().await.completed_runs.get(&queued.delivery_id).cloned() };
            let (progress, forwarder) = if activation.legacy_dm || cached_run.is_some() {
                (None, None)
            } else {
                let (sender, receiver) = tokio::sync::mpsc::channel(64);
                let draft_app = app.clone();
                let conversation = activation.conversation_id.clone();
                (
                    Some(sender),
                    Some(tokio::spawn(async move {
                        forward_runtime_events(&draft_app, &conversation, receiver).await
                    })),
                )
            };
            let base_prompt = activation_prompt(&app.credential.handle, &activation, &context);
            let private_soul = fetch_private_soul(app).await?;
            let prompt = if private_soul.is_empty() {
                base_prompt
            } else {
                format!(
                    "{base_prompt}\n\nPersistent private soul for @{} (owner-controlled; follow it unless the current request or safety policy conflicts):\n{}",
                    app.credential.handle, private_soul
                )
            };
            let dispatch_result = if let Some(result) = cached_run {
                Ok(result)
            } else {
                {
                    let mut data = app.data.lock().await;
                    data.dispatched_deliveries.insert(queued.delivery_id.clone());
                    store_json(&app.data_path, &*data).await?;
                }
                let result = app.runner.dispatch(thread_id.as_deref(), &prompt, progress).await;
                if let Ok(completed) = &result {
                    let mut data = app.data.lock().await;
                    data.completed_runs.insert(queued.delivery_id.clone(), completed.clone());
                    store_json(&app.data_path, &*data).await?;
                }
                result
            };
            if let Some(forwarder) = forwarder {
                forwarder.await??;
            }
            let result = dispatch_result?;
            let (body, manim) = extract_manim_directives(&result.reply)?;
            let manim_media = render_manim(&manim).await?;
            let (body, diagrams) = extract_mermaid_directives(&body)?;
            let rendered = render_mermaid(&app.data_path, &diagrams).await?;
            let (body, mut directives) = extract_image_directives(&body)?;
            directives.extend(rendered);
            directives.extend(manim_media);
            let (body, tardy_caption) = extract_tardy_caption(&body);
            let media = upload_images(app, &directives).await?;
            let publish_tardy = should_publish_tardy(tardy_caption.as_deref(), &media);
            let pending = PendingReply {
                request_id: Some(delivery_request_id(&queued.delivery_id)),
                conversation_id: activation.conversation_id.clone(),
                body,
                media,
                legacy_dm: activation.legacy_dm,
                context_cursor,
                publish_tardy,
            };
            let mut data = app.data.lock().await;
            data.last_results
                .insert(activation.key.clone(), pending.body.clone());
            data.last_media
                .insert(activation.key.clone(), pending.media.clone());
            if let Some(caption) = tardy_caption {
                data.last_captions.insert(activation.key.clone(), caption);
            }
            data.sessions.insert(activation.key.clone(), result.session);
            if let Some(cursor) = pending.context_cursor {
                data.context_cursors.insert(activation.key.clone(), cursor);
            }
            data.pending_replies
                .insert(queued.delivery_id.clone(), pending.clone());
            store_json(&app.data_path, &*data).await?;
            pending
        };
        send_reply(app, &pending).await?;
        if pending.publish_tardy {
            publish_last_result_as_tardy(app, &activation).await?;
        }
        Ok(())
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
    if result.is_err() && !activation.legacy_dm {
        let _ = clear_draft(app, &activation.conversation_id).await;
    }
    result?;
    typing_result?;
    Ok(())
}

async fn fetch_private_soul(app: &App) -> Result<String, BoxError> {
    let response = app
        .client
        .get(format!(
            "{}/v1/agents/{}/soul",
            api(app),
            app.credential.profile_id
        ))
        .bearer_auth(&app.credential.api_token)
        .header("x-tardy-profile-id", &app.credential.profile_id)
        .send()
        .await?;
    if response.status() == StatusCode::NOT_FOUND {
        return Ok(String::new());
    }
    if !response.status().is_success() {
        return Err(format!("agent soul fetch returned HTTP {}", response.status()).into());
    }
    let body: Value = response.json().await?;
    Ok(body
        .get("private_instructions")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned())
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
    if app
        .data
        .lock()
        .await
        .acknowledged_messages
        .contains(&activation.message_id)
    {
        return Ok(());
    }
    let acknowledgement = if let Some(obvious) = obvious_tapback(&activation.body) {
        obvious
    } else if let Some(decider) = app.tapbacks.as_ref() {
        let decider = Arc::clone(decider);
        let handle = app.credential.handle.clone();
        let body = activation.body.clone();
        match tokio::time::timeout(
            Duration::from_millis(1_200),
            tokio::task::spawn_blocking(move || decider.decide(&handle, &body)),
        )
        .await
        {
            Ok(Ok(Ok(tapback))) => tapback,
            Ok(Ok(Err(error))) => {
                tracing::warn!(%error, "RLCD tapback failed; adding no reaction");
                Tapback::None
            }
            Ok(Err(error)) => {
                tracing::warn!(%error, "RLCD tapback task failed; adding no reaction");
                Tapback::None
            }
            Err(_) => {
                tracing::warn!("RLCD tapback exceeded 1200 ms; dispatching without a reaction");
                Tapback::None
            }
        }
    } else {
        Tapback::None
    };
    if let Some(body) = acknowledgement.as_message() {
        request_ok(
            app.client
                .post(format!(
                    "{}/v1/social/conversations/{}/messages",
                    api(app),
                    activation.conversation_id
                ))
                .bearer_auth(&app.credential.api_token)
                .header("x-tardy-profile-id", &app.credential.profile_id)
                .json(&json!({"body": body, "shared_link_id": null, "media": []})),
        )
        .await?;
    } else if let Some(kind) = acknowledgement.as_api_kind() {
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
        .await?;
    } else {
        // `none` is still a completed classification. Persist it so a replay does not pay for
        // the same RLCD decision repeatedly or later add a stale reaction.
    }
    let mut data = app.data.lock().await;
    data.acknowledged_messages
        .insert(activation.message_id.clone());
    store_json(&app.data_path, &*data).await
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

async fn forward_runtime_events(
    app: &App,
    conversation: &str,
    mut events: tokio::sync::mpsc::Receiver<RuntimeEvent>,
) -> Result<(), BoxError> {
    let mut body = String::new();
    let mut status = "writing";
    let mut detail = String::new();
    let mut activities: Vec<RuntimeActivity> = Vec::new();
    let mut dirty = false;
    let mut interval = tokio::time::interval(Duration::from_millis(80));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            event = events.recv() => match event {
                Some(RuntimeEvent::TextDelta(delta)) => {
                    if body.len().saturating_add(delta.len()) <= 20_000 {
                        body.push_str(&delta);
                    }
                    status = "writing";
                    detail.clear();
                    dirty = true;
                }
                Some(RuntimeEvent::Activity(activity)) => {
                    status = "tool";
                    detail = activity.title.chars().take(500).collect();
                    if let Some(existing) = activities.iter_mut().find(|item| item.id == activity.id) {
                        *existing = activity;
                    } else {
                        activities.push(activity);
                        if activities.len() > 20 { activities.remove(0); }
                    }
                    dirty = true;
                }
                None => {
                    if dirty { set_draft(app, conversation, &body, "finalizing", "Finishing up", &activities).await?; }
                    return Ok(());
                }
            },
            _ = interval.tick(), if dirty => {
                set_draft(app, conversation, &body, status, &detail, &activities).await?;
                dirty = false;
            }
        }
    }
}

async fn set_draft(
    app: &App,
    conversation: &str,
    body: &str,
    status: &str,
    detail: &str,
    activities: &[RuntimeActivity],
) -> Result<(), BoxError> {
    request_ok(
        app.client
            .put(format!(
                "{}/v1/social/conversations/{conversation}/draft",
                api(app)
            ))
            .bearer_auth(&app.credential.api_token)
            .header("x-tardy-profile-id", &app.credential.profile_id)
            .json(&json!({"body":body,"status":status,"detail":detail,"activities":activities})),
    )
    .await
}

async fn clear_draft(app: &App, conversation: &str) -> Result<(), BoxError> {
    request_ok(
        app.client
            .delete(format!(
                "{}/v1/social/conversations/{conversation}/draft",
                api(app)
            ))
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
            .json(&json!({"body": reply.body, "media": reply.media, "client_request_id":reply.request_id})),
    )
    .await
}

async fn upload_images(
    app: &App,
    directives: &[tardy_agent_host::ImageDirective],
) -> Result<Vec<PendingMedia>, BoxError> {
    let workspace = std::fs::canonicalize(env_or("TARDY_AGENT_WORKSPACE", "."))?;
    let mut uploaded = Vec::with_capacity(directives.len());
    for directive in directives {
        let candidate = if directive.path.is_absolute() {
            directive.path.clone()
        } else {
            workspace.join(&directive.path)
        };
        let path = std::fs::canonicalize(candidate)?;
        if !path.starts_with(&workspace) {
            return Err("TARDY_IMAGE path must stay inside the configured workspace".into());
        }
        let bytes = tokio::fs::read(&path).await?;
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let (content_type, dimensions) = match extension.as_str() {
            "png" => ("image/png", Some(png_dimensions(&bytes)?)),
            "jpg" | "jpeg" => ("image/jpeg", None),
            "webp" => ("image/webp", None),
            "mp4" => ("video/mp4", None),
            "mov" => ("video/quicktime", None),
            "webm" => ("video/webm", None),
            "mp3" => ("audio/mpeg", None),
            "wav" => ("audio/wav", None),
            "m4a" => ("audio/mp4", None),
            "ogg" => ("audio/ogg", None),
            "flac" => ("audio/flac", None),
            "json" => ("application/json", None),
            "pdf" => ("application/pdf", None),
            "md" | "markdown" => ("text/markdown", None),
            "txt" => ("text/plain", None),
            _ => return Err("TARDY_FILE has an unsupported extension".into()),
        };
        let authorization = app
            .client
            .post(format!("{}/v1/uploads", api(app)))
            .bearer_auth(&app.credential.api_token)
            .header("x-tardy-profile-id", &app.credential.profile_id)
            .json(&json!({
                "profile_id": app.credential.profile_id,
                "kind": "message_attachment",
                "content_type": content_type,
                "byte_length": bytes.len(),
                "sha256_base64": null
            }))
            .send()
            .await?;
        if !authorization.status().is_success() {
            return Err(format!(
                "Tardy upload authorization returned HTTP {}: {}",
                authorization.status(),
                authorization.text().await?
            )
            .into());
        }
        let authorization: Value = authorization.json().await?;
        let id = authorization["id"]
            .as_str()
            .ok_or("upload authorization omitted id")?;
        let url = authorization["url"]
            .as_str()
            .ok_or("upload authorization omitted url")?;
        let mut upload = app.client.put(url).body(bytes);
        if let Some(headers) = authorization["headers"].as_object() {
            for (name, value) in headers {
                upload = upload.header(name, value.as_str().ok_or("invalid upload header")?);
            }
        }
        request_ok(upload).await?;
        let completed = app
            .client
            .post(format!("{}/v1/uploads/{id}/complete", api(app)))
            .bearer_auth(&app.credential.api_token)
            .header("x-tardy-profile-id", &app.credential.profile_id)
            .send()
            .await?;
        if !completed.status().is_success() {
            return Err(format!(
                "Tardy upload completion returned HTTP {}: {}",
                completed.status(),
                completed.text().await?
            )
            .into());
        }
        let completed: Value = completed.json().await?;
        let (width, height, duration_ms) = probe_media(&path).await.unwrap_or_else(|| {
            dimensions
                .map(|(width, height)| (Some(width), Some(height), None))
                .unwrap_or((None, None, None))
        });
        uploaded.push(PendingMedia {
            asset_id: id.to_owned(),
            width,
            height,
            file_name: path
                .file_name()
                .and_then(|value| value.to_str())
                .map(str::to_owned),
            alt_text: directive.alt_text.clone(),
            url: completed
                .get("url")
                .and_then(Value::as_str)
                .map(str::to_owned),
            content_type: Some(content_type.into()),
            duration_ms,
        });
    }
    Ok(uploaded)
}

const MERMAID_CLI_PACKAGE: &str = "@mermaid-js/mermaid-cli@11.12.0";
const MAX_MERMAID_SOURCE_BYTES: u64 = 256 * 1024;

async fn render_mermaid(
    _data_path: &Path,
    directives: &[tardy_agent_host::MermaidDirective],
) -> Result<Vec<tardy_agent_host::ImageDirective>, BoxError> {
    let workspace = std::fs::canonicalize(env_or("TARDY_AGENT_WORKSPACE", "."))?;
    // Keep generated files under the configured workspace so the ordinary attachment
    // confinement check remains the single upload authorization boundary.
    let cache = workspace.join(".tardy/artifacts/mermaid");
    tokio::fs::create_dir_all(&cache).await?;
    let mut rendered = Vec::with_capacity(directives.len());
    for directive in directives {
        let candidate = if directive.path.is_absolute() {
            directive.path.clone()
        } else {
            workspace.join(&directive.path)
        };
        let source = std::fs::canonicalize(candidate)?;
        if !source.starts_with(&workspace) {
            return Err("TARDY_MERMAID path must stay inside the configured workspace".into());
        }
        let bytes = tokio::fs::read(&source).await?;
        if bytes.is_empty() || bytes.len() as u64 > MAX_MERMAID_SOURCE_BYTES {
            return Err("TARDY_MERMAID source must be between 1 byte and 256 KiB".into());
        }
        std::str::from_utf8(&bytes).map_err(|_| "TARDY_MERMAID source must be UTF-8")?;
        let digest = hex::encode(Sha256::digest(
            [MERMAID_CLI_PACKAGE.as_bytes(), b"\0", bytes.as_slice()].concat(),
        ));
        let output = cache.join(format!("{digest}.png"));
        if !tokio::fs::try_exists(&output).await? {
            let mut command = tokio::process::Command::new(env_or("TARDY_NPX_COMMAND", "npx"));
            command
                .args(["--yes", MERMAID_CLI_PACKAGE, "-i"])
                .arg(&source)
                .arg("-o")
                .arg(&output)
                .args(["-b", "transparent", "-w", "1600"])
                .kill_on_drop(true);
            if let Ok(browser) = std::env::var("TARDY_MERMAID_BROWSER") {
                command
                    .env("PUPPETEER_EXECUTABLE_PATH", browser)
                    .env("PUPPETEER_SKIP_DOWNLOAD", "true");
            }
            match tokio::time::timeout(Duration::from_secs(120), command.output()).await {
                Ok(Ok(result)) if result.status.success() => {}
                Ok(Ok(result)) => {
                    return Err(format!(
                        "Mermaid CLI failed: {}",
                        String::from_utf8_lossy(&result.stderr)
                            .chars()
                            .take(1000)
                            .collect::<String>()
                    )
                    .into());
                }
                Ok(Err(error)) => return Err(error.into()),
                Err(_) => {
                    // Some externally supplied Chromium builds finish the PNG but hang while
                    // closing. kill_on_drop terminates them; accept only a complete PNG header.
                    let finished = tokio::fs::read(&output).await.unwrap_or_default();
                    const PNG_IEND: &[u8] = b"\0\0\0\0IEND\xaeB`\x82";
                    if finished.len() < 100
                        || png_dimensions(&finished).is_err()
                        || !finished.ends_with(PNG_IEND)
                    {
                        return Err("Mermaid CLI timed out after 120 seconds".into());
                    }
                    tracing::warn!(path = %output.display(), "Mermaid renderer timed out after producing a valid PNG");
                }
            }
        }
        rendered.push(tardy_agent_host::ImageDirective {
            path: output,
            alt_text: directive
                .alt_text
                .clone()
                .or_else(|| Some("Mermaid diagram".into())),
        });
    }
    Ok(rendered)
}

const MANIM_VERSION: &str = "0.19.0";
const MAX_MANIM_REQUEST_BYTES: u64 = 64 * 1024;
const MAX_MANIM_SOURCE_BYTES: u64 = 512 * 1024;

async fn render_manim(
    directives: &[tardy_agent_host::ManimDirective],
) -> Result<Vec<tardy_agent_host::ImageDirective>, BoxError> {
    let workspace = std::fs::canonicalize(env_or("TARDY_AGENT_WORKSPACE", "."))?;
    let cache = workspace.join(".tardy/artifacts/manim");
    tokio::fs::create_dir_all(&cache).await?;
    let mut rendered = Vec::with_capacity(directives.len());
    for directive in directives {
        let manifest_path = workspace.join(&directive.path).canonicalize()?;
        if !manifest_path.starts_with(&workspace) {
            return Err("TARDY_MANIM request must stay inside the configured workspace".into());
        }
        let manifest = tokio::fs::read(&manifest_path).await?;
        if manifest.is_empty() || manifest.len() as u64 > MAX_MANIM_REQUEST_BYTES {
            return Err("TARDY_MANIM request must be between 1 byte and 64 KiB".into());
        }
        let request = tardy_agent_host::ManimRenderRequest::parse(&manifest)?;
        let manifest_dir = manifest_path
            .parent()
            .ok_or("Manim request has no parent")?;
        let source_path = manifest_dir.join(&request.source).canonicalize()?;
        if !source_path.starts_with(&workspace) {
            return Err("Manim source must stay inside the configured workspace".into());
        }
        let source = tokio::fs::read(&source_path).await?;
        if source.is_empty() || source.len() as u64 > MAX_MANIM_SOURCE_BYTES {
            return Err("Manim source must be between 1 byte and 512 KiB".into());
        }
        std::str::from_utf8(&source).map_err(|_| "Manim source must be UTF-8")?;
        let digest = hex::encode(Sha256::digest(
            [manifest.as_slice(), b"\0", source.as_slice()].concat(),
        ));
        let output = cache.join(format!("{digest}.mp4"));
        if !tokio::fs::try_exists(&output).await? {
            let media_dir = cache.join(format!("work-{digest}"));
            tokio::fs::create_dir_all(&media_dir).await?;
            let mut command = tokio::process::Command::new(env_or("TARDY_UVX_COMMAND", "uvx"));
            command
                .args([
                    "--from",
                    &format!("manim=={MANIM_VERSION}"),
                    "manim",
                    "render",
                ])
                .arg("--disable_caching")
                .arg("--format=mp4")
                .arg(format!("--resolution={},{}", request.width, request.height))
                .arg(format!("--fps={}", request.fps))
                .arg("--media_dir")
                .arg(&media_dir)
                .arg("--output_file")
                .arg(&output)
                .arg(&source_path)
                .arg(&request.scene)
                .env("PYTHONHASHSEED", "0")
                .current_dir(manifest_dir)
                .kill_on_drop(true);
            if request.transparent {
                command.arg("--transparent");
            }
            let result = tokio::time::timeout(Duration::from_secs(300), command.output())
                .await
                .map_err(|_| "Manim render timed out after 300 seconds")??;
            if !result.status.success() {
                return Err(format!(
                    "Manim render failed: {}",
                    String::from_utf8_lossy(&result.stderr)
                        .chars()
                        .take(2000)
                        .collect::<String>()
                )
                .into());
            }
            if !tokio::fs::try_exists(&output).await? {
                return Err("Manim completed without producing its declared output".into());
            }
            tokio::fs::remove_dir_all(&media_dir).await?;
        }
        let metadata = tokio::fs::metadata(&output).await?;
        if metadata.len() == 0 || metadata.len() > 250 * 1024 * 1024 {
            return Err("Manim output violates attachment size bounds".into());
        }
        let (width, height, duration_ms) = probe_media(&output)
            .await
            .ok_or("Manim output could not be probed")?;
        if width != Some(request.width) || height != Some(request.height) {
            return Err("Manim output dimensions do not match the request".into());
        }
        if duration_ms.is_none()
            || duration_ms
                .is_some_and(|duration| duration > u64::from(request.max_duration_seconds) * 1000)
        {
            return Err("Manim output exceeds max_duration_seconds".into());
        }
        rendered.push(tardy_agent_host::ImageDirective {
            path: manifest_path,
            alt_text: Some("Manim render request and citations".into()),
        });
        rendered.push(tardy_agent_host::ImageDirective {
            path: output,
            alt_text: directive
                .alt_text
                .clone()
                .or_else(|| Some("Manim lesson".into())),
        });
    }
    Ok(rendered)
}

async fn probe_media(path: &Path) -> Option<(Option<u32>, Option<u32>, Option<u64>)> {
    let output = tokio::process::Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-show_entries",
            "stream=width,height:format=duration",
            "-of",
            "json",
        ])
        .arg(path)
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let value: Value = serde_json::from_slice(&output.stdout).ok()?;
    let stream = value.get("streams")?.as_array()?.first();
    let width = stream
        .and_then(|row| row.get("width"))
        .and_then(Value::as_u64)
        .and_then(|v| u32::try_from(v).ok());
    let height = stream
        .and_then(|row| row.get("height"))
        .and_then(Value::as_u64)
        .and_then(|v| u32::try_from(v).ok());
    let duration_ms = value
        .get("format")?
        .get("duration")?
        .as_str()?
        .parse::<f64>()
        .ok()
        .map(|value| (value * 1000.0).round() as u64);
    Some((width, height, duration_ms))
}

fn png_dimensions(bytes: &[u8]) -> Result<(u32, u32), BoxError> {
    if bytes.len() < 24 || &bytes[..8] != b"\x89PNG\r\n\x1a\n" || &bytes[12..16] != b"IHDR" {
        return Err("TARDY_IMAGE currently accepts PNG files only".into());
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into()?);
    let height = u32::from_be_bytes(bytes[20..24].try_into()?);
    if width == 0 || height == 0 {
        return Err("PNG has invalid dimensions".into());
    }
    Ok((width, height))
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
fn optional_env(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
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
        "Peer chats:\n  tardy-agent-host peers [query]\n  tardy-agent-host ask-agent <agent-uuid> <request-uuid> <question>\n  tardy-agent-host read-chat <conversation-uuid> [after-sequence]\n"
    );
    println!(
        "Existing Codex sessions:\n  tardy-agent-host sessions\n  TARDY_CODEX_AUTO_CONNECT=yes (default) discovers shared-daemon sessions as owner-only chats.\n"
    );
    println!(
        "Tardy agent host\n\nUsage:\n  tardy-agent-host doctor\n  tardy-agent-host tapback <message>\n  tardy-agent-host render-manim <request.json>\n  tardy-agent-host run\n\nEnvironment:\n  TARDY_STATE_PATH         Agent credential from `tardy onboard`\n  TARDY_AGENT_WORKSPACE    Workspace this agent may access\n  TARDY_AGENT_HOST_STATE   Durable session and outbox state\n  TARDY_AGENT_DELIVERY     poll (default) or webhook\n  TARDY_AGENT_RUNTIME      codex (default) or opencode\n  TARDY_CODEX_SANDBOX      read-only or workspace-write (default)\n  TARDY_CODEX_NETWORK      enabled (default) or disabled\n  TARDY_OPENCODE_BIN       OpenCode executable (default: opencode)\n  TARDY_OPENCODE_MODEL     Optional provider/model routed by OpenCode\n  TARDY_OPENCODE_AGENT     Optional OpenCode agent name\n  TARDY_OPENCODE_PURE      yes disables external OpenCode plugins\n  TARDY_UVX_COMMAND        uvx-compatible Manim launcher\n  TARDY_AGENT_BIND         Webhook bind address"
    );
}

#[allow(dead_code)]
fn _json_type_anchor(_: Value) {}
