use std::time::Duration;
use tardy::pg_ingest::PgIngestStore;
use tardy::source_dispatch::{DisabledCapabilities, SourceDispatchError, SourceDispatcher};
use uuid::Uuid;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    let database_url = std::env::var("DATABASE_URL")?;
    let outbox = PgIngestStore::connect(&database_url, 2).await?;
    let dispatcher = SourceDispatcher::connect(&database_url, 4).await?;
    let worker = format!(
        "{}:{}",
        std::env::var("HOSTNAME").unwrap_or_else(|_| "tardy-source-dispatch".into()),
        Uuid::new_v4()
    );
    let capabilities = DisabledCapabilities;

    loop {
        let events = outbox
            .claim_outbox_topic(&worker, "source.item_ingested.v1", 25)
            .await?;
        if events.is_empty() {
            tokio::time::sleep(Duration::from_secs(2)).await;
            continue;
        }
        for event in events {
            match dispatcher.dispatch(&worker, &event, &capabilities).await {
                Ok(post_id) => {
                    tracing::info!(event_id=%event.id, %post_id, "source update published")
                }
                Err(error @ SourceDispatchError::Invalid(_)) => {
                    tracing::warn!(event_id=%event.id, %error, "source update quarantined");
                    dispatcher
                        .quarantine(&worker, &event, &error.to_string())
                        .await?;
                }
                Err(error @ SourceDispatchError::Payload(_)) => {
                    tracing::warn!(event_id=%event.id, %error, "invalid source event quarantined");
                    outbox
                        .fail_outbox(&worker, event.id, &error.to_string())
                        .await?;
                }
                Err(error) => {
                    tracing::error!(event_id=%event.id, %error, "source update dispatch failed");
                    outbox
                        .reschedule_outbox(&worker, event.id, &error.to_string(), 30)
                        .await?;
                }
            }
        }
    }
}
