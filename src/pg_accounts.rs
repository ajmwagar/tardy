use crate::onboarding::{Account, AiConsent, ClaimCode, ClaimedAccount, TemporaryTardyAccount};
use chrono::{DateTime, TimeZone, Utc};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use uuid::Uuid;

const HUMAN_CLAIM_TTL_MS: u64 = 24 * 60 * 60 * 1_000;
const TARDY_CLAIM_TTL_MS: u64 = 72 * 60 * 60 * 1_000;
const HUMAN_SESSION_TTL_MS: u64 = 30 * 24 * 60 * 60 * 1_000;

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
    #[error("identity assertion has already been used")]
    AssertionReplayed,
    #[error("handle must be 3 to 30 lowercase letters, numbers, dots, or underscores")]
    InvalidHandle,
    #[error("handle is already taken")]
    HandleConflict,
    #[error("display name must be 1 to 80 characters")]
    InvalidDisplayName,
    #[error("bio must be at most 500 characters")]
    InvalidBio,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HumanProfile {
    pub account_id: Uuid,
    pub profile_id: Uuid,
    pub handle: String,
    pub display_name: String,
    pub bio: String,
    pub avatar_url: String,
    pub onboarded_at_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HumanSession {
    pub token: String,
    pub provider: String,
    pub expires_at_ms: u64,
    pub profile: HumanProfile,
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
            if is_unique_violation(&error) {
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

    /// Exchanges a short-lived pairing code for a fresh agent credential. A code may
    /// initialize one profile only; claiming ownership remains a separate human action.
    pub async fn connect_tardy(
        &self,
        code: &str,
        now_ms: u64,
    ) -> Result<TemporaryTardyAccount, PgAccountError> {
        let now = timestamp(now_ms)?;
        let mut tx = self.pool.begin().await?;
        let row = sqlx::query(
            "SELECT c.subject_account_id,c.expires_at
             FROM durable_claim_codes c
             JOIN durable_accounts a ON a.id=c.subject_account_id
             WHERE c.code_hash=$1 AND c.kind='tardy_claim' AND c.claimed_at IS NULL
               AND c.expires_at>$2 AND a.temporary=true
             FOR UPDATE",
        )
        .bind(hash(code))
        .bind(now)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(PgAccountError::InvalidClaim)?;
        let account_id: Uuid = row.try_get("subject_account_id")?;
        let expires_at: chrono::DateTime<chrono::Utc> = row.try_get("expires_at")?;
        let has_profile: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM profile_ownership WHERE owner_account_id=$1)",
        )
        .bind(account_id)
        .fetch_one(&mut *tx)
        .await?;
        if has_profile {
            return Err(PgAccountError::InvalidClaim);
        }
        let api_token = new_token();
        sqlx::query("UPDATE account_api_tokens SET revoked_at=$2 WHERE account_id=$1 AND revoked_at IS NULL")
            .bind(account_id)
            .bind(now)
            .execute(&mut *tx)
            .await?;
        sqlx::query("INSERT INTO account_api_tokens (id,account_id,token_hash,expires_at,created_at) VALUES ($1,$2,$3,$4,$5)")
            .bind(Uuid::new_v4()).bind(account_id).bind(hash(&api_token)).bind(expires_at).bind(now).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(TemporaryTardyAccount {
            account_id,
            api_token,
            claim_code: code.to_owned(),
            expires_at_ms: u64::try_from(expires_at.timestamp_millis())
                .map_err(|_| PgAccountError::Timestamp)?,
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
        let token_hash = hash(token);
        let now = timestamp(now_ms)?;
        if let Some(account) = sqlx::query_scalar("SELECT account_id FROM auth_sessions WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>$2")
            .bind(&token_hash).bind(now).fetch_optional(&self.pool).await?
        {
            return Ok(account);
        }
        sqlx::query_scalar("SELECT account_id FROM account_api_tokens WHERE token_hash=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>$2)")
            .bind(token_hash).bind(now).fetch_optional(&self.pool).await?.ok_or(PgAccountError::InvalidClaim)
    }

    pub async fn sign_in_apple(
        &self,
        subject: &str,
        email: Option<&str>,
        display_name: Option<&str>,
        assertion_digest: &[u8],
        now_ms: u64,
    ) -> Result<HumanSession, PgAccountError> {
        let now = timestamp(now_ms)?;
        let expires_at_ms = now_ms
            .checked_add(HUMAN_SESSION_TTL_MS)
            .ok_or(PgAccountError::Timestamp)?;
        let expires = timestamp(expires_at_ms)?;
        let email = email.map(normalize_email).transpose()?;
        let mut tx = self.pool.begin().await?;
        let inserted = sqlx::query("INSERT INTO auth_assertions (provider,assertion_hash,used_at) VALUES ('apple',$1,$2) ON CONFLICT DO NOTHING")
            .bind(assertion_digest).bind(now).execute(&mut *tx).await?;
        if inserted.rows_affected() != 1 {
            return Err(PgAccountError::AssertionReplayed);
        }

        let existing: Option<Uuid> = sqlx::query_scalar(
            "SELECT account_id FROM auth_identities WHERE provider='apple' AND subject=$1",
        )
        .bind(subject)
        .fetch_optional(&mut *tx)
        .await?;
        let account_id = if let Some(account_id) = existing {
            sqlx::query("UPDATE auth_identities SET last_used_at=$1,email=COALESCE($2,email) WHERE provider='apple' AND subject=$3")
                .bind(now).bind(&email).bind(subject).execute(&mut *tx).await?;
            account_id
        } else {
            let matching_email: Option<Uuid> = if let Some(email) = &email {
                sqlx::query_scalar("SELECT id FROM durable_accounts WHERE email=$1 AND kind='human' AND NOT temporary")
                    .bind(email).fetch_optional(&mut *tx).await?
            } else {
                None
            };
            let account_id = matching_email.unwrap_or_else(Uuid::new_v4);
            if matching_email.is_none() {
                sqlx::query("INSERT INTO durable_accounts (id,email,kind,temporary,created_at) VALUES ($1,$2,'human',false,$3)")
                    .bind(account_id).bind(&email).bind(now).execute(&mut *tx).await?;
            }
            sqlx::query("INSERT INTO auth_identities (provider,subject,account_id,email,created_at,last_used_at) VALUES ('apple',$1,$2,$3,$4,$4)")
                .bind(subject).bind(account_id).bind(&email).bind(now).execute(&mut *tx).await?;
            account_id
        };

        let profile = ensure_human_profile(
            &mut tx,
            account_id,
            subject,
            display_name.unwrap_or("Tardy User"),
            now,
        )
        .await?;
        let token = new_token();
        sqlx::query("INSERT INTO auth_sessions (id,account_id,provider,token_hash,expires_at,created_at,last_used_at) VALUES ($1,$2,'apple',$3,$4,$5,$5)")
            .bind(Uuid::new_v4()).bind(account_id).bind(hash(&token)).bind(expires).bind(now).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(HumanSession {
            token,
            provider: "apple".into(),
            expires_at_ms,
            profile,
        })
    }

    pub async fn resume_human_session(
        &self,
        token: &str,
        now_ms: u64,
    ) -> Result<HumanSession, PgAccountError> {
        let now = timestamp(now_ms)?;
        let row = sqlx::query(
            "SELECT s.provider,s.expires_at,p.account_id,p.profile_id,p.handle,p.display_name,p.bio,p.avatar_url,p.onboarded_at
             FROM auth_sessions s JOIN human_profiles p ON p.account_id=s.account_id
             WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>$2",
        )
        .bind(hash(token))
        .bind(now)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(PgAccountError::InvalidClaim)?;
        sqlx::query("UPDATE auth_sessions SET last_used_at=$1 WHERE token_hash=$2")
            .bind(now)
            .bind(hash(token))
            .execute(&self.pool)
            .await?;
        Ok(HumanSession {
            token: token.into(),
            provider: row.try_get("provider")?,
            expires_at_ms: millis(row.try_get("expires_at")?)?,
            profile: human_profile(&row)?,
        })
    }

    pub async fn development_session(
        &self,
        email: &str,
        now_ms: u64,
    ) -> Result<HumanSession, PgAccountError> {
        let now = timestamp(now_ms)?;
        let expires_at_ms = now_ms
            .checked_add(24 * 60 * 60 * 1_000)
            .ok_or(PgAccountError::InvalidClaim)?;
        let expires = timestamp(expires_at_ms)?;
        let mut tx = self.pool.begin().await?;
        let account_id: Uuid = sqlx::query_scalar(
            "SELECT id FROM durable_accounts WHERE email=$1 AND kind='human' AND NOT temporary",
        )
        .bind(email)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(PgAccountError::InvalidClaim)?;
        let mut profile =
            ensure_human_profile(&mut tx, account_id, "dev-preview", "James", now).await?;
        sqlx::query(
            "UPDATE human_profiles SET onboarded_at=COALESCE(onboarded_at,$2) WHERE account_id=$1",
        )
        .bind(account_id)
        .bind(now)
        .execute(&mut *tx)
        .await?;
        profile.onboarded_at_ms = Some(now_ms);
        let token = new_token();
        sqlx::query("INSERT INTO auth_sessions (id,account_id,provider,token_hash,expires_at,created_at,last_used_at) VALUES ($1,$2,'email',$3,$4,$5,$5)")
            .bind(Uuid::new_v4()).bind(account_id).bind(hash(&token)).bind(expires).bind(now).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(HumanSession {
            token,
            provider: "email".into(),
            expires_at_ms,
            profile,
        })
    }

    pub async fn revoke_human_session(
        &self,
        token: &str,
        now_ms: u64,
    ) -> Result<(), PgAccountError> {
        let changed = sqlx::query(
            "UPDATE auth_sessions SET revoked_at=$1 WHERE token_hash=$2 AND revoked_at IS NULL",
        )
        .bind(timestamp(now_ms)?)
        .bind(hash(token))
        .execute(&self.pool)
        .await?;
        if changed.rows_affected() == 1 {
            Ok(())
        } else {
            Err(PgAccountError::InvalidClaim)
        }
    }

    pub async fn human_profile_for_account(
        &self,
        account_id: Uuid,
    ) -> Result<HumanProfile, PgAccountError> {
        let row = sqlx::query("SELECT account_id,profile_id,handle,display_name,bio,avatar_url,onboarded_at FROM human_profiles WHERE account_id=$1")
            .bind(account_id).fetch_optional(&self.pool).await?.ok_or(PgAccountError::InvalidClaim)?;
        human_profile(&row)
    }

    pub async fn set_human_handle(
        &self,
        account_id: Uuid,
        handle: &str,
    ) -> Result<HumanProfile, PgAccountError> {
        let handle = handle.trim().to_ascii_lowercase();
        if !(3..=30).contains(&handle.len())
            || !handle.chars().all(|character| {
                character.is_ascii_lowercase()
                    || character.is_ascii_digit()
                    || matches!(character, '.' | '_')
            })
        {
            return Err(PgAccountError::InvalidHandle);
        }
        let mut tx = self.pool.begin().await?;
        let profile_id: Uuid = sqlx::query_scalar(
            "SELECT profile_id FROM human_profiles WHERE account_id=$1 FOR UPDATE",
        )
        .bind(account_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(PgAccountError::InvalidClaim)?;
        let changed = sqlx::query("UPDATE human_profiles SET handle=$1 WHERE account_id=$2")
            .bind(&handle)
            .bind(account_id)
            .execute(&mut *tx)
            .await;
        if let Err(error) = changed {
            if is_unique_violation(&error) {
                return Err(PgAccountError::HandleConflict);
            }
            return Err(error.into());
        }
        let changed = sqlx::query("UPDATE social_identities SET handle=$1 WHERE profile_id=$2")
            .bind(&handle)
            .bind(profile_id)
            .execute(&mut *tx)
            .await;
        if let Err(error) = changed {
            if is_unique_violation(&error) {
                return Err(PgAccountError::HandleConflict);
            }
            return Err(error.into());
        }
        tx.commit().await?;
        self.human_profile_for_account(account_id).await
    }

    pub async fn update_human_profile(
        &self,
        account_id: Uuid,
        display_name: Option<&str>,
        bio: Option<&str>,
    ) -> Result<HumanProfile, PgAccountError> {
        let display_name = display_name.map(str::trim);
        if display_name.is_some_and(|value| value.is_empty() || value.chars().count() > 80) {
            return Err(PgAccountError::InvalidDisplayName);
        }
        let bio = bio.map(str::trim);
        if bio.is_some_and(|value| value.chars().count() > 500) {
            return Err(PgAccountError::InvalidBio);
        }
        let changed = sqlx::query(
            "UPDATE human_profiles SET display_name=COALESCE($2,display_name),bio=COALESCE($3,bio) WHERE account_id=$1",
        )
        .bind(account_id)
        .bind(display_name)
        .bind(bio)
        .execute(&self.pool)
        .await?;
        if changed.rows_affected() != 1 {
            return Err(PgAccountError::InvalidClaim);
        }
        self.human_profile_for_account(account_id).await
    }

    pub async fn set_human_avatar(
        &self,
        account_id: Uuid,
        avatar_url: &str,
    ) -> Result<HumanProfile, PgAccountError> {
        let changed = sqlx::query("UPDATE human_profiles SET avatar_url=$2 WHERE account_id=$1")
            .bind(account_id)
            .bind(avatar_url)
            .execute(&self.pool)
            .await?;
        if changed.rows_affected() != 1 {
            return Err(PgAccountError::InvalidClaim);
        }
        self.human_profile_for_account(account_id).await
    }

    pub async fn complete_human_onboarding(
        &self,
        account_id: Uuid,
        now_ms: u64,
    ) -> Result<HumanProfile, PgAccountError> {
        let changed = sqlx::query(
            "UPDATE human_profiles SET onboarded_at=COALESCE(onboarded_at,$2) WHERE account_id=$1",
        )
        .bind(account_id)
        .bind(timestamp(now_ms)?)
        .execute(&self.pool)
        .await?;
        if changed.rows_affected() != 1 {
            return Err(PgAccountError::InvalidClaim);
        }
        self.human_profile_for_account(account_id).await
    }

    pub async fn following_profile_ids(
        &self,
        account_id: Uuid,
    ) -> Result<Vec<Uuid>, PgAccountError> {
        sqlx::query_scalar("SELECT f.followed_profile_id FROM profile_follows f JOIN human_profiles p ON p.profile_id=f.follower_profile_id WHERE p.account_id=$1 ORDER BY f.followed_profile_id")
            .bind(account_id).fetch_all(&self.pool).await.map_err(Into::into)
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

    pub async fn actor_profiles(&self, account: Uuid) -> Result<Vec<Uuid>, PgAccountError> {
        Ok(sqlx::query_scalar(
            "SELECT profile_id FROM profile_actors WHERE actor_account_id=$1 ORDER BY profile_id LIMIT 2",
        )
        .bind(account)
        .fetch_all(&self.pool)
        .await?)
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

async fn ensure_human_profile(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    account_id: Uuid,
    subject: &str,
    display_name: &str,
    now: DateTime<Utc>,
) -> Result<HumanProfile, PgAccountError> {
    if let Some(row) = sqlx::query("SELECT account_id,profile_id,handle,display_name,bio,avatar_url,onboarded_at FROM human_profiles WHERE account_id=$1")
        .bind(account_id).fetch_optional(&mut **tx).await?
    {
        return human_profile(&row);
    }
    let profile_id = Uuid::new_v4();
    let digest = Sha256::digest(subject.as_bytes());
    let suffix: String = digest[..6]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    let handle = format!("tardy_{suffix}");
    let display_name: String = display_name
        .trim()
        .chars()
        .filter(|character| !character.is_control())
        .take(80)
        .collect();
    let display_name = if display_name.is_empty() {
        "Tardy User".to_owned()
    } else {
        display_name
    };
    sqlx::query("INSERT INTO human_profiles (account_id,profile_id,handle,display_name,created_at) VALUES ($1,$2,$3,$4,$5)")
        .bind(account_id).bind(profile_id).bind(&handle).bind(&display_name).bind(now).execute(&mut **tx).await?;
    sqlx::query(
        "INSERT INTO profile_ownership (profile_id,owner_account_id,created_at) VALUES ($1,$2,$3)",
    )
    .bind(profile_id)
    .bind(account_id)
    .bind(now)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        "INSERT INTO profile_actors (profile_id,actor_account_id,created_at) VALUES ($1,$2,$3)",
    )
    .bind(profile_id)
    .bind(account_id)
    .bind(now)
    .execute(&mut **tx)
    .await?;
    sqlx::query("INSERT INTO social_identities (profile_id,account_id,handle,kind,created_at) VALUES ($1,$2,$3,'human',$4)")
        .bind(profile_id).bind(account_id).bind(&handle).bind(now).execute(&mut **tx).await?;
    Ok(HumanProfile {
        account_id,
        profile_id,
        handle,
        display_name,
        bio: String::new(),
        avatar_url: String::new(),
        onboarded_at_ms: None,
    })
}

fn human_profile(row: &sqlx::postgres::PgRow) -> Result<HumanProfile, PgAccountError> {
    Ok(HumanProfile {
        account_id: row.try_get("account_id")?,
        profile_id: row.try_get("profile_id")?,
        handle: row.try_get("handle")?,
        display_name: row.try_get("display_name")?,
        bio: row.try_get("bio")?,
        avatar_url: row.try_get("avatar_url")?,
        onboarded_at_ms: row
            .try_get::<Option<DateTime<Utc>>, _>("onboarded_at")?
            .map(millis)
            .transpose()?,
    })
}

fn millis(value: DateTime<Utc>) -> Result<u64, PgAccountError> {
    u64::try_from(value.timestamp_millis()).map_err(|_| PgAccountError::Timestamp)
}
fn hash(value: &str) -> Vec<u8> {
    Sha256::digest(value.as_bytes()).to_vec()
}
fn is_unique_violation(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .and_then(|value| value.code())
        .as_deref()
        == Some("23505")
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
