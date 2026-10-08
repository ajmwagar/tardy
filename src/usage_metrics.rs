//! Persisted product actions, not requests, sessions, or background polling.
use crate::metrics::{Metrics, UsageSnapshot};
use sqlx::PgPool;
use std::sync::Arc;

pub async fn snapshot(pool: &PgPool) -> Result<Vec<UsageSnapshot>, sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("SET TRANSACTION READ ONLY")
        .execute(&mut *tx)
        .await?;
    sqlx::query("SET LOCAL statement_timeout = '8s'")
        .execute(&mut *tx)
        .await?;
    let rows = sqlx::query_as(include_str!("usage_metrics.sql"))
        .fetch_all(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(rows)
}

pub async fn collect(pool: PgPool, metrics: Arc<Metrics>) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        interval.tick().await;
        match tokio::time::timeout(std::time::Duration::from_secs(10), snapshot(&pool)).await {
            Ok(Ok(rows)) => metrics.update_usage(rows, chrono::Utc::now().timestamp()),
            error => {
                metrics.note_usage_failure();
                tracing::warn!(
                    ?error,
                    "product usage collection failed; previous snapshot retained"
                );
            }
        }
    }
}
