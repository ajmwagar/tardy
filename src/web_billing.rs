use crate::product::{REAL_TARDY_MONTHLY_USD_CENTS, SUPER_TARDY_LIFETIME_USD_CENTS};
use crate::verification::{PgVerificationStore, SettledVerificationPayment, VerificationTier};
use chrono::{DateTime, Duration, Utc};
use hmac::{Hmac, Mac};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use utoipa::ToSchema;
use uuid::Uuid;

const HANDOFF_TTL_MINUTES: i64 = 5;
const WEB_SESSION_TTL_DAYS: i64 = 30;
pub const WEB_SESSION_COOKIE: &str = "tardy_web_session";

#[derive(Debug, thiserror::Error)]
pub enum BillingError {
    #[error("invalid or expired website handoff")]
    InvalidHandoff,
    #[error("website session is missing or expired")]
    InvalidSession,
    #[error("billing provider is not configured")]
    Unconfigured,
    #[error("all 1000 SUPER Tardy slots are reserved or claimed")]
    SuperTardySoldOut,
    #[error("invalid billing request: {0}")]
    Invalid(&'static str),
    #[error("billing provider failed: {0}")]
    Provider(String),
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    Verification(#[from] crate::verification::VerificationError),
}

#[derive(Debug, Serialize, ToSchema)]
pub struct WebHandoff {
    pub url: String,
    #[schema(value_type = String, format = DateTime)]
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct BrowserSession {
    pub account_id: Uuid,
    pub return_path: String,
    pub cookie: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct BillingStatus {
    pub profile_id: Uuid,
    pub tier: Option<VerificationTier>,
    pub super_tardy_slot: Option<i32>,
    #[schema(value_type = Option<String>, format = DateTime)]
    pub expires_at: Option<DateTime<Utc>>,
    pub stripe_customer: bool,
}

#[derive(Debug, Clone)]
pub struct StripeConfig {
    secret_key: String,
    webhook_secret: Vec<u8>,
    real_price_id: String,
    super_price_id: String,
    public_web_url: String,
    client: reqwest::Client,
    live_mode: bool,
}

impl StripeConfig {
    pub fn from_env(public_web_url: String) -> Result<Option<Self>, BillingError> {
        let Ok(secret_key) = std::env::var("STRIPE_SECRET_KEY") else {
            return Ok(None);
        };
        if secret_key.trim().is_empty() {
            return Ok(None);
        }
        let webhook_secret =
            std::env::var("STRIPE_WEBHOOK_SECRET").map_err(|_| BillingError::Unconfigured)?;
        Ok(Some(Self {
            live_mode: secret_key.contains("_live_"),
            secret_key,
            webhook_secret: webhook_secret.into_bytes(),
            real_price_id: required_env("STRIPE_REAL_TARDY_PRICE_ID")?,
            super_price_id: required_env("STRIPE_SUPER_TARDY_PRICE_ID")?,
            public_web_url,
            client: reqwest::Client::new(),
        }))
    }

    fn request(&self, path: &str) -> reqwest::RequestBuilder {
        self.client
            .post(format!("https://api.stripe.com/v1{path}"))
            .bearer_auth(&self.secret_key)
    }
}

#[derive(Clone)]
pub struct PgWebBillingStore {
    pool: PgPool,
    verification: PgVerificationStore,
    stripe: Option<StripeConfig>,
    public_web_url: String,
}

impl PgWebBillingStore {
    pub fn new(pool: PgPool, public_web_url: String, stripe: Option<StripeConfig>) -> Self {
        Self {
            verification: PgVerificationStore::new(pool.clone()),
            pool,
            stripe,
            public_web_url,
        }
    }

    pub fn cookie_secure_attribute(&self) -> &'static str {
        if self.public_web_url.starts_with("https://") {
            "; Secure"
        } else {
            ""
        }
    }

    pub async fn issue_handoff(
        &self,
        account_id: Uuid,
        requested_path: &str,
    ) -> Result<WebHandoff, BillingError> {
        let return_path = match requested_path {
            "/verify" | "/verify.html" => "/verify.html",
            "/membership" | "/membership.html" => "/membership.html",
            _ => return Err(BillingError::Invalid("unsupported return path")),
        };
        let token = opaque_token();
        let expires_at = Utc::now() + Duration::minutes(HANDOFF_TTL_MINUTES);
        sqlx::query("INSERT INTO web_login_handoffs (token_digest,account_id,return_path,expires_at) VALUES ($1,$2,$3,$4)")
            .bind(digest(token.as_bytes())).bind(account_id).bind(return_path).bind(expires_at).execute(&self.pool).await?;
        Ok(WebHandoff {
            url: format!(
                "{}{return_path}?handoff={token}",
                self.public_web_url.trim_end_matches('/')
            ),
            expires_at,
        })
    }

    pub async fn exchange_handoff(&self, token: &str) -> Result<BrowserSession, BillingError> {
        let mut tx = self.pool.begin().await?;
        let row = sqlx::query("UPDATE web_login_handoffs SET consumed_at=now() WHERE token_digest=$1 AND consumed_at IS NULL AND expires_at>now() RETURNING account_id,return_path")
            .bind(digest(token.as_bytes())).fetch_optional(&mut *tx).await?.ok_or(BillingError::InvalidHandoff)?;
        let account_id: Uuid = row.try_get("account_id")?;
        let return_path: String = row.try_get("return_path")?;
        let session = opaque_token();
        sqlx::query("INSERT INTO web_browser_sessions (token_digest,account_id,expires_at) VALUES ($1,$2,$3)")
            .bind(digest(session.as_bytes())).bind(account_id).bind(Utc::now() + Duration::days(WEB_SESSION_TTL_DAYS)).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(BrowserSession {
            account_id,
            return_path,
            cookie: session,
        })
    }

    pub async fn authenticate(&self, token: &str) -> Result<Uuid, BillingError> {
        sqlx::query_scalar("SELECT account_id FROM web_browser_sessions WHERE token_digest=$1 AND revoked_at IS NULL AND expires_at>now()")
            .bind(digest(token.as_bytes())).fetch_optional(&self.pool).await?.ok_or(BillingError::InvalidSession)
    }

    pub async fn revoke(&self, token: &str) -> Result<(), BillingError> {
        sqlx::query("UPDATE web_browser_sessions SET revoked_at=now() WHERE token_digest=$1")
            .bind(digest(token.as_bytes()))
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn status(&self, account_id: Uuid) -> Result<BillingStatus, BillingError> {
        let row = sqlx::query(
            "SELECT h.profile_id,v.tier,v.super_tardy_slot,v.expires_at,
                    EXISTS(SELECT 1 FROM stripe_billing_customers c WHERE c.account_id=$1) stripe_customer
             FROM human_profiles h LEFT JOIN profile_verifications v ON v.profile_id=h.profile_id AND v.revoked_at IS NULL
             WHERE h.account_id=$1",
        ).bind(account_id).fetch_one(&self.pool).await?;
        let tier: Option<String> = row.try_get("tier")?;
        Ok(BillingStatus {
            profile_id: row.try_get("profile_id")?,
            tier: tier.as_deref().map(parse_tier).transpose()?,
            super_tardy_slot: row.try_get("super_tardy_slot")?,
            expires_at: row.try_get("expires_at")?,
            stripe_customer: row.try_get("stripe_customer")?,
        })
    }

    pub async fn stripe_checkout(
        &self,
        account_id: Uuid,
        tier: VerificationTier,
    ) -> Result<String, BillingError> {
        let stripe = self.stripe.as_ref().ok_or(BillingError::Unconfigured)?;
        let profile_id: Uuid =
            sqlx::query_scalar("SELECT profile_id FROM human_profiles WHERE account_id=$1")
                .bind(account_id)
                .fetch_one(&self.pool)
                .await?;
        if tier == VerificationTier::RealTardy {
            let active: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM profile_verifications WHERE profile_id=$1 AND tier='real_tardy' AND revoked_at IS NULL AND expires_at>now())")
                .bind(profile_id).fetch_one(&self.pool).await?;
            if active {
                return Err(BillingError::Invalid("profile already has REAL Tardy"));
            }
        } else {
            let real_active: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM profile_verifications WHERE profile_id=$1 AND tier='real_tardy' AND revoked_at IS NULL AND expires_at>now())")
                .bind(profile_id).fetch_one(&self.pool).await?;
            if real_active {
                return Err(BillingError::Invalid(
                    "cancel REAL Tardy before buying SUPER Tardy",
                ));
            }
        }
        let (mode, price) = match tier {
            VerificationTier::RealTardy => ("subscription", &stripe.real_price_id),
            VerificationTier::SuperTardy => ("payment", &stripe.super_price_id),
        };
        let customer: Option<String> = sqlx::query_scalar(
            "SELECT stripe_customer_id FROM stripe_billing_customers WHERE account_id=$1",
        )
        .bind(account_id)
        .fetch_optional(&self.pool)
        .await?;
        let reservation = if tier == VerificationTier::SuperTardy {
            Some(self.reserve_super_tardy(profile_id).await?)
        } else {
            None
        };
        let body = checkout_form(
            stripe,
            profile_id,
            tier,
            mode,
            price,
            customer.as_deref(),
            reservation,
        );
        let response = stripe
            .request("/checkout/sessions")
            .header("content-type", "application/x-www-form-urlencoded")
            .body(body)
            .send()
            .await;
        let response = match response {
            Ok(response) => response,
            Err(error) => {
                if let Some(reservation) = reservation {
                    self.release_super_reservation(reservation).await?;
                }
                return Err(provider(error));
            }
        };
        let status = response.status();
        let value: Value = response.json().await.map_err(provider)?;
        if !status.is_success() {
            if let Some(reservation) = reservation {
                self.release_super_reservation(reservation).await?;
            }
            return Err(BillingError::Provider(value.to_string()));
        }
        if let (Some(reservation), Some(session_id)) = (reservation, value["id"].as_str()) {
            sqlx::query(
                "UPDATE super_tardy_checkout_reservations SET stripe_session_id=$2 WHERE id=$1",
            )
            .bind(reservation)
            .bind(session_id)
            .execute(&self.pool)
            .await?;
        }
        value["url"]
            .as_str()
            .map(str::to_owned)
            .ok_or_else(|| BillingError::Provider("Stripe response omitted checkout URL".into()))
    }

    async fn reserve_super_tardy(&self, profile_id: Uuid) -> Result<Uuid, BillingError> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("SELECT pg_advisory_xact_lock(841726390)")
            .execute(&mut *tx)
            .await?;
        let already_owned: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM profile_verifications WHERE profile_id=$1 AND tier='super_tardy' AND revoked_at IS NULL)")
            .bind(profile_id).fetch_one(&mut *tx).await?;
        if already_owned {
            return Err(BillingError::Invalid("profile already has SUPER Tardy"));
        }
        sqlx::query("DELETE FROM super_tardy_checkout_reservations WHERE completed_at IS NULL AND expires_at<=now()")
            .execute(&mut *tx).await?;
        let occupied: i64 = sqlx::query_scalar(
            "SELECT (SELECT count(*) FROM profile_verifications WHERE tier='super_tardy' AND revoked_at IS NULL)
                  + (SELECT count(*) FROM super_tardy_checkout_reservations WHERE profile_id<>$1 AND completed_at IS NULL AND expires_at>now())",
        ).bind(profile_id).fetch_one(&mut *tx).await?;
        if occupied >= i64::from(crate::product::SUPER_TARDY_GLOBAL_SLOT_LIMIT) {
            return Err(BillingError::SuperTardySoldOut);
        }
        let id = Uuid::new_v4();
        sqlx::query("INSERT INTO super_tardy_checkout_reservations (id,profile_id,expires_at) VALUES ($1,$2,now()+interval '30 minutes') ON CONFLICT (profile_id) DO UPDATE SET id=excluded.id,stripe_session_id=NULL,expires_at=excluded.expires_at,completed_at=NULL RETURNING id")
            .bind(id).bind(profile_id).fetch_one(&mut *tx).await?;
        tx.commit().await?;
        Ok(id)
    }

