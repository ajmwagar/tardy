//! Durable intake, not a claim that asynchronous erasure has completed.
use serde::Serialize;
use sqlx::{PgPool, Row};
use uuid::Uuid;

#[derive(Serialize, utoipa::ToSchema)]
pub struct DeletionReceipt {
    pub id: Uuid,
    pub status: String,
}

/// Revoke access atomically with intake. Completion requires a separate audited purge.
/// Agents exclusively owned by this person are disabled, never transferred implicitly.
pub async fn request_deletion(
    pool: &PgPool,
    account: Uuid,
) -> Result<DeletionReceipt, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let human: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM durable_accounts WHERE id=$1 AND kind='human')",
    )
    .bind(account)
    .fetch_one(&mut *tx)
    .await?;
    if !human {
        return Err(sqlx::Error::RowNotFound);
    }
    let row = sqlx::query("INSERT INTO account_deletion_requests(id,account_id) VALUES($1,$2) ON CONFLICT(account_id) DO UPDATE SET account_id=excluded.account_id RETURNING id,status")
        .bind(Uuid::new_v4()).bind(account).fetch_one(&mut *tx).await?;
    sqlx::query(
        "UPDATE auth_sessions SET revoked_at=now() WHERE account_id=$1 AND revoked_at IS NULL",
    )
    .bind(account)
    .execute(&mut *tx)
    .await?;
    sqlx::query("UPDATE account_api_tokens SET revoked_at=now() WHERE revoked_at IS NULL AND (account_id=$1 OR account_id IN (SELECT DISTINCT pa.actor_account_id FROM profile_actors pa JOIN profile_ownership po ON po.profile_id=pa.profile_id JOIN durable_accounts a ON a.id=pa.actor_account_id WHERE po.owner_account_id=$1 AND a.kind='agent'))")
        .bind(account).execute(&mut *tx).await?;
    sqlx::query("UPDATE durable_ai_consents SET revoked_at=now() WHERE account_id=$1 AND revoked_at IS NULL")
        .bind(account).execute(&mut *tx).await?;
    let result = DeletionReceipt {
        id: row.try_get("id")?,
        status: row.try_get("status")?,
    };
    tx.commit().await?;
    Ok(result)
}

pub fn valid_report(reason: &str, details: &str) -> bool {
    matches!(
        reason,
        "spam" | "harassment" | "sexual" | "violence" | "copyright" | "other"
    ) && details.chars().count() <= 2000
}

#[cfg(test)]
mod tests {
    #[test]
    fn report_limits_and_reasons_are_explicit() {
        assert!(super::valid_report("copyright", "Original creator's URL"));
        assert!(!super::valid_report("ban-now", ""));
        assert!(!super::valid_report("other", &"a".repeat(2001)));
    }
}
