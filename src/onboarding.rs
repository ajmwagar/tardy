use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::Path;
use std::sync::Mutex;
use utoipa::ToSchema;
use uuid::Uuid;

const CLAIM_TTL_MS: u64 = 24 * 60 * 60 * 1_000;
const UNCLAIMED_TARDY_TTL_MS: u64 = 72 * 60 * 60 * 1_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ClaimCode {
    /// Returned exactly once. Only its SHA-256 digest is persisted.
    pub code: String,
    pub expires_at_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Account {
    pub id: Uuid,
    pub email: String,
    pub created_at_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ClaimedAccount {
    pub account: Account,
    /// Returned exactly once. Only its digest is persisted.
    pub api_token: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct TemporaryTardyAccount {
    pub account_id: Uuid,
    pub api_token: String,
    pub claim_code: String,
    pub expires_at_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AiConsent {
    pub provider: String,
    pub purpose: String,
    pub policy_version: String,
    pub granted_at_ms: u64,
}

#[derive(Debug, thiserror::Error)]
pub enum OnboardingError {
    #[error("onboarding database: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("onboarding database lock poisoned")]
    Poisoned,
    #[error("claim code is invalid or expired")]
    InvalidClaim,
    #[error("email already has an account")]
    EmailConflict,
    #[error("email address is invalid")]
    InvalidEmail,
    #[error("timestamp overflow")]
    TimestampOverflow,
}

pub struct AccountRegistry {
    connection: Mutex<Connection>,
}

impl AccountRegistry {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, OnboardingError> {
        let connection = Connection::open(path)?;
        Self::from_connection(connection)
    }

    pub fn in_memory() -> Result<Self, OnboardingError> {
        Self::from_connection(Connection::open_in_memory()?)
    }

    fn from_connection(connection: Connection) -> Result<Self, OnboardingError> {
        connection.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE IF NOT EXISTS agent_claims (
               code_hash BLOB PRIMARY KEY,
               expires_at_ms INTEGER NOT NULL,
               claimed_at_ms INTEGER,
               account_id TEXT
             );
             CREATE TABLE IF NOT EXISTS accounts (
               id TEXT PRIMARY KEY,
               email TEXT NOT NULL UNIQUE,
               created_at_ms INTEGER NOT NULL,
               api_token_hash BLOB NOT NULL,
               temporary INTEGER NOT NULL DEFAULT 0,
               expires_at_ms INTEGER
             );
             CREATE TABLE IF NOT EXISTS account_profiles (
               account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
               profile_id TEXT NOT NULL UNIQUE,
               PRIMARY KEY (account_id, profile_id)
             );
             CREATE TABLE IF NOT EXISTS external_ai_consents (
               account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
               provider TEXT NOT NULL,
               purpose TEXT NOT NULL,
               policy_version TEXT NOT NULL,
               granted_at_ms INTEGER NOT NULL,
               revoked_at_ms INTEGER,
               PRIMARY KEY (account_id, provider, purpose)
             );",
        )?;
        ensure_column(
            &connection,
            "accounts",
            "temporary",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        ensure_column(&connection, "accounts", "expires_at_ms", "INTEGER")?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn register_tardy(&self, now_ms: u64) -> Result<TemporaryTardyAccount, OnboardingError> {
        let account_id = Uuid::new_v4();
        let api_token = format!("tardy_{}", Uuid::new_v4().simple());
        let claim_code = Uuid::new_v4().simple().to_string();
        let expires_at_ms = now_ms
            .checked_add(UNCLAIMED_TARDY_TTL_MS)
            .ok_or(OnboardingError::TimestampOverflow)?;
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| OnboardingError::Poisoned)?;
        let tx = connection.transaction()?;
        tx.execute("INSERT INTO accounts (id,email,created_at_ms,api_token_hash,temporary,expires_at_ms) VALUES (?1,?2,?3,?4,1,?5)", params![account_id.to_string(), format!("unclaimed+{account_id}@tardy.invalid"), to_i64(now_ms)?, hash_code(&api_token), to_i64(expires_at_ms)?])?;
        tx.execute(
            "INSERT INTO agent_claims (code_hash,expires_at_ms,account_id) VALUES (?1,?2,?3)",
            params![
                hash_code(&claim_code),
                to_i64(expires_at_ms)?,
                account_id.to_string()
            ],
        )?;
        tx.commit()?;
        Ok(TemporaryTardyAccount {
            account_id,
            api_token,
            claim_code,
            expires_at_ms,
        })
    }

    /// Exchanges a human-created pairing code for the agent's credential exactly once.
    /// Any bootstrap token returned when the pairing was created is rotated away.
    pub fn connect_tardy(
        &self,
        code: &str,
        now_ms: u64,
    ) -> Result<TemporaryTardyAccount, OnboardingError> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| OnboardingError::Poisoned)?;
        let tx = connection.transaction()?;
        let row: Option<(String, i64)> = tx
            .query_row(
                "SELECT c.account_id,c.expires_at_ms FROM agent_claims c
                 JOIN accounts a ON a.id=c.account_id
                 WHERE c.code_hash=?1 AND c.claimed_at_ms IS NULL
                   AND c.expires_at_ms>?2 AND a.temporary=1",
                params![hash_code(code), to_i64(now_ms)?],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let (account_id, expires_at_ms) = row.ok_or(OnboardingError::InvalidClaim)?;
        let has_profile: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM account_profiles WHERE account_id=?1)",
            [&account_id],
            |row| row.get(0),
        )?;
        if has_profile {
            return Err(OnboardingError::InvalidClaim);
        }
        let api_token = format!("tardy_{}", Uuid::new_v4().simple());
        tx.execute(
            "UPDATE accounts SET api_token_hash=?1 WHERE id=?2",
            params![hash_code(&api_token), &account_id],
        )?;
        tx.commit()?;
        Ok(TemporaryTardyAccount {
            account_id: Uuid::parse_str(&account_id).map_err(|_| OnboardingError::InvalidClaim)?,
            api_token,
            claim_code: code.to_owned(),
            expires_at_ms: u64::try_from(expires_at_ms)
                .map_err(|_| OnboardingError::TimestampOverflow)?,
        })
    }

    pub fn claim_tardy(
        &self,
        human_account_id: Uuid,
        code: &str,
        now_ms: u64,
    ) -> Result<Vec<Uuid>, OnboardingError> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| OnboardingError::Poisoned)?;
        let tx = connection.transaction()?;
        let temporary_id: Option<String> = tx.query_row("SELECT c.account_id FROM agent_claims c JOIN accounts a ON a.id=c.account_id WHERE c.code_hash=?1 AND c.claimed_at_ms IS NULL AND c.expires_at_ms>?2 AND a.temporary=1", params![hash_code(code), to_i64(now_ms)?], |row| row.get(0)).optional()?;
        let temporary_id = temporary_id.ok_or(OnboardingError::InvalidClaim)?;
        let profiles: Vec<String> = {
            let mut statement = tx.prepare(
                "SELECT profile_id FROM account_profiles WHERE account_id=?1 ORDER BY profile_id",
            )?;
            statement
                .query_map([&temporary_id], |row| row.get(0))?
                .collect::<Result<_, _>>()?
        };
        if profiles.is_empty() {
            return Err(OnboardingError::InvalidClaim);
        }
        tx.execute(
            "UPDATE account_profiles SET account_id=?1 WHERE account_id=?2",
            params![human_account_id.to_string(), temporary_id],
        )?;
        tx.execute(
            "UPDATE agent_claims SET claimed_at_ms=?1,account_id=?2 WHERE code_hash=?3",
            params![
                to_i64(now_ms)?,
                human_account_id.to_string(),
                hash_code(code)
            ],
        )?;
        tx.execute("DELETE FROM accounts WHERE id=?1", [&temporary_id])?;
        tx.commit()?;
        profiles
            .into_iter()
            .map(|id| Uuid::parse_str(&id).map_err(|_| OnboardingError::InvalidClaim))
            .collect()
    }

    pub fn purge_expired_tardies(&self, now_ms: u64) -> Result<Vec<Uuid>, OnboardingError> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| OnboardingError::Poisoned)?;
        let tx = connection.transaction()?;
        let profiles: Vec<String> = {
            let mut statement = tx.prepare("SELECT p.profile_id FROM account_profiles p JOIN accounts a ON a.id=p.account_id WHERE a.temporary=1 AND a.expires_at_ms<=?1")?;
            statement
                .query_map([to_i64(now_ms)?], |row| row.get(0))?
                .collect::<Result<_, _>>()?
        };
        tx.execute(
            "DELETE FROM accounts WHERE temporary=1 AND expires_at_ms<=?1",
            [to_i64(now_ms)?],
        )?;
        tx.commit()?;
        profiles
            .into_iter()
            .map(|id| Uuid::parse_str(&id).map_err(|_| OnboardingError::InvalidClaim))
            .collect()
    }

    pub fn issue_claim(&self, now_ms: u64) -> Result<ClaimCode, OnboardingError> {
        let code = Uuid::new_v4().simple().to_string();
        let expires_at_ms = now_ms
            .checked_add(CLAIM_TTL_MS)
            .ok_or(OnboardingError::TimestampOverflow)?;
        let connection = self
            .connection
            .lock()
            .map_err(|_| OnboardingError::Poisoned)?;
        connection.execute(
            "INSERT INTO agent_claims (code_hash, expires_at_ms) VALUES (?1, ?2)",
            params![hash_code(&code), to_i64(expires_at_ms)?],
        )?;
        Ok(ClaimCode {
            code,
            expires_at_ms,
        })
    }

    pub fn claim(
        &self,
        code: &str,
        email: &str,
        now_ms: u64,
    ) -> Result<ClaimedAccount, OnboardingError> {
        let email = normalize_email(email)?;
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| OnboardingError::Poisoned)?;
        let tx = connection.transaction()?;
        let claim = tx
            .query_row(
                "SELECT expires_at_ms, claimed_at_ms FROM agent_claims WHERE code_hash = ?1",
                params![hash_code(code)],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<i64>>(1)?)),
            )
            .optional()?;
        let Some((expires_at_ms, claimed_at_ms)) = claim else {
            return Err(OnboardingError::InvalidClaim);
        };
        if claimed_at_ms.is_some() || expires_at_ms <= to_i64(now_ms)? {
            return Err(OnboardingError::InvalidClaim);
        }
        let existing: Option<String> = tx
            .query_row(
                "SELECT id FROM accounts WHERE email = ?1",
                [&email],
                |row| row.get(0),
            )
            .optional()?;
        if existing.is_some() {
            return Err(OnboardingError::EmailConflict);
        }
        let account = Account {
            id: Uuid::new_v4(),
            email,
            created_at_ms: now_ms,
        };
        let api_token = format!("tardy_{}", Uuid::new_v4().simple());
        tx.execute(
            "INSERT INTO accounts (id, email, created_at_ms, api_token_hash) VALUES (?1, ?2, ?3, ?4)",
            params![account.id.to_string(), account.email, to_i64(now_ms)?, hash_code(&api_token)],
        )?;
        tx.execute(
            "UPDATE agent_claims SET claimed_at_ms = ?1, account_id = ?2 WHERE code_hash = ?3",
            params![to_i64(now_ms)?, account.id.to_string(), hash_code(code)],
        )?;
        tx.commit()?;
        Ok(ClaimedAccount { account, api_token })
    }

    pub fn authenticate(&self, api_token: &str) -> Result<Uuid, OnboardingError> {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| OnboardingError::TimestampOverflow)?
            .as_millis()
            .try_into()
            .map_err(|_| OnboardingError::TimestampOverflow)?;
        self.authenticate_at(api_token, now_ms)
    }

    fn authenticate_at(&self, api_token: &str, now_ms: u64) -> Result<Uuid, OnboardingError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| OnboardingError::Poisoned)?;
        let id: Option<String> = connection
            .query_row(
                "SELECT id FROM accounts WHERE api_token_hash = ?1 AND (temporary=0 OR expires_at_ms > ?2)",
                params![hash_code(api_token), to_i64(now_ms)?],
                |row| row.get(0),
            )
            .optional()?;
        id.and_then(|id| Uuid::parse_str(&id).ok())
            .ok_or(OnboardingError::InvalidClaim)
    }

    pub fn bind_profile(&self, account_id: Uuid, profile_id: Uuid) -> Result<(), OnboardingError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| OnboardingError::Poisoned)?;
        connection.execute(
            "INSERT INTO account_profiles (account_id, profile_id) VALUES (?1, ?2)",
            params![account_id.to_string(), profile_id.to_string()],
        )?;
        Ok(())
    }

    pub fn owns_profile(
        &self,
        account_id: Uuid,
        profile_id: Uuid,
    ) -> Result<bool, OnboardingError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| OnboardingError::Poisoned)?;
        let found: Option<i64> = connection
            .query_row(
                "SELECT 1 FROM account_profiles WHERE account_id = ?1 AND profile_id = ?2",
                params![account_id.to_string(), profile_id.to_string()],
                |row| row.get(0),
            )
            .optional()?;
        Ok(found.is_some())
    }

    pub fn is_temporary(&self, account_id: Uuid) -> Result<bool, OnboardingError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| OnboardingError::Poisoned)?;
        let temporary: Option<i64> = connection
            .query_row(
                "SELECT temporary FROM accounts WHERE id=?1",
                [account_id.to_string()],
                |row| row.get(0),
            )
            .optional()?;
        temporary
            .map(|value| value != 0)
            .ok_or(OnboardingError::InvalidClaim)
    }

    pub fn grant_ai_consent(
        &self,
        account_id: Uuid,
        provider: &str,
        purpose: &str,
        policy_version: &str,
        at_ms: u64,
    ) -> Result<AiConsent, OnboardingError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| OnboardingError::Poisoned)?;
        connection.execute(
            "INSERT INTO external_ai_consents
               (account_id, provider, purpose, policy_version, granted_at_ms, revoked_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, NULL)
             ON CONFLICT(account_id, provider, purpose) DO UPDATE SET
               policy_version = excluded.policy_version,
               granted_at_ms = excluded.granted_at_ms,
               revoked_at_ms = NULL",
            params![
                account_id.to_string(),
                provider,
                purpose,
                policy_version,
                to_i64(at_ms)?
            ],
        )?;
        Ok(AiConsent {
            provider: provider.into(),
            purpose: purpose.into(),
            policy_version: policy_version.into(),
            granted_at_ms: at_ms,
        })
    }

    pub fn revoke_ai_consent(
        &self,
        account_id: Uuid,
        provider: &str,
        purpose: &str,
        at_ms: u64,
    ) -> Result<(), OnboardingError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| OnboardingError::Poisoned)?;
        connection.execute(
            "UPDATE external_ai_consents SET revoked_at_ms = ?1
             WHERE account_id = ?2 AND provider = ?3 AND purpose = ?4 AND revoked_at_ms IS NULL",
            params![to_i64(at_ms)?, account_id.to_string(), provider, purpose],
        )?;
        Ok(())
    }

    pub fn has_ai_consent(
        &self,
        account_id: Uuid,
        provider: &str,
        purpose: &str,
        policy_version: &str,
    ) -> Result<bool, OnboardingError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| OnboardingError::Poisoned)?;
        let found: Option<i64> = connection
            .query_row(
                "SELECT 1 FROM external_ai_consents
                 WHERE account_id = ?1 AND provider = ?2 AND purpose = ?3
                   AND policy_version = ?4 AND revoked_at_ms IS NULL",
                params![account_id.to_string(), provider, purpose, policy_version],
                |row| row.get(0),
            )
            .optional()?;
        Ok(found.is_some())
    }
}

