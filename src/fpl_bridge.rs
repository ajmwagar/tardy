//! FPL linking and scoped activation. No provider or OIDC refresh tokens are persisted.
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use hmac::{Hmac, Mac};
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header, jwk::JwkSet};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use std::time::Duration;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum FplBridgeError {
    #[error("FPL bridge database failure")]
    Database(#[from] sqlx::Error),
    #[error("FPL linking service unavailable")]
    Network(#[from] reqwest::Error),
    #[error("invalid or expired FPL authorization")]
    Invalid,
    #[error("agent bridge activation is not permitted")]
    Forbidden,
    #[error("invalid FPL bridge configuration")]
    Configuration,
}

#[derive(Clone)]
pub struct FplBridgeRuntime {
    pool: PgPool,
    client: reqwest::Client,
    client_id: String,
    client_secret: String,
    signing_secret: String,
    callback_url: String,
    issuer: String,
    bridge_url: String,
}

#[derive(Serialize, ToSchema)]
pub struct FplLinkStart {
    pub authorization_url: String,
}
#[derive(Serialize, ToSchema)]
pub struct FplLinkStatus {
    pub connected: bool,
}
#[derive(Serialize, ToSchema)]
pub struct FplBridgeActivation {
    pub mcp_url: String,
    pub access_token: String,
    pub expires_at_ms: i64,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    id_token: String,
}
#[derive(Deserialize)]
struct IdentityClaims {
    sub: String,
    nonce: Option<String>,
    email: Option<String>,
    email_verified: Option<Value>,
}

impl FplBridgeRuntime {
    pub fn from_env(pool: PgPool) -> Result<Option<Self>, FplBridgeError> {
        let Ok(client_id) = std::env::var("TARDY_FPL_OIDC_CLIENT_ID") else {
            return Ok(None);
        };
        let client_secret = std::env::var("TARDY_FPL_OIDC_CLIENT_SECRET")
            .map_err(|_| FplBridgeError::Configuration)?;
        let signing_secret = std::env::var("TARDY_FPL_BRIDGE_SIGNING_SECRET")
            .map_err(|_| FplBridgeError::Configuration)?;
        let callback_url = std::env::var("TARDY_FPL_OIDC_CALLBACK_URL")
            .map_err(|_| FplBridgeError::Configuration)?;
        let bridge_url =
            std::env::var("TARDY_FPL_BRIDGE_URL").unwrap_or_else(|_| "https://mcp.fpl.dev".into());
        if client_id.is_empty()
            || client_secret.is_empty()
            || signing_secret.len() < 32
            || !valid_origin(&callback_url, true)
            || !valid_origin(&bridge_url, false)
        {
            return Err(FplBridgeError::Configuration);
        }
        Ok(Some(Self {
            pool,
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(10))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
            client_id,
            client_secret,
            signing_secret,
            callback_url,
            issuer: "https://sso.fpl.dev".into(),
            bridge_url: bridge_url.trim_end_matches('/').into(),
        }))
    }

    pub async fn start(&self, owner: Uuid) -> Result<FplLinkStart, FplBridgeError> {
        let human: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM durable_accounts WHERE id=$1 AND kind='human')",
        )
        .bind(owner)
        .fetch_one(&self.pool)
        .await?;
        if !human {
            return Err(FplBridgeError::Forbidden);
        }
        let state = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
        let verifier = self.verifier(&state);
        sqlx::query("DELETE FROM fpl_bridge_link_attempts WHERE expires_at<=now()")
            .execute(&self.pool)
            .await?;
        sqlx::query(
            "INSERT INTO fpl_bridge_link_attempts (state_hash,owner_account_id) VALUES ($1,$2)",
        )
        .bind(Sha256::digest(state.as_bytes()).to_vec())
        .bind(owner)
        .execute(&self.pool)
        .await?;
        let mut url = url::Url::parse(&format!("{}/authorize", self.issuer))
            .map_err(|_| FplBridgeError::Configuration)?;
        url.query_pairs_mut()
            .append_pair("response_type", "code")
            .append_pair("client_id", &self.client_id)
            .append_pair("redirect_uri", &self.callback_url)
            .append_pair(
                "scope",
                "openid email profile mcp:discover mcp:read mcp:write",
            )
            .append_pair("state", &state)
            .append_pair("nonce", &state)
            .append_pair("code_challenge_method", "S256")
            .append_pair(
                "code_challenge",
                &URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes())),
            );
        Ok(FplLinkStart {
            authorization_url: url.into(),
        })
    }

    pub async fn complete(&self, state: &str, code: &str) -> Result<(), FplBridgeError> {
        if state.len() != 64 || code.is_empty() || code.len() > 4096 {
            return Err(FplBridgeError::Invalid);
        }
        let owner: Uuid = sqlx::query_scalar("DELETE FROM fpl_bridge_link_attempts WHERE state_hash=$1 AND expires_at>now() RETURNING owner_account_id")
            .bind(Sha256::digest(state.as_bytes()).to_vec()).fetch_optional(&self.pool).await?.ok_or(FplBridgeError::Invalid)?;
        let token = self
            .client
            .post(format!("{}/token", self.issuer))
            .form(&[
                ("grant_type", "authorization_code"),
                ("client_id", self.client_id.as_str()),
                ("client_secret", self.client_secret.as_str()),
                ("redirect_uri", self.callback_url.as_str()),
                ("code", code),
                ("code_verifier", self.verifier(state).as_str()),
            ])
            .send()
            .await?
            .error_for_status()?
            .json::<TokenResponse>()
            .await?;
        let header = decode_header(&token.id_token).map_err(|_| FplBridgeError::Invalid)?;
        if header.alg != Algorithm::RS256 {
            return Err(FplBridgeError::Invalid);
        }
        let keys = self
            .client
            .get(format!("{}/.well-known/jwks.json", self.issuer))
            .send()
            .await?
            .error_for_status()?
            .json::<JwkSet>()
            .await?;
        let key = keys
            .find(header.kid.as_deref().ok_or(FplBridgeError::Invalid)?)
            .ok_or(FplBridgeError::Invalid)?;
        let key = DecodingKey::from_jwk(key).map_err(|_| FplBridgeError::Invalid)?;
        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_audience(&[&self.client_id]);
        validation.set_issuer(&[&self.issuer]);
        let claims = decode::<IdentityClaims>(&token.id_token, &key, &validation)
            .map_err(|_| FplBridgeError::Invalid)?
            .claims;
        if claims.sub.is_empty()
            || claims.nonce.as_deref() != Some(state)
            || !matches!(claims.email_verified, Some(Value::Bool(true)))
        {
            return Err(FplBridgeError::Invalid);
        }
        let email = claims
            .email
            .filter(|e| !e.is_empty())
            .ok_or(FplBridgeError::Invalid)?;
        let userinfo: Value = self
            .client
            .get(format!("{}/userinfo", self.issuer))
            .bearer_auth(&token.access_token)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        if userinfo["sub"] != claims.sub {
            return Err(FplBridgeError::Invalid);
        }
        // Access/refresh tokens and authorization codes are intentionally discarded here.
        sqlx::query("INSERT INTO fpl_bridge_links (owner_account_id,subject,email) VALUES ($1,$2,$3) ON CONFLICT (owner_account_id) DO UPDATE SET subject=excluded.subject,email=excluded.email,linked_at=now()")
            .bind(owner).bind(claims.sub).bind(email).execute(&self.pool).await?;
        self.sync(owner).await?;
        Ok(())
    }

    pub async fn status(&self, owner: Uuid) -> Result<FplLinkStatus, FplBridgeError> {
        let connected = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM fpl_bridge_links WHERE owner_account_id=$1)",
        )
        .bind(owner)
        .fetch_one(&self.pool)
        .await?;
        Ok(FplLinkStatus { connected })
    }

    pub async fn unlink(&self, owner: Uuid) -> Result<(), FplBridgeError> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM fpl_bridge_links WHERE owner_account_id=$1")
            .bind(owner)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM fpl_bridge_link_attempts WHERE owner_account_id=$1")
            .bind(owner)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM mcp_bridge_agent_grants WHERE connection_id IN (SELECT id FROM mcp_bridge_connections WHERE owner_account_id=$1 AND provider='fpl')")
            .bind(owner).execute(&mut *tx).await?;
        sqlx::query("UPDATE mcp_bridge_connections SET status='revoked',updated_at=now() WHERE owner_account_id=$1 AND provider='fpl'")
            .bind(owner).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn activation(
        &self,
        agent: Uuid,
        connection: Uuid,
        conversation: Uuid,
    ) -> Result<FplBridgeActivation, FplBridgeError> {
        let row = self
            .activation_context(agent, connection, conversation)
            .await?;
        let reference: String = row.try_get("bridge_ref")?;
        let installation = reference
            .strip_prefix("binding://mcp/fpl/")
            .filter(|id| {
                id.starts_with("ci_")
                    && id.len() < 128
                    && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
            })
            .ok_or(FplBridgeError::Forbidden)?;
        let patterns: Vec<String> = row.try_get("tool_patterns")?;
        if patterns.iter().any(|p| p.contains('*') && p != "*") {
            return Err(FplBridgeError::Forbidden);
        }
        let mut patterns = patterns;
        patterns.push("discover".into());
        let grants = patterns
            .iter()
            .map(|p| json!({"kind":"mcp","name":format!("private_mcp:{installation}:{p}")}))
            .collect::<Vec<_>>();
        let now = chrono::Utc::now().timestamp();
        let payload = json!({"iss":"tardy","aud":"fpl-mcp-bridge","sub":row.try_get::<String,_>("subject")?,"user_email":row.try_get::<String,_>("email")?,"run_id":Uuid::new_v4(),"project":"tardy","role":"agent","agent_profile_id":agent,"conversation_id":conversation,"connection_id":connection,"grants":grants,"approval_policy":row.try_get::<String,_>("approval_policy")?,"iat":now,"exp":now+60});
        let access_token = self.sign(&payload)?;
        Ok(FplBridgeActivation {
            mcp_url: format!("{}/mcp/installations/{installation}", self.bridge_url),
            access_token,
            expires_at_ms: (now + 60) * 1000,
        })
    }

    async fn activation_context(
        &self,
        agent: Uuid,
        connection: Uuid,
        conversation: Uuid,
    ) -> Result<sqlx::postgres::PgRow, FplBridgeError> {
        Ok(sqlx::query("SELECT c.bridge_ref,g.tool_patterns,g.approval_policy,l.subject,l.email FROM mcp_bridge_connections c JOIN mcp_bridge_agent_grants g ON g.connection_id=c.id JOIN fpl_bridge_links l ON l.owner_account_id=c.owner_account_id JOIN profile_ownership o ON o.profile_id=g.agent_profile_id AND o.owner_account_id=c.owner_account_id WHERE c.id=$1 AND g.agent_profile_id=$2 AND c.status='connected' AND c.provider='fpl' AND EXISTS(SELECT 1 FROM conversation_participants p WHERE p.conversation_id=$3 AND p.profile_id=$2)")
            .bind(connection).bind(agent).bind(conversation).fetch_optional(&self.pool).await?.ok_or(FplBridgeError::Forbidden)?)
    }

    pub async fn authorize_token(&self, token: &str) -> Result<(), FplBridgeError> {
        let parts = token.split('.').collect::<Vec<_>>();
        if parts.len() != 3 || parts[0] != "v1" || token.len() > 65536 {
            return Err(FplBridgeError::Forbidden);
        }
        let signature = URL_SAFE_NO_PAD
            .decode(parts[2])
            .map_err(|_| FplBridgeError::Forbidden)?;
        let mut mac = Hmac::<Sha256>::new_from_slice(self.signing_secret.as_bytes())
            .map_err(|_| FplBridgeError::Configuration)?;
        mac.update(parts[1].as_bytes());
        mac.verify_slice(&signature)
            .map_err(|_| FplBridgeError::Forbidden)?;
        let value: Value = serde_json::from_slice(
            &URL_SAFE_NO_PAD
                .decode(parts[1])
                .map_err(|_| FplBridgeError::Forbidden)?,
        )
        .map_err(|_| FplBridgeError::Forbidden)?;
        let now = chrono::Utc::now().timestamp();
        let iat = value["iat"].as_i64().ok_or(FplBridgeError::Forbidden)?;
        let exp = value["exp"].as_i64().ok_or(FplBridgeError::Forbidden)?;
        if value["iss"] != "tardy"
            || value["aud"] != "fpl-mcp-bridge"
            || iat > now + 30
            || exp <= now
            || exp <= iat
            || exp - iat > 60
        {
            return Err(FplBridgeError::Forbidden);
        }
        let uuid = |field: &str| {
            value[field]
                .as_str()
                .and_then(|v| Uuid::parse_str(v).ok())
                .ok_or(FplBridgeError::Forbidden)
        };
        if value["grants"] == json!([{"kind":"mcp","name":"private_mcp:catalog"}])
            && value["role"] == "human"
        {
            let row =
                sqlx::query("SELECT subject,email FROM fpl_bridge_links WHERE owner_account_id=$1")
                    .bind(uuid("owner_account_id")?)
                    .fetch_optional(&self.pool)
                    .await?
                    .ok_or(FplBridgeError::Forbidden)?;
            if value["sub"] != row.try_get::<String, _>("subject")?
                || value["user_email"] != row.try_get::<String, _>("email")?
            {
                return Err(FplBridgeError::Forbidden);
            }
            return Ok(());
        }
        let row = self
            .activation_context(
                uuid("agent_profile_id")?,
                uuid("connection_id")?,
                uuid("conversation_id")?,
            )
            .await?;
        if value["sub"] != row.try_get::<String, _>("subject")?
            || value["user_email"] != row.try_get::<String, _>("email")?
            || value["approval_policy"] != row.try_get::<String, _>("approval_policy")?
        {
            return Err(FplBridgeError::Forbidden);
        }
        let reference: String = row.try_get("bridge_ref")?;
        let installation = reference
            .strip_prefix("binding://mcp/fpl/")
            .ok_or(FplBridgeError::Forbidden)?;
        let mut patterns: Vec<String> = row.try_get("tool_patterns")?;
        patterns.push("discover".into());
        let expected = patterns
            .iter()
            .map(|p| json!({"kind":"mcp","name":format!("private_mcp:{installation}:{p}")}))
            .collect::<Vec<_>>();
        if value["grants"] != json!(expected) {
            return Err(FplBridgeError::Forbidden);
        }
        Ok(())
    }

    fn verifier(&self, state: &str) -> String {
        let mut mac = Hmac::<Sha256>::new_from_slice(self.signing_secret.as_bytes())
            .expect("HMAC accepts any key length");
        mac.update(b"tardy-fpl-pkce-v1:");
        mac.update(state.as_bytes());
        URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
    }

    fn sign(&self, value: &Value) -> Result<String, FplBridgeError> {
        let payload = URL_SAFE_NO_PAD
            .encode(serde_json::to_vec(value).map_err(|_| FplBridgeError::Configuration)?);
        let mut mac = Hmac::<Sha256>::new_from_slice(self.signing_secret.as_bytes())
            .map_err(|_| FplBridgeError::Configuration)?;
        mac.update(payload.as_bytes());
        Ok(format!(
            "v1.{payload}.{}",
            URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
        ))
    }

    pub async fn sync(
        &self,
        owner: Uuid,
    ) -> Result<Vec<crate::mcp_bridges::McpBridgeConnection>, FplBridgeError> {
        let row =
            sqlx::query("SELECT subject,email FROM fpl_bridge_links WHERE owner_account_id=$1")
                .bind(owner)
                .fetch_optional(&self.pool)
                .await?
                .ok_or(FplBridgeError::Forbidden)?;
        let now = chrono::Utc::now().timestamp();
        let token=self.sign(&json!({"iss":"tardy","aud":"fpl-mcp-bridge","sub":row.try_get::<String,_>("subject")?,"user_email":row.try_get::<String,_>("email")?,"run_id":Uuid::new_v4(),"role":"human","owner_account_id":owner,"grants":[{"kind":"mcp","name":"private_mcp:catalog"}],"iat":now,"exp":now+60}))?;
        let catalog: Value = self
            .client
            .get(format!("{}/v1/managed-mcp/installations", self.bridge_url))
            .bearer_auth(token)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        let installations = catalog["installations"]
            .as_array()
            .ok_or(FplBridgeError::Invalid)?;
        if installations.len() > 256 {
            return Err(FplBridgeError::Invalid);
        }
        let store = crate::mcp_bridges::PgMcpBridgeStore::new(self.pool.clone());
        let mut imported = Vec::new();
        for item in installations {
            let reference = item["bridge_ref"]
                .as_str()
                .filter(|s| s.starts_with("binding://mcp/fpl/ci_"))
                .ok_or(FplBridgeError::Invalid)?;
            let name = item["display_name"]
                .as_str()
                .ok_or(FplBridgeError::Invalid)?;
            imported.push(
                store
                    .register_connection(owner, "fpl", name, reference, &[])
                    .await
                    .map_err(|_| FplBridgeError::Invalid)?,
            );
        }
        for existing in store
            .list_connections(owner)
            .await
            .map_err(|_| FplBridgeError::Invalid)?
        {
            if existing.provider == "fpl" && !imported.iter().any(|c| c.id == existing.id) {
                store
                    .revoke_connection(owner, existing.id)
                    .await
                    .map_err(|_| FplBridgeError::Invalid)?;
            }
        }
        Ok(imported)
    }
}

