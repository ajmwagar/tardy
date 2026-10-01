use crate::onboarding::{Account, AiConsent, ClaimCode, ClaimedAccount, TemporaryTardyAccount};
use chrono::{DateTime, TimeZone, Utc};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use uuid::Uuid;

const HUMAN_CLAIM_TTL_MS: u64 = 24 * 60 * 60 * 1_000;
const TARDY_CLAIM_TTL_MS: u64 = 72 * 60 * 60 * 1_000;

#[derive(Debug, thiserror::Error)]
pub enum PgAccountError {
    #[error("account database: {0}")]
    Database(#[from] sqlx::Error),
    #[error("claim code is invalid or expired")]
    InvalidClaim,
    #[error("email already has an account")]
    EmailConflict,
    #[error("email address is invalid")]
    InvalidEmail,
    #[error("timestamp is outside the supported range")]
    Timestamp,
}

#[derive(Clone)]
pub struct PgAccountStore {
    pool: PgPool,
}

impl PgAccountStore {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn issue_human_claim(&self, now_ms: u64) -> Result<ClaimCode, PgAccountError> {
        let code = Uuid::new_v4().simple().to_string();
        let expires_at_ms = now_ms
            .checked_add(HUMAN_CLAIM_TTL_MS)
            .ok_or(PgAccountError::Timestamp)?;
        sqlx::query("INSERT INTO durable_claim_codes (code_hash,kind,expires_at,created_at) VALUES ($1,'human_signup',$2,$3)")
            .bind(hash(&code)).bind(timestamp(expires_at_ms)?).bind(timestamp(now_ms)?).execute(&self.pool).await?;
        Ok(ClaimCode {
            code,
            expires_at_ms,
        })
    }

    pub async fn claim_human(
        &self,
        code: &str,
        email: &str,
        now_ms: u64,
    ) -> Result<ClaimedAccount, PgAccountError> {
        let email = normalize_email(email)?;
        let now = timestamp(now_ms)?;
        let mut tx = self.pool.begin().await?;
        let claimed = sqlx::query("UPDATE durable_claim_codes SET claimed_at=$1 WHERE code_hash=$2 AND kind='human_signup' AND claimed_at IS NULL AND expires_at>$1 RETURNING code_hash")
            .bind(now).bind(hash(code)).fetch_optional(&mut *tx).await?;
        if claimed.is_none() {
            return Err(PgAccountError::InvalidClaim);
        }
        let account = Account {
            id: Uuid::new_v4(),
            email,
            created_at_ms: now_ms,
        };
        let token = new_token();
        let inserted = sqlx::query("INSERT INTO durable_accounts (id,email,kind,temporary,created_at) VALUES ($1,$2,'human',false,$3)")
            .bind(account.id).bind(&account.email).bind(now).execute(&mut *tx).await;
        if let Err(error) = inserted {
            if error
                .as_database_error()
                .and_then(|value| value.code())
                .as_deref()
                == Some("23505")
            {
                return Err(PgAccountError::EmailConflict);
            }
            return Err(error.into());
        }
        sqlx::query("INSERT INTO account_api_tokens (id,account_id,token_hash,created_at) VALUES ($1,$2,$3,$4)")
            .bind(Uuid::new_v4()).bind(account.id).bind(hash(&token)).bind(now).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(ClaimedAccount {
            account,
            api_token: token,
        })
    }

    pub async fn register_tardy(
        &self,
        now_ms: u64,
    ) -> Result<TemporaryTardyAccount, PgAccountError> {
        let account_id = Uuid::new_v4();
        let api_token = new_token();
        let claim_code = Uuid::new_v4().simple().to_string();
        let expires_at_ms = now_ms
            .checked_add(TARDY_CLAIM_TTL_MS)
            .ok_or(PgAccountError::Timestamp)?;
        let now = timestamp(now_ms)?;
        let expires = timestamp(expires_at_ms)?;
        let mut tx = self.pool.begin().await?;
        sqlx::query("INSERT INTO durable_accounts (id,kind,temporary,expires_at,created_at) VALUES ($1,'agent',true,$2,$3)").bind(account_id).bind(expires).bind(now).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO account_api_tokens (id,account_id,token_hash,expires_at,created_at) VALUES ($1,$2,$3,$4,$5)").bind(Uuid::new_v4()).bind(account_id).bind(hash(&api_token)).bind(expires).bind(now).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO durable_claim_codes (code_hash,kind,subject_account_id,expires_at,created_at) VALUES ($1,'tardy_claim',$2,$3,$4)").bind(hash(&claim_code)).bind(account_id).bind(expires).bind(now).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(TemporaryTardyAccount {
            account_id,
            api_token,
            claim_code,
            expires_at_ms,
        })
    }

    pub async fn claim_tardy(
        &self,
        human: Uuid,
        code: &str,
        now_ms: u64,
    ) -> Result<Vec<Uuid>, PgAccountError> {
        let now = timestamp(now_ms)?;
        let mut tx = self.pool.begin().await?;
        let row = sqlx::query("SELECT subject_account_id FROM durable_claim_codes WHERE code_hash=$1 AND kind='tardy_claim' AND claimed_at IS NULL AND expires_at>$2 FOR UPDATE")
            .bind(hash(code)).bind(now).fetch_optional(&mut *tx).await?;
        let agent: Uuid = row
            .ok_or(PgAccountError::InvalidClaim)?
            .try_get("subject_account_id")?;
        let profiles: Vec<Uuid> = sqlx::query_scalar("SELECT profile_id FROM profile_ownership WHERE owner_account_id=$1 ORDER BY profile_id").bind(agent).fetch_all(&mut *tx).await?;
        if profiles.is_empty() {
            return Err(PgAccountError::InvalidClaim);
        }
        sqlx::query("UPDATE profile_ownership SET owner_account_id=$1 WHERE owner_account_id=$2")
            .bind(human)
            .bind(agent)
            .execute(&mut *tx)
            .await?;
        sqlx::query("UPDATE durable_accounts SET temporary=false,expires_at=NULL WHERE id=$1")
            .bind(agent)
            .execute(&mut *tx)
            .await?;
        sqlx::query("UPDATE account_api_tokens SET expires_at=NULL WHERE account_id=$1 AND revoked_at IS NULL").bind(agent).execute(&mut *tx).await?;
        sqlx::query("UPDATE durable_claim_codes SET claimed_at=$1,claimed_by_account_id=$2 WHERE code_hash=$3").bind(now).bind(human).bind(hash(code)).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(profiles)
    }