fn hash_code(code: &str) -> Vec<u8> {
    Sha256::digest(code.as_bytes()).to_vec()
}

fn ensure_column(
    connection: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), OnboardingError> {
    let exists: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info(?1) WHERE name=?2)",
        params![table, column],
        |row| row.get(0),
    )?;
    if !exists {
        connection.execute_batch(&format!(
            "ALTER TABLE {table} ADD COLUMN {column} {definition}"
        ))?;
    }
    Ok(())
}

fn to_i64(value: u64) -> Result<i64, OnboardingError> {
    value
        .try_into()
        .map_err(|_| OnboardingError::TimestampOverflow)
}

fn normalize_email(value: &str) -> Result<String, OnboardingError> {
    let value = value.trim().to_ascii_lowercase();
    let valid = value.len() <= 254
        && value.split_once('@').is_some_and(|(local, domain)| {
            !local.is_empty() && domain.contains('.') && !domain.ends_with('.')
        });
    valid.then_some(value).ok_or(OnboardingError::InvalidEmail)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claim_is_durable_single_use_and_normalizes_email() {
        let path = std::env::temp_dir().join(format!("tardy-onboarding-{}.sqlite", Uuid::new_v4()));
        let registry = AccountRegistry::open(&path).unwrap();
        let ticket = registry.issue_claim(1_000).unwrap();
        drop(registry);
        let registry = AccountRegistry::open(&path).unwrap();
        let account = registry
            .claim(&ticket.code, " Agent@Example.COM ", 2_000)
            .unwrap();
        assert_eq!(account.account.email, "agent@example.com");
        assert_eq!(
            registry.authenticate(&account.api_token).unwrap(),
            account.account.id
        );
        assert!(matches!(
            registry.claim(&ticket.code, "other@example.com", 3_000),
            Err(OnboardingError::InvalidClaim)
        ));
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn expired_codes_are_rejected() {
        let registry = AccountRegistry::in_memory().unwrap();
        let ticket = registry.issue_claim(10).unwrap();
        assert!(matches!(
            registry.claim(&ticket.code, "agent@example.com", ticket.expires_at_ms),
            Err(OnboardingError::InvalidClaim)
        ));
    }

    #[test]
    fn external_ai_consent_is_versioned_and_revocable() {
        let registry = AccountRegistry::in_memory().unwrap();
        let ticket = registry.issue_claim(1).unwrap();
        let claimed = registry
            .claim(&ticket.code, "search@example.com", 2)
            .unwrap();
        let account = claimed.account.id;
        assert!(
            !registry
                .has_ai_consent(account, "voyage", "search_reranking", "search-v1")
                .unwrap()
        );
        registry
            .grant_ai_consent(account, "voyage", "search_reranking", "search-v1", 3)
            .unwrap();
        assert!(
            registry
                .has_ai_consent(account, "voyage", "search_reranking", "search-v1")
                .unwrap()
        );
        assert!(
            !registry
                .has_ai_consent(account, "voyage", "search_reranking", "search-v2")
                .unwrap()
        );
        registry
            .revoke_ai_consent(account, "voyage", "search_reranking", 4)
            .unwrap();
        assert!(
            !registry
                .has_ai_consent(account, "voyage", "search_reranking", "search-v1")
                .unwrap()
        );
    }

    #[test]
    fn tardy_self_registers_then_transfers_to_a_human() {
        let registry = AccountRegistry::in_memory().unwrap();
        let human = registry
            .claim(
                &registry.issue_claim(1).unwrap().code,
                "owner@example.com",
                2,
            )
            .unwrap();
        let tardy = registry.register_tardy(10).unwrap();
        let profile = Uuid::new_v4();
        registry.bind_profile(tardy.account_id, profile).unwrap();
        assert_eq!(
            registry.authenticate_at(&tardy.api_token, 10).unwrap(),
            tardy.account_id
        );
        assert_eq!(
            registry
                .claim_tardy(human.account.id, &tardy.claim_code, 11)
                .unwrap(),
            vec![profile]
        );
        assert!(registry.owns_profile(human.account.id, profile).unwrap());
        assert!(matches!(
            registry.authenticate(&tardy.api_token),
            Err(OnboardingError::InvalidClaim)
        ));
    }

    #[test]
    fn human_created_pairing_rotates_bootstrap_token_and_connects_once() {
        let registry = AccountRegistry::in_memory().unwrap();
        let pairing = registry.register_tardy(10).unwrap();
        let connected = registry.connect_tardy(&pairing.claim_code, 11).unwrap();
        assert_eq!(connected.account_id, pairing.account_id);
        assert_ne!(connected.api_token, pairing.api_token);
        assert!(matches!(
            registry.authenticate_at(&pairing.api_token, 11),
            Err(OnboardingError::InvalidClaim)
        ));
        assert_eq!(
            registry.authenticate_at(&connected.api_token, 11).unwrap(),
            pairing.account_id
        );
        registry
            .bind_profile(connected.account_id, Uuid::new_v4())
            .unwrap();
        assert!(matches!(
            registry.connect_tardy(&pairing.claim_code, 12),
            Err(OnboardingError::InvalidClaim)
        ));
    }

    #[test]
    fn unclaimed_tardies_expire_after_seventy_two_hours() {
        let registry = AccountRegistry::in_memory().unwrap();
        let tardy = registry.register_tardy(100).unwrap();
        let profile = Uuid::new_v4();
        registry.bind_profile(tardy.account_id, profile).unwrap();
        let expired = registry.purge_expired_tardies(tardy.expires_at_ms).unwrap();
        assert_eq!(expired, vec![profile]);
        assert!(matches!(
            registry.authenticate(&tardy.api_token),
            Err(OnboardingError::InvalidClaim)
        ));
    }
}
