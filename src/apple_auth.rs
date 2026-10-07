use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header, jwk::JwkSet};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

const APPLE_ISSUER: &str = "https://appleid.apple.com";
const APPLE_JWKS_URL: &str = "https://appleid.apple.com/auth/keys";
const KEY_CACHE_TTL: Duration = Duration::from_secs(60 * 60);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedAppleIdentity {
    pub subject: String,
    pub email: Option<String>,
    pub assertion_digest: Vec<u8>,
}

#[derive(Debug, thiserror::Error)]
pub enum AppleAuthError {
    #[error("Apple identity token is invalid")]
    InvalidToken,
    #[error("Apple identity token nonce does not match")]
    InvalidNonce,
    #[error("Apple identity service is unavailable: {0}")]
    Unavailable(String),
}

#[derive(Clone)]
pub struct AppleAuthenticator {
    client_id: String,
    client: reqwest::Client,
    keys: Arc<RwLock<Option<CachedKeys>>>,
}

struct CachedKeys {
    fetched_at: Instant,
    value: JwkSet,
}

#[derive(Debug, Deserialize)]
struct AppleClaims {
    sub: String,
    email: Option<String>,
    email_verified: Option<serde_json::Value>,
    nonce: Option<String>,
    #[allow(dead_code)]
    exp: u64,
}

impl AppleAuthenticator {
    /// The native audience is public app configuration, not a server secret.
    /// Derive it from the shipped client rather than maintaining another default.
    pub fn native_client_id() -> Result<String, AppleAuthError> {
        let app: serde_json::Value = serde_json::from_str(include_str!("../mobile/app.json"))
            .map_err(|_| {
                AppleAuthError::Unavailable("native app configuration is invalid".into())
            })?;
        app.pointer("/expo/ios/bundleIdentifier")
            .and_then(|value| value.as_str())
            .filter(|value| !value.trim().is_empty())
            .map(str::to_owned)
            .ok_or_else(|| AppleAuthError::Unavailable("native Apple audience is missing".into()))
    }

    pub fn new(client_id: impl Into<String>) -> Result<Self, AppleAuthError> {
        let client_id = client_id.into();
        if client_id.trim().is_empty() {
            return Err(AppleAuthError::Unavailable(
                "APPLE_CLIENT_ID is empty".into(),
            ));
        }
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .map_err(|error| AppleAuthError::Unavailable(error.to_string()))?;
        Ok(Self {
            client_id,
            client,
            keys: Arc::new(RwLock::new(None)),
        })
    }

    pub async fn verify(
        &self,
        identity_token: &str,
        raw_nonce: &str,
    ) -> Result<VerifiedAppleIdentity, AppleAuthError> {
        if raw_nonce.len() < 16 || raw_nonce.len() > 256 {
            return Err(AppleAuthError::InvalidNonce);
        }
        let header = decode_header(identity_token).map_err(|_| AppleAuthError::InvalidToken)?;
        if header.alg != Algorithm::RS256 {
            return Err(AppleAuthError::InvalidToken);
        }
        let key_id = header.kid.ok_or(AppleAuthError::InvalidToken)?;
        let keys = self.keys().await?;
        let jwk = keys.find(&key_id).ok_or(AppleAuthError::InvalidToken)?;
        let key = DecodingKey::from_jwk(jwk).map_err(|_| AppleAuthError::InvalidToken)?;
        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_issuer(&[APPLE_ISSUER]);
        validation.set_audience(&[self.client_id.as_str()]);
        let claims = decode::<AppleClaims>(identity_token, &key, &validation)
            .map_err(|_| AppleAuthError::InvalidToken)?
            .claims;

        let expected_nonce = hex_digest(raw_nonce.as_bytes());
        if claims.nonce.as_deref() != Some(expected_nonce.as_str()) {
            return Err(AppleAuthError::InvalidNonce);
        }
        if claims.sub.trim().is_empty() {
            return Err(AppleAuthError::InvalidToken);
        }
        Ok(VerifiedAppleIdentity {
            subject: claims.sub,
            email: claims
                .email
                .filter(|_| claim_is_true(claims.email_verified.as_ref())),
            assertion_digest: Sha256::digest(identity_token.as_bytes()).to_vec(),
        })
    }

    /// Warms Apple's public signing keys without accepting a credential.
    pub async fn prewarm(&self) -> Result<(), AppleAuthError> {
        self.keys().await.map(|_| ())
    }

    async fn keys(&self) -> Result<JwkSet, AppleAuthError> {
        if let Some(keys) = self.cached_keys()? {
            return Ok(keys);
        }
        let keys = self
            .client
            .get(APPLE_JWKS_URL)
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(|error| AppleAuthError::Unavailable(error.to_string()))?
            .json::<JwkSet>()
            .await
            .map_err(|error| AppleAuthError::Unavailable(error.to_string()))?;
        *self
            .keys
            .write()
            .map_err(|_| AppleAuthError::Unavailable("Apple key cache poisoned".into()))? =
            Some(CachedKeys {
                fetched_at: Instant::now(),
                value: keys.clone(),
            });
        Ok(keys)
    }

    fn cached_keys(&self) -> Result<Option<JwkSet>, AppleAuthError> {
        let cache = self
            .keys
            .read()
            .map_err(|_| AppleAuthError::Unavailable("Apple key cache poisoned".into()))?;
        Ok(cache
            .as_ref()
            .filter(|keys| keys.fetched_at.elapsed() < KEY_CACHE_TTL)
            .map(|keys| keys.value.clone()))
    }
}

fn claim_is_true(value: Option<&serde_json::Value>) -> bool {
    matches!(value, Some(serde_json::Value::Bool(true)))
        || matches!(value, Some(serde_json::Value::String(value)) if value == "true")
}

fn hex_digest(value: &[u8]) -> String {
    Sha256::digest(value)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_audience_is_derived_from_the_shipped_client() {
        let app: serde_json::Value =
            serde_json::from_str(include_str!("../mobile/app.json")).unwrap();
        assert_eq!(
            AppleAuthenticator::native_client_id().unwrap(),
            app["expo"]["ios"]["bundleIdentifier"].as_str().unwrap()
        );
        assert!(AppleAuthenticator::new("").is_err());
    }

    #[test]
    fn nonce_digest_matches_lowercase_sha256() {
        assert_eq!(
            hex_digest(b"tardy"),
            "bcefb6744c99226226d4019d61d029907d7e46760f94f8b65cdbbca82f213603"
        );
    }
}