    async fn release_super_reservation(&self, id: Uuid) -> Result<(), BillingError> {
        sqlx::query(
            "DELETE FROM super_tardy_checkout_reservations WHERE id=$1 AND completed_at IS NULL",
        )
        .bind(id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn stripe_portal(&self, account_id: Uuid) -> Result<String, BillingError> {
        let stripe = self.stripe.as_ref().ok_or(BillingError::Unconfigured)?;
        let customer: String = sqlx::query_scalar(
            "SELECT stripe_customer_id FROM stripe_billing_customers WHERE account_id=$1",
        )
        .bind(account_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(BillingError::Invalid("no Stripe customer"))?;
        let body = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("customer", &customer)
            .append_pair(
                "return_url",
                &format!(
                    "{}/verify.html",
                    stripe.public_web_url.trim_end_matches('/')
                ),
            )
            .finish();
        let response = stripe
            .request("/billing_portal/sessions")
            .header("content-type", "application/x-www-form-urlencoded")
            .body(body)
            .send()
            .await
            .map_err(provider)?;
        let status = response.status();
        let value: Value = response.json().await.map_err(provider)?;
        if !status.is_success() {
            return Err(BillingError::Provider(value.to_string()));
        }
        value["url"]
            .as_str()
            .map(str::to_owned)
            .ok_or_else(|| BillingError::Provider("Stripe response omitted portal URL".into()))
    }

    pub async fn stripe_webhook(
        &self,
        signature: &str,
        payload: &[u8],
    ) -> Result<(), BillingError> {
        let stripe = self.stripe.as_ref().ok_or(BillingError::Unconfigured)?;
        verify_stripe_signature(&stripe.webhook_secret, signature, payload)?;
        let event: Value = serde_json::from_slice(payload)
            .map_err(|_| BillingError::Invalid("invalid Stripe JSON"))?;
        if event["livemode"].as_bool() != Some(stripe.live_mode) {
            return Err(BillingError::Invalid("Stripe mode mismatch"));
        }
        let event_id = text(&event, "/id")?;
        let event_type = text(&event, "/type")?;
        let seen: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM stripe_webhook_events WHERE event_id=$1)",
        )
        .bind(event_id)
        .fetch_one(&self.pool)
        .await?;
        if seen {
            return Ok(());
        }
        if event_type == "checkout.session.completed" {
            let object = &event["data"]["object"];
            let profile_id = Uuid::parse_str(text(object, "/metadata/profile_id")?)
                .map_err(|_| BillingError::Invalid("Stripe profile id"))?;
            let tier = parse_tier(text(object, "/metadata/tier")?)?;
            let reservation = if tier == VerificationTier::SuperTardy {
                let reservation = Uuid::parse_str(text(object, "/metadata/reservation_id")?)
                    .map_err(|_| BillingError::Invalid("SUPER Tardy reservation"))?;
                let valid: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM super_tardy_checkout_reservations WHERE id=$1 AND profile_id=$2 AND stripe_session_id=$3 AND completed_at IS NULL AND expires_at>now())")
                    .bind(reservation).bind(profile_id).bind(text(object, "/id")?).fetch_one(&self.pool).await?;
                if !valid {
                    return Err(BillingError::Invalid("expired SUPER Tardy reservation"));
                }
                Some(reservation)
            } else {
                None
            };
            let customer = text(object, "/customer")?;
            let account_id: Uuid =
                sqlx::query_scalar("SELECT account_id FROM human_profiles WHERE profile_id=$1")
                    .bind(profile_id)
                    .fetch_one(&self.pool)
                    .await?;
            sqlx::query("INSERT INTO stripe_billing_customers (account_id,stripe_customer_id) VALUES ($1,$2) ON CONFLICT (account_id) DO UPDATE SET stripe_customer_id=excluded.stripe_customer_id")
                .bind(account_id).bind(customer).execute(&self.pool).await?;
            let occurred = DateTime::from_timestamp(
                event["created"]
                    .as_i64()
                    .ok_or(BillingError::Invalid("Stripe created"))?,
                0,
            )
            .ok_or(BillingError::Invalid("Stripe timestamp"))?;
            let provider_reference = if tier == VerificationTier::RealTardy {
                text(object, "/subscription")?
            } else {
                text(object, "/id")?
            };
            self.verification
                .settle(SettledVerificationPayment {
                    provider: "stripe",
                    provider_event_id: event_id,
                    provider_reference,
                    profile_id,
                    tier,
                    amount_cents: match tier {
                        VerificationTier::RealTardy => REAL_TARDY_MONTHLY_USD_CENTS,
                        VerificationTier::SuperTardy => SUPER_TARDY_LIFETIME_USD_CENTS,
                    },
                    occurred_at: occurred,
                    real_tardy_expires_at: (tier == VerificationTier::RealTardy)
                        .then_some(occurred + Duration::days(32)),
                    payload_digest: &digest(payload),
                })
                .await?;
            if let Some(reservation) = reservation {
                sqlx::query(
                    "UPDATE super_tardy_checkout_reservations SET completed_at=now() WHERE id=$1",
                )
                .bind(reservation)
                .execute(&self.pool)
                .await?;
            }
        } else if event_type == "customer.subscription.updated" {
            let object = &event["data"]["object"];
            if text(object, "/metadata/tier")? == "real_tardy" {
                let profile_id = Uuid::parse_str(text(object, "/metadata/profile_id")?)
                    .map_err(|_| BillingError::Invalid("Stripe profile id"))?;
                let occurred = stripe_event_time(&event)?;
                let expires_at = DateTime::from_timestamp(
                    object["current_period_end"]
                        .as_i64()
                        .ok_or(BillingError::Invalid("Stripe subscription period"))?,
                    0,
                )
                .ok_or(BillingError::Invalid("Stripe subscription timestamp"))?;
                self.verification
                    .settle(SettledVerificationPayment {
                        provider: "stripe",
                        provider_event_id: event_id,
                        provider_reference: text(object, "/id")?,
                        profile_id,
                        tier: VerificationTier::RealTardy,
                        amount_cents: REAL_TARDY_MONTHLY_USD_CENTS,
                        occurred_at: occurred,
                        real_tardy_expires_at: Some(expires_at),
                        payload_digest: &digest(payload),
                    })
                    .await?;
            }
        } else if event_type == "customer.subscription.deleted" {
            self.verification
                .revoke_provider_reference("stripe", text(&event["data"]["object"], "/id")?)
                .await?;
        }
        sqlx::query("INSERT INTO stripe_webhook_events (event_id,event_type,payload_digest) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING")
            .bind(event_id).bind(event_type).bind(digest(payload)).execute(&self.pool).await?;
        Ok(())
    }
}

