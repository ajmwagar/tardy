use crate::product::{REAL_TARDY_MONTHLY_USD_CENTS, SUPER_TARDY_LIFETIME_USD_CENTS};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VerificationTier {
    RealTardy,
    SuperTardy,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct VerificationProduct {
    pub tier: VerificationTier,
    pub price_usd_cents: u32,
    pub cadence: &'static str,
    pub global_limit: Option<u32>,
}

pub fn products() -> [VerificationProduct; 2] {
    [
        VerificationProduct {
            tier: VerificationTier::RealTardy,
            price_usd_cents: REAL_TARDY_MONTHLY_USD_CENTS,
            cadence: "monthly",
            global_limit: None,
        },
        VerificationProduct {
            tier: VerificationTier::SuperTardy,
            price_usd_cents: SUPER_TARDY_LIFETIME_USD_CENTS,
            cadence: "lifetime",
            global_limit: Some(crate::product::SUPER_TARDY_GLOBAL_SLOT_LIMIT),
        },
    ]
}

#[derive(Debug, Clone)]
pub struct SettledVerificationPayment<'a> {
    pub provider: &'a str,
    pub provider_event_id: &'a str,
    pub provider_reference: &'a str,
    pub profile_id: Uuid,
    pub tier: VerificationTier,
    pub amount_cents: u32,
    pub occurred_at: DateTime<Utc>,
    pub real_tardy_expires_at: Option<DateTime<Utc>>,
    pub payload_digest: &'a [u8],
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct VerificationEntitlement {
    pub profile_id: Uuid,
    pub tier: VerificationTier,
    pub super_tardy_slot: Option<i32>,
    #[schema(value_type = Option<String>, format = DateTime)]
    pub expires_at: Option<DateTime<Utc>>,
}

#[derive(Debug, thiserror::Error)]
pub enum VerificationError {
    #[error("invalid verification payment: {0}")]
    Invalid(&'static str),
    #[error("all 1000 SUPER Tardy slots are claimed")]
    SuperTardySoldOut,
    #[error(transparent)]
    Database(#[from] sqlx::Error),
}

#[derive(Clone)]
pub struct PgVerificationStore {
    pool: PgPool,
}

impl PgVerificationStore {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Applies an already verified Stripe or x402 settlement. Provider adapters own
    /// signature verification; this method owns deduplication and entitlement allocation.
    pub async fn settle(
        &self,
        payment: SettledVerificationPayment<'_>,
    ) -> Result<VerificationEntitlement, VerificationError> {
        let expected = match payment.tier {
            VerificationTier::RealTardy => REAL_TARDY_MONTHLY_USD_CENTS,
            VerificationTier::SuperTardy => SUPER_TARDY_LIFETIME_USD_CENTS,
        };
        if !matches!(payment.provider, "stripe" | "x402") || payment.amount_cents != expected {
            return Err(VerificationError::Invalid("provider or amount"));
        }
        if payment.tier == VerificationTier::RealTardy
            && payment.real_tardy_expires_at <= Some(payment.occurred_at)
        {
            return Err(VerificationError::Invalid("REAL Tardy expiry"));
        }

        let mut tx = self.pool.begin().await?;
        sqlx::query("SELECT pg_advisory_xact_lock(841726390)")
            .execute(&mut *tx)
            .await?;
        let inserted = sqlx::query(
            "INSERT INTO verification_payment_events
                (id,provider,provider_event_id,profile_id,tier,amount_cents,status,occurred_at,payload_digest)
             VALUES ($1,$2,$3,$4,$5,$6,'settled',$7,$8)
             ON CONFLICT (provider,provider_event_id) DO NOTHING",
        )
        .bind(Uuid::new_v4()).bind(payment.provider).bind(payment.provider_event_id)
        .bind(payment.profile_id).bind(tier_name(payment.tier)).bind(payment.amount_cents as i32)
        .bind(payment.occurred_at).bind(payment.payload_digest).execute(&mut *tx).await?;

        if inserted.rows_affected() > 0 {
            let slot = if payment.tier == VerificationTier::SuperTardy {
                match sqlx::query_scalar::<_, Option<i32>>(
                    "SELECT super_tardy_slot FROM profile_verifications WHERE profile_id=$1",
                )
                .bind(payment.profile_id)
                .fetch_optional(&mut *tx)
                .await?
                .flatten()
                {
                    Some(existing) => existing,
                    None => sqlx::query_scalar::<_, i32>(
                        "SELECT candidate FROM generate_series(1,1000) candidate
                         WHERE NOT EXISTS (SELECT 1 FROM profile_verifications v WHERE v.super_tardy_slot=candidate)
                         ORDER BY candidate LIMIT 1",
                    )
                    .fetch_optional(&mut *tx)
                    .await?
                    .ok_or(VerificationError::SuperTardySoldOut)?,
                }
            } else {
                0
            };
            sqlx::query(
                "INSERT INTO profile_verifications
                    (profile_id,tier,super_tardy_slot,provider,provider_reference,starts_at,expires_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7)
                 ON CONFLICT (profile_id) DO UPDATE SET
                    tier=excluded.tier,super_tardy_slot=excluded.super_tardy_slot,
                    provider=excluded.provider,provider_reference=excluded.provider_reference,
                    starts_at=excluded.starts_at,expires_at=excluded.expires_at,revoked_at=NULL,updated_at=now()",
            ).bind(payment.profile_id).bind(tier_name(payment.tier)).bind((slot != 0).then_some(slot))
              .bind(payment.provider).bind(payment.provider_reference).bind(payment.occurred_at)
              .bind(payment.real_tardy_expires_at).execute(&mut *tx).await?;
        }
        let row = sqlx::query("SELECT tier,super_tardy_slot,expires_at FROM profile_verifications WHERE profile_id=$1 AND revoked_at IS NULL")
            .bind(payment.profile_id).fetch_one(&mut *tx).await?;
        tx.commit().await?;
        Ok(VerificationEntitlement {
            profile_id: payment.profile_id,
            tier: parse_tier(row.try_get("tier")?)?,
            super_tardy_slot: row.try_get("super_tardy_slot")?,
            expires_at: row.try_get("expires_at")?,
        })
    }
}

fn tier_name(tier: VerificationTier) -> &'static str {
    match tier {
        VerificationTier::RealTardy => "real_tardy",
        VerificationTier::SuperTardy => "super_tardy",
    }
}
fn parse_tier(value: String) -> Result<VerificationTier, VerificationError> {
    match value.as_str() {
        "real_tardy" => Ok(VerificationTier::RealTardy),
        "super_tardy" => Ok(VerificationTier::SuperTardy),
        _ => Err(VerificationError::Invalid("persisted tier")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn catalog_is_stable() {
        let catalog = products();
        assert_eq!(catalog[0].price_usd_cents, 2_000);
        assert_eq!(catalog[0].cadence, "monthly");
        assert_eq!(catalog[1].price_usd_cents, 25_000);
        assert_eq!(catalog[1].global_limit, Some(1_000));
    }
}