fn valid_origin(value: &str, callback: bool) -> bool {
    url::Url::parse(value).is_ok_and(|u| {
        (u.scheme() == "https"
            || (callback
                && u.scheme() == "http"
                && matches!(u.host_str(), Some("localhost" | "127.0.0.1"))))
            && u.username().is_empty()
            && u.password().is_none()
            && u.query().is_none()
            && u.fragment().is_none()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn oidc_callback_verifies_nonce_and_pkce_and_cannot_replay() {
        use std::io::Write;
        use std::process::{Command, Stdio};
        let pool =
            PgPool::connect(&std::env::var("TEST_DATABASE_URL").expect("isolated PG17 required"))
                .await
                .unwrap();
        sqlx::migrate!().run(&pool).await.unwrap();
        let owner = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO durable_accounts (id,email,kind,temporary) VALUES ($1,$2,'human',false)",
        )
        .bind(owner)
        .bind(format!("{owner}@test.invalid"))
        .execute(&pool)
        .await
        .unwrap();
        let generated = Command::new("openssl")
            .args(["genrsa", "2048"])
            .output()
            .unwrap();
        assert!(generated.status.success());
        let key = generated.stdout;
        let mut extract = Command::new("openssl")
            .args(["rsa", "-modulus", "-noout"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        extract.stdin.take().unwrap().write_all(&key).unwrap();
        let modulus = extract.wait_with_output().unwrap();
        assert!(modulus.status.success());
        let hex = String::from_utf8(modulus.stdout).unwrap();
        let hex = hex.trim().strip_prefix("Modulus=").unwrap();
        let bytes = hex
            .as_bytes()
            .chunks_exact(2)
            .map(|p| u8::from_str_radix(std::str::from_utf8(p).unwrap(), 16).unwrap())
            .collect::<Vec<_>>();
        let jwks = json!({"keys":[{"kty":"RSA","alg":"RS256","use":"sig","kid":"test","n":URL_SAFE_NO_PAD.encode(bytes),"e":"AQAB"}]});
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let runtime = FplBridgeRuntime {
            pool: pool.clone(),
            client: reqwest::Client::new(),
            client_id: "test-client".into(),
            client_secret: "client-secret".into(),
            signing_secret: "test-signing-secret-longer-than-32-bytes".into(),
            callback_url: "http://localhost/callback".into(),
            issuer: base.clone(),
            bridge_url: base.clone(),
        };
        let started = runtime.start(owner).await.unwrap();
        let state = url::Url::parse(&started.authorization_url)
            .unwrap()
            .query_pairs()
            .find(|(k, _)| k == "state")
            .unwrap()
            .1
            .into_owned();
        let verifier = runtime.verifier(&state);
        let now = chrono::Utc::now().timestamp();
        let mut header = jsonwebtoken::Header::new(Algorithm::RS256);
        header.kid = Some("test".into());
        let jwt=jsonwebtoken::encode(&header,&json!({"iss":base,"aud":"test-client","sub":format!("oidc-{owner}"),"email":"owner@example.test","email_verified":true,"nonce":state,"exp":now+300,"iat":now}),&jsonwebtoken::EncodingKey::from_rsa_pem(&key).unwrap()).unwrap();
        let subject = format!("oidc-{owner}");
        let app = axum::Router::new()
            .route(
                "/token",
                axum::routing::post(
                    move |axum::extract::Form(form): axum::extract::Form<
                        std::collections::HashMap<String, String>,
                    >| {
                        let jwt = jwt.clone();
                        let verifier = verifier.clone();
                        async move {
                            if form["code"] == "good-code" {
                                assert_eq!(form["code_verifier"], verifier);
                            }
                            assert_eq!(form["client_secret"], "client-secret");
                            axum::Json(json!({"access_token":"transient-only","id_token":jwt}))
                        }
                    },
                ),
            )
            .route(
                "/.well-known/jwks.json",
                axum::routing::get(move || {
                    let jwks = jwks.clone();
                    async move { axum::Json(jwks) }
                }),
            )
            .route(
                "/userinfo",
                axum::routing::get(move |headers: axum::http::HeaderMap| {
                    let subject = subject.clone();
                    async move {
                        assert_eq!(headers["authorization"], "Bearer transient-only");
                        axum::Json(json!({"sub":subject}))
                    }
                }),
            )
            .route(
                "/v1/managed-mcp/installations",
                axum::routing::get(|| async { axum::Json(json!({"installations":[]})) }),
            );
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        runtime.complete(&state, "good-code").await.unwrap();
        assert!(runtime.status(owner).await.unwrap().connected);
        assert!(matches!(
            runtime.complete(&state, "good-code").await,
            Err(FplBridgeError::Invalid)
        ));
        let different = runtime.start(owner).await.unwrap();
        let different = url::Url::parse(&different.authorization_url)
            .unwrap()
            .query_pairs()
            .find(|(k, _)| k == "state")
            .unwrap()
            .1
            .into_owned();
        assert_ne!(state, different);
        assert!(matches!(
            runtime.complete(&different, "wrong-nonce").await,
            Err(FplBridgeError::Invalid)
        ));
        server.abort();
    }
    use crate::{
        mcp_bridges::PgMcpBridgeStore,
        social::{IdentityKind, PgSocialStore},
    };

    #[tokio::test]
    async fn linked_activation_rechecks_grants_membership_and_unlink() {
        let url =
            std::env::var("TEST_DATABASE_URL").expect("isolated PG17 TEST_DATABASE_URL required");
        let pool = PgPool::connect(&url).await.unwrap();
        sqlx::migrate!().run(&pool).await.unwrap();
        let owner = Uuid::new_v4();
        let human = Uuid::new_v4();
        let agent = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO durable_accounts (id,email,kind,temporary) VALUES ($1,$2,'human',false)",
        )
        .bind(owner)
        .bind(format!("{owner}@test.invalid"))
        .execute(&pool)
        .await
        .unwrap();
        let social = PgSocialStore::new(pool.clone());
        social
            .register_identity(
                owner,
                human,
                &format!("h{}", &human.simple().to_string()[..12]),
                IdentityKind::Human,
                "Owner",
                "",
            )
            .await
            .unwrap();
        social
            .register_identity(
                owner,
                agent,
                &format!("a{}", &agent.simple().to_string()[..12]),
                IdentityKind::Agent,
                "Agent",
                "",
            )
            .await
            .unwrap();
        sqlx::query("INSERT INTO profile_ownership (owner_account_id,profile_id) VALUES ($1,$2)")
            .bind(owner)
            .bind(agent)
            .execute(&pool)
            .await
            .unwrap();
        let conversation = social.create_conversation(human, agent).await.unwrap();
        let runtime = FplBridgeRuntime {
            pool: pool.clone(),
            client: reqwest::Client::new(),
            client_id: "test-client".into(),
            client_secret: "test-secret".into(),
            signing_secret: "test-signing-secret-longer-than-32-bytes".into(),
            callback_url: "http://localhost/callback".into(),
            issuer: "https://sso.fpl.dev".into(),
            bridge_url: "https://mcp.fpl.dev".into(),
        };
        let started = runtime.start(owner).await.unwrap();
        let url = url::Url::parse(&started.authorization_url).unwrap();
        let pairs = url
            .query_pairs()
            .collect::<std::collections::HashMap<_, _>>();
        let state = pairs.get("state").unwrap();
        assert_eq!(pairs["code_challenge_method"], "S256");
        assert_eq!(
            pairs["code_challenge"],
            URL_SAFE_NO_PAD.encode(Sha256::digest(runtime.verifier(state).as_bytes()))
        );
        assert_ne!(runtime.verifier(state), runtime.verifier("other-state"));
        let bridges = PgMcpBridgeStore::new(pool.clone());
        let bridge = bridges
            .register_connection(
                owner,
                "fpl",
                "Apps",
                &format!("binding://mcp/fpl/ci_{}", owner.simple()),
                &[],
            )
            .await
            .unwrap();
        bridges
            .grant_agent(owner, bridge.id, agent, &["search".into()], "read_auto")
            .await
            .unwrap();
        assert!(matches!(
            runtime.activation(agent, bridge.id, conversation.id).await,
            Err(FplBridgeError::Forbidden)
        ));
        sqlx::query(
            "INSERT INTO fpl_bridge_links (owner_account_id,subject,email) VALUES ($1,$2,$3)",
        )
        .bind(owner)
        .bind(format!("sub-{owner}"))
        .bind("owner@example.test")
        .execute(&pool)
        .await
        .unwrap();
        let token = runtime
            .activation(agent, bridge.id, conversation.id)
            .await
            .unwrap();
        runtime.authorize_token(&token.access_token).await.unwrap();
        assert!(
            runtime
                .authorize_token(&format!("{}x", token.access_token))
                .await
                .is_err()
        );
        bridges
            .grant_agent(owner, bridge.id, agent, &["different".into()], "ask")
            .await
            .unwrap();
        assert!(runtime.authorize_token(&token.access_token).await.is_err());
        let next = runtime
            .activation(agent, bridge.id, conversation.id)
            .await
            .unwrap();
        sqlx::query(
            "DELETE FROM conversation_participants WHERE conversation_id=$1 AND profile_id=$2",
        )
        .bind(conversation.id)
        .bind(agent)
        .execute(&pool)
        .await
        .unwrap();
        assert!(runtime.authorize_token(&next.access_token).await.is_err());
        runtime.unlink(owner).await.unwrap();
        assert!(!runtime.status(owner).await.unwrap().connected);
        assert!(bridges.list_connections(owner).await.unwrap().is_empty());
        let pending: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM fpl_bridge_link_attempts WHERE owner_account_id=$1",
        )
        .bind(owner)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(pending, 0);
    }
}