fn checkout_form(
    stripe: &StripeConfig,
    profile_id: Uuid,
    tier: VerificationTier,
    mode: &str,
    price: &str,
    customer: Option<&str>,
    reservation: Option<Uuid>,
) -> String {
    let profile = profile_id.to_string();
    let mut form = url::form_urlencoded::Serializer::new(String::new());
    form.append_pair("mode", mode)
        .append_pair("line_items[0][price]", price)
        .append_pair("line_items[0][quantity]", "1")
        .append_pair("client_reference_id", &profile)
        .append_pair("metadata[profile_id]", &profile)
        .append_pair("metadata[tier]", tier_name(tier))
        .append_pair(
            "success_url",
            &format!(
                "{}/verify.html?checkout=success",
                stripe.public_web_url.trim_end_matches('/')
            ),
        )
        .append_pair(
            "cancel_url",
            &format!(
                "{}/verify.html?checkout=cancelled",
                stripe.public_web_url.trim_end_matches('/')
            ),
        );
    if let Some(customer) = customer {
        form.append_pair("customer", customer);
    } else if tier == VerificationTier::SuperTardy {
        form.append_pair("customer_creation", "always");
    }
    if let Some(reservation) = reservation {
        form.append_pair("metadata[reservation_id]", &reservation.to_string());
    }
    if tier == VerificationTier::RealTardy {
        form.append_pair("subscription_data[metadata][profile_id]", &profile)
            .append_pair("subscription_data[metadata][tier]", tier_name(tier));
    }
    form.finish()
}

