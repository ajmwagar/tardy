//! Identity-only GitHub OAuth. Tokens are never stored or returned to clients.
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::time::Duration;

#[derive(Clone)]
pub struct GithubAuthenticator {
    client: reqwest::Client,
    client_id: String,
    client_secret: String,
    redirect_uri: String,
}

#[derive(Deserialize)]
pub struct GithubIdentity {
    pub id: u64,
    pub login: String,
    pub name: Option<String>,
}

impl GithubAuthenticator {
    pub fn new(
        client_id: String,
        client_secret: String,
        redirect_uri: String,
    ) -> Result<Self, String> {
        let uri = url::Url::parse(&redirect_uri).map_err(|_| "invalid GitHub callback URL")?;
        if client_id.trim().is_empty()
            || client_secret.trim().is_empty()
            || uri.scheme() != "https"
            || uri.host_str().is_none()
            || !uri.username().is_empty()
            || uri.password().is_some()
            || uri.fragment().is_some()
            || uri.query().is_some()
        {
            return Err(
                "GitHub configuration requires credentials and an exact HTTPS callback".into(),
            );
        }
        Ok(Self {
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(10))
                .redirect(reqwest::redirect::Policy::none())
                .user_agent("Tardy identity onboarding")
                .build()
                .map_err(|_| "GitHub HTTP client initialization failed")?,
            client_id,
            client_secret,
            redirect_uri,
        })
    }

    pub fn authorization_url(&self, state: &str, challenge: &str) -> String {
        let mut url =
            url::Url::parse("https://github.com/login/oauth/authorize").expect("constant URL");
        url.query_pairs_mut()
            .append_pair("client_id", &self.client_id)
            .append_pair("redirect_uri", &self.redirect_uri)
            .append_pair("state", state)
            .append_pair("code_challenge", challenge)
            .append_pair("code_challenge_method", "S256")
            .append_pair("scope", "")
            .append_pair("prompt", "select_account");
        url.into()
    }

    pub async fn exchange(&self, code: &str, verifier: &str) -> Result<GithubIdentity, ()> {
        #[derive(Deserialize)]
        struct Token {
            access_token: String,
        }
        let token: Token = self
            .client
            .post("https://github.com/login/oauth/access_token")
            .header("Accept", "application/json")
            .form(&[
                ("client_id", self.client_id.as_str()),
                ("client_secret", self.client_secret.as_str()),
                ("redirect_uri", self.redirect_uri.as_str()),
                ("code", code),
                ("code_verifier", verifier),
            ])
            .send()
            .await
            .map_err(|_| ())?
            .error_for_status()
            .map_err(|_| ())?
            .json()
            .await
            .map_err(|_| ())?;
        self.client
            .get("https://api.github.com/user")
            .bearer_auth(token.access_token)
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
            .map_err(|_| ())?
            .error_for_status()
            .map_err(|_| ())?
            .json()
            .await
            .map_err(|_| ())
    }
}

pub fn valid_challenge(value: &str) -> bool {
    value.len() == 43
        && URL_SAFE_NO_PAD
            .decode(value)
            .is_ok_and(|bytes| bytes.len() == 32)
}

pub fn challenge(verifier: &str) -> Option<String> {
    if !(43..=128).contains(&verifier.len())
        || !verifier
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-._~".contains(&c))
    {
        return None;
    }
    Some(URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes())))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pkce_rfc_vector() {
        assert_eq!(
            challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk").as_deref(),
            Some("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
        );
        assert!(valid_challenge(
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        ));
        assert_eq!(challenge("too-short"), None);
    }
    #[test]
    fn exact_secure_callback_and_minimal_scope() {
        assert!(
            GithubAuthenticator::new("id".into(), "secret".into(), "http://evil.test".into())
                .is_err()
        );
        assert!(
            GithubAuthenticator::new(
                "id".into(),
                "secret".into(),
                "https://tardy.news/cb?redirect=evil".into()
            )
            .is_err()
        );
        let auth = GithubAuthenticator::new(
            "id".into(),
            "secret".into(),
            "https://tardy.news/auth/github".into(),
        )
        .unwrap();
        let url = url::Url::parse(&auth.authorization_url("state", "challenge")).unwrap();
        let pairs: std::collections::HashMap<_, _> = url.query_pairs().collect();
        assert_eq!(pairs["scope"], "");
        assert_eq!(pairs["code_challenge_method"], "S256");
    }
}
