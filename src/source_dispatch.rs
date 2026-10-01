use crate::ingest::{Capability, CapabilityRequest, RightsMode, RightsPolicy, TransformPlan};
use crate::pg_ingest::OutboxEvent;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row, postgres::PgPoolOptions};
use std::time::Duration;
use url::Url;
use uuid::Uuid;

const SOURCE_TOPIC: &str = "source.item_ingested.v1";

#[derive(Debug, thiserror::Error)]
pub enum SourceDispatchError {
    #[error("source dispatcher database: {0}")]
    Database(#[from] sqlx::Error),
    #[error("source dispatcher payload: {0}")]
    Payload(#[from] serde_json::Error),
    #[error("source event is invalid: {0}")]
    Invalid(&'static str),
    #[error("source capability failed: {0}")]
    Capability(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CapabilityOutcome {
    pub capability: Capability,
    pub status: String,
    pub output: Option<String>,
}

#[async_trait]
pub trait CapabilityExecutor: Send + Sync {
    async fn execute(
        &self,
        request: &CapabilityRequest,
    ) -> Result<CapabilityOutcome, SourceDispatchError>;
}

/// Development/default executor. It records that optional enrichment was skipped while
/// still publishing the deterministic, attributed Lua plan. Production adapters can
/// replace this without giving Lua an endpoint or credential.
pub struct DisabledCapabilities;

#[async_trait]
impl CapabilityExecutor for DisabledCapabilities {
    async fn execute(
        &self,
        request: &CapabilityRequest,
    ) -> Result<CapabilityOutcome, SourceDispatchError> {
        Ok(CapabilityOutcome {
            capability: request.capability.clone(),
            status: "skipped_unconfigured".into(),
            output: None,
        })
    }
}

#[derive(Clone)]
pub struct SourceDispatcher {
    pool: PgPool,
}

impl SourceDispatcher {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn connect(
        database_url: &str,
        max_connections: u32,
    ) -> Result<Self, SourceDispatchError> {
        let pool = PgPoolOptions::new()
            .max_connections(max_connections)
            .acquire_timeout(Duration::from_secs(5))
            .connect(database_url)
            .await?;
        Ok(Self::new(pool))
    }

    pub async fn dispatch(
        &self,
        worker: &str,
        event: &OutboxEvent,
        executor: &dyn CapabilityExecutor,
    ) -> Result<Uuid, SourceDispatchError> {
        if event.topic != SOURCE_TOPIC {
            return Err(SourceDispatchError::Invalid("unexpected outbox topic"));
        }
        let payload: SourceEvent = serde_json::from_value(event.payload.clone())?;
        if event.aggregate_id != payload.source_item_id.to_string() {
            return Err(SourceDispatchError::Invalid(
                "aggregate does not match source item",
            ));
        }

        let mut tx = self.pool.begin().await?;
        let row = sqlx::query(
            "SELECT r.status,r.plan,i.source_id,i.canonical_url,s.display_name,s.rights_policy
             FROM transformation_runs r
             JOIN source_items i ON i.id=r.source_item_id
             JOIN source_channels s ON s.id=i.source_id
             WHERE r.id=$1 AND r.source_item_id=$2 FOR UPDATE",
        )
        .bind(payload.run_id)
        .bind(payload.source_item_id)
        .fetch_one(&mut *tx)
        .await?;
        let status: String = row.try_get("status")?;
        let plan: TransformPlan = serde_json::from_value(row.try_get("plan")?)?;
        let source_id: String = row.try_get("source_id")?;
        let canonical_url: String = row.try_get("canonical_url")?;
        let display_name: String = row.try_get("display_name")?;
        let rights: RightsPolicy = serde_json::from_value(row.try_get("rights_policy")?)?;
        validate_plan(&plan, &canonical_url, &rights)?;

        let profile_id = stable_uuid("source-profile", &source_id);
        let account_id = stable_uuid("source-account", &source_id);
        let post_request_id = stable_uuid("source-post", &payload.source_item_id.to_string());
        let post_id = stable_uuid("source-post-row", &payload.source_item_id.to_string());

        if status == "succeeded" {
            mark_event_delivered(&mut tx, worker, event.id).await?;
            tx.commit().await?;
            return Ok(post_id);
        }
        if status != "planned" && status != "failed" {
            return Err(SourceDispatchError::Invalid(
                "transformation is not dispatchable",
            ));
        }

        let mut outcomes = Vec::with_capacity(plan.capabilities.len());
        for request in &plan.capabilities {
            outcomes.push(executor.execute(request).await?);
        }

        sqlx::query(
            "INSERT INTO durable_accounts (id,kind,temporary) VALUES ($1,'agent',false)
             ON CONFLICT (id) DO NOTHING",
        )
        .bind(account_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO profile_ownership (profile_id,owner_account_id) VALUES ($1,$2)
             ON CONFLICT (profile_id) DO NOTHING",
        )
        .bind(profile_id)
        .bind(account_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO profile_actors (profile_id,actor_account_id) VALUES ($1,$2)
             ON CONFLICT DO NOTHING",
        )
        .bind(profile_id)
        .bind(account_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO social_identities (profile_id,account_id,handle,kind)
             VALUES ($1,$2,$3,'channel')
             ON CONFLICT (profile_id) DO UPDATE SET handle=excluded.handle,kind='channel'",
        )
        .bind(profile_id)
        .bind(account_id)
        .bind(source_handle(&source_id))
        .execute(&mut *tx)
        .await?;
        let link_id = stable_uuid("source-link", &canonical_url);
        sqlx::query(
            "INSERT INTO shared_links (id,canonical_url,provider,status,metadata)
             VALUES ($1,$2,'source','ready',$3)
             ON CONFLICT (canonical_url) DO UPDATE SET metadata=excluded.metadata,status='ready'",
        )
        .bind(link_id)
        .bind(&canonical_url)
        .bind(serde_json::json!({"source_id": source_id, "attribution": plan.attribution}))
        .execute(&mut *tx)
        .await?;
        let stored_link_id: Uuid =
            sqlx::query_scalar("SELECT id FROM shared_links WHERE canonical_url=$1")
                .bind(&canonical_url)
                .fetch_one(&mut *tx)
                .await?;
        let caption = format!(
            "{}\n\nSource: {}",
            plan.headline.trim(),
            plan.attribution.trim()
        );
        sqlx::query(
            "INSERT INTO tardy_posts
               (id,author_profile_id,client_request_id,caption,shared_link_id,visibility)
             VALUES ($1,$2,$3,$4,$5,'public')
             ON CONFLICT (author_profile_id,client_request_id) DO NOTHING",
        )
        .bind(post_id)
        .bind(profile_id)
        .bind(post_request_id)
        .bind(caption)
        .bind(stored_link_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "UPDATE transformation_runs SET status='succeeded',output=$1,finished_at=now(),last_error=NULL
             WHERE id=$2",
        )
        .bind(serde_json::json!({
            "post_id": post_id,
            "profile_id": profile_id,
            "display_name": display_name,
            "carousel": plan.carousel,
            "capabilities": outcomes,
        }))
        .bind(payload.run_id)
        .execute(&mut *tx)
        .await?;
        mark_event_delivered(&mut tx, worker, event.id).await?;
        tx.commit().await?;
        Ok(post_id)
    }

    pub async fn quarantine(
        &self,
        worker: &str,
        event: &OutboxEvent,
        error: &str,
    ) -> Result<(), SourceDispatchError> {
        let payload: SourceEvent = serde_json::from_value(event.payload.clone())?;
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "UPDATE transformation_runs
             SET status='quarantined',finished_at=now(),last_error=left($1,2000)
             WHERE id=$2 AND status IN ('planned','failed')",
        )
        .bind(error)
        .bind(payload.run_id)
        .execute(&mut *tx)
        .await?;
        let result = sqlx::query(
            "UPDATE outbox SET failed_at=now(),lease_owner=NULL,lease_until=NULL,last_error=left($1,2000)
             WHERE id=$2 AND delivered_at IS NULL AND failed_at IS NULL AND lease_owner=$3",
        )
        .bind(error)
        .bind(event.id)
        .bind(worker)
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() != 1 {
            return Err(SourceDispatchError::Invalid("outbox lease was lost"));
        }
        tx.commit().await?;
        Ok(())
    }
}

#[derive(Deserialize)]
struct SourceEvent {
    source_item_id: Uuid,
    run_id: Uuid,
}

fn validate_plan(
    plan: &TransformPlan,
    canonical_url: &str,
    rights: &RightsPolicy,
) -> Result<(), SourceDispatchError> {
    if rights.mode == RightsMode::RequiresLicense {
        return Err(SourceDispatchError::Invalid(
            "source requires a content license",
        ));
    }
    if plan.source_url != canonical_url || plan.attribution.trim() != rights.attribution.trim() {
        return Err(SourceDispatchError::Invalid(
            "plan provenance does not match source",
        ));
    }
    if plan.headline.trim().is_empty() || plan.headline.len() > 4_000 {
        return Err(SourceDispatchError::Invalid(
            "headline is empty or too long",
        ));
    }
    let url = Url::parse(canonical_url)
        .map_err(|_| SourceDispatchError::Invalid("invalid source URL"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(SourceDispatchError::Invalid(
            "source URL must use HTTP or HTTPS",
        ));
    }
    Ok(())
}

async fn mark_event_delivered(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    worker: &str,
    event_id: Uuid,
) -> Result<(), SourceDispatchError> {
    let result = sqlx::query(
        "UPDATE outbox SET delivered_at=now(),lease_owner=NULL,lease_until=NULL,last_error=NULL
         WHERE id=$1 AND delivered_at IS NULL AND lease_owner=$2",
    )
    .bind(event_id)
    .bind(worker)
    .execute(&mut **tx)
    .await?;
    if result.rows_affected() != 1 {
        return Err(SourceDispatchError::Invalid("outbox lease was lost"));
    }
    Ok(())
}

fn source_handle(source_id: &str) -> String {
    format!("source-{source_id}")
}

fn stable_uuid(namespace: &str, value: &str) -> Uuid {
    let digest = Sha256::digest(format!("tardy:{namespace}:{value}"));
    let mut bytes: [u8; 16] = digest[..16].try_into().expect("SHA-256 prefix is 16 bytes");
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Uuid::from_bytes(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stable_ids_and_handles_are_deterministic() {
        assert_eq!(
            stable_uuid("source-profile", "hn"),
            stable_uuid("source-profile", "hn")
        );
        assert_ne!(
            stable_uuid("source-profile", "hn"),
            stable_uuid("source-account", "hn")
        );
        assert_eq!(source_handle("hacker-news-top"), "source-hacker-news-top");
    }
}