fn required_env(name: &'static str) -> Result<String, BillingError> {
    std::env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or(BillingError::Invalid(name))
}
fn opaque_token() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}
fn digest(value: &[u8]) -> Vec<u8> {
    Sha256::digest(value).to_vec()
}
fn tier_name(tier: VerificationTier) -> &'static str {
    match tier {
        VerificationTier::RealTardy => "real_tardy",
        VerificationTier::SuperTardy => "super_tardy",
    }
}
fn parse_tier(value: &str) -> Result<VerificationTier, BillingError> {
    match value {
        "real_tardy" => Ok(VerificationTier::RealTardy),
        "super_tardy" => Ok(VerificationTier::SuperTardy),
        _ => Err(BillingError::Invalid("verification tier")),
    }
}
fn text<'a>(value: &'a Value, pointer: &str) -> Result<&'a str, BillingError> {
    value
        .pointer(pointer)
        .and_then(Value::as_str)
        .ok_or(BillingError::Invalid("Stripe field"))
}
fn stripe_event_time(event: &Value) -> Result<DateTime<Utc>, BillingError> {
    DateTime::from_timestamp(
        event["created"]
            .as_i64()
            .ok_or(BillingError::Invalid("Stripe created"))?,
        0,
    )
    .ok_or(BillingError::Invalid("Stripe timestamp"))
}
fn provider(error: reqwest::Error) -> BillingError {
    BillingError::Provider(error.to_string())
}