    pub async fn authenticate(&self, token: &str, now_ms: u64) -> Result<Uuid, PgAccountError> {
        sqlx::query_scalar("SELECT account_id FROM account_api_tokens WHERE token_hash=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>$2)")
            .bind(hash(token)).bind(timestamp(now_ms)?).fetch_optional(&self.pool).await?.ok_or(PgAccountError::InvalidClaim)
    }

    pub async fn bind_profile(&self, account: Uuid, profile: Uuid) -> Result<(), PgAccountError> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("INSERT INTO profile_ownership (profile_id,owner_account_id) VALUES ($1,$2)")
            .bind(profile)
            .bind(account)
            .execute(&mut *tx)
            .await?;
        sqlx::query("INSERT INTO profile_actors (profile_id,actor_account_id) VALUES ($1,$2)")
            .bind(profile)
            .bind(account)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn owns_profile(&self, account: Uuid, profile: Uuid) -> Result<bool, PgAccountError> {
        Ok(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM profile_ownership WHERE owner_account_id=$1 AND profile_id=$2)").bind(account).bind(profile).fetch_one(&self.pool).await?)
    }
    pub async fn can_act(&self, account: Uuid, profile: Uuid) -> Result<bool, PgAccountError> {
        Ok(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM profile_actors WHERE actor_account_id=$1 AND profile_id=$2)").bind(account).bind(profile).fetch_one(&self.pool).await?)
    }
    pub async fn is_temporary(&self, account: Uuid) -> Result<bool, PgAccountError> {
        sqlx::query_scalar("SELECT temporary FROM durable_accounts WHERE id=$1")
            .bind(account)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(PgAccountError::InvalidClaim)
    }
    pub async fn purge_expired(&self, now_ms: u64) -> Result<Vec<Uuid>, PgAccountError> {
        let mut tx = self.pool.begin().await?;
        let profiles = sqlx::query_scalar("SELECT p.profile_id FROM profile_ownership p JOIN durable_accounts a ON a.id=p.owner_account_id WHERE a.temporary AND a.expires_at<=$1 ORDER BY p.profile_id FOR UPDATE OF a")
            .bind(timestamp(now_ms)?).fetch_all(&mut *tx).await?;
        sqlx::query("DELETE FROM durable_accounts WHERE temporary AND expires_at<=$1")
            .bind(timestamp(now_ms)?)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(profiles)
    }

    pub async fn grant_consent(
        &self,
        account: Uuid,
        provider: &str,
        purpose: &str,
        policy: &str,
        at_ms: u64,
    ) -> Result<AiConsent, PgAccountError> {
        sqlx::query("INSERT INTO durable_ai_consents (account_id,provider,purpose,policy_version,granted_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (account_id,provider,purpose) DO UPDATE SET policy_version=excluded.policy_version,granted_at=excluded.granted_at,revoked_at=NULL")
            .bind(account).bind(provider).bind(purpose).bind(policy).bind(timestamp(at_ms)?).execute(&self.pool).await?;
        Ok(AiConsent {
            provider: provider.into(),
            purpose: purpose.into(),
            policy_version: policy.into(),
            granted_at_ms: at_ms,
        })
    }
    pub async fn revoke_consent(
        &self,
        account: Uuid,
        provider: &str,
        purpose: &str,
        at_ms: u64,
    ) -> Result<(), PgAccountError> {
        sqlx::query("UPDATE durable_ai_consents SET revoked_at=$1 WHERE account_id=$2 AND provider=$3 AND purpose=$4 AND revoked_at IS NULL").bind(timestamp(at_ms)?).bind(account).bind(provider).bind(purpose).execute(&self.pool).await?;
        Ok(())
    }
    pub async fn has_consent(
        &self,
        account: Uuid,
        provider: &str,
        purpose: &str,
        policy: &str,
    ) -> Result<bool, PgAccountError> {
        Ok(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM durable_ai_consents WHERE account_id=$1 AND provider=$2 AND purpose=$3 AND policy_version=$4 AND revoked_at IS NULL)").bind(account).bind(provider).bind(purpose).bind(policy).fetch_one(&self.pool).await?)
    }
}

fn new_token() -> String {
    format!("tardy_{}", Uuid::new_v4().simple())
}
fn hash(value: &str) -> Vec<u8> {
    Sha256::digest(value.as_bytes()).to_vec()
}
fn timestamp(ms: u64) -> Result<DateTime<Utc>, PgAccountError> {
    Utc.timestamp_millis_opt(i64::try_from(ms).map_err(|_| PgAccountError::Timestamp)?)
        .single()
        .ok_or(PgAccountError::Timestamp)
}
fn normalize_email(value: &str) -> Result<String, PgAccountError> {
    let value = value.trim().to_ascii_lowercase();
    let valid = value.len() <= 254
        && value.split_once('@').is_some_and(|(local, domain)| {
            !local.is_empty() && domain.contains('.') && !domain.ends_with('.')
        });
    valid.then_some(value).ok_or(PgAccountError::InvalidEmail)
}