fn verify_stripe_signature(
    secret: &[u8],
    header: &str,
    payload: &[u8],
) -> Result<(), BillingError> {
    let mut timestamp = None;
    let mut signatures = Vec::new();
    for part in header.split(',') {
        let Some((key, value)) = part.split_once('=') else {
            continue;
        };
        match key {
            "t" => timestamp = value.parse::<i64>().ok(),
            "v1" => signatures.push(value),
            _ => {}
        }
    }
    let timestamp = timestamp.ok_or(BillingError::Invalid("Stripe signature timestamp"))?;
    if (Utc::now().timestamp() - timestamp).abs() > 300 {
        return Err(BillingError::Invalid("stale Stripe signature"));
    }
    let mut signed = timestamp.to_string().into_bytes();
    signed.push(b'.');
    signed.extend_from_slice(payload);
    let mut mac = Hmac::<Sha256>::new_from_slice(secret)
        .map_err(|_| BillingError::Invalid("Stripe webhook secret"))?;
    mac.update(&signed);
    signatures
        .into_iter()
        .find_map(decode_hex)
        .filter(|candidate| mac.clone().verify_slice(candidate).is_ok())
        .map(|_| ())
        .ok_or(BillingError::Invalid("Stripe signature"))
}
fn decode_hex(value: &str) -> Option<Vec<u8>> {
    if !value.len().is_multiple_of(2) {
        return None;
    }
    (0..value.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&value[i..i + 2], 16).ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stripe_signature_is_checked_with_tolerance() {
        let payload = br#"{"id":"evt_1"}"#;
        let now = Utc::now().timestamp();
        let mut mac = Hmac::<Sha256>::new_from_slice(b"whsec_test").unwrap();
        mac.update(format!("{now}.").as_bytes());
        mac.update(payload);
        let hex = mac
            .finalize()
            .into_bytes()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>();
        assert!(
            verify_stripe_signature(b"whsec_test", &format!("t={now},v1={hex}"), payload).is_ok()
        );
        assert!(verify_stripe_signature(b"wrong", &format!("t={now},v1={hex}"), payload).is_err());
    }
}
