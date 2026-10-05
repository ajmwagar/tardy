//! Explicit, resumable durable email-account setup through public APIs.
//! The operator must be authorized by the person whose email is supplied.
use serde_json::{Value, json};
use std::{os::unix::fs::PermissionsExt, path::Path, time::Duration};
use tokio::io::AsyncWriteExt;

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

async fn checked(response: reqwest::Response) -> Result<Value> {
    if !response.status().is_success() {
        return Err(format!(
            "account setup returned HTTP {}; no credentials printed",
            response.status()
        )
        .into());
    }
    Ok(response.json().await?)
}

async fn save(path: &Path, state: &Value) -> Result<()> {
    let parent = path.parent().ok_or("state needs parent directory")?;
    tokio::fs::create_dir_all(parent).await?;
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&temporary)
        .await?;
    file.write_all(&serde_json::to_vec_pretty(state)?).await?;
    file.sync_all().await?;
    drop(file);
    tokio::fs::rename(temporary, path).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn credentials_are_private_and_updates_are_atomic() {
        let directory =
            std::env::temp_dir().join(format!("tardy-account-test-{}", uuid::Uuid::new_v4()));
        let path = directory.join("state.json");
        save(&path, &json!({"api_token":"test-only","profile_id":null}))
            .await
            .unwrap();
        assert_eq!(
            tokio::fs::metadata(&path)
                .await
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        save(
            &path,
            &json!({"api_token":"test-only","profile_id":"profile"}),
        )
        .await
        .unwrap();
        let state: Value = serde_json::from_slice(&tokio::fs::read(&path).await.unwrap()).unwrap();
        assert_eq!(state["profile_id"], "profile");
        assert_eq!(std::fs::read_dir(&directory).unwrap().count(), 1);
        tokio::fs::remove_file(path).await.unwrap();
        tokio::fs::remove_dir(directory).await.unwrap();
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() != 5 {
        return Err("usage: account-setup API EMAIL HANDLE DISPLAY_NAME PRIVATE_STATE".into());
    }
    let api = args[0].trim_end_matches('/');
    if api != "https://api.tardy.news" && api != "http://127.0.0.1:3300" {
        return Err("only explicit production or local API is supported".into());
    }
    if !args[1].contains('@') || args[2].is_empty() {
        return Err("email and handle are required".into());
    }
    let path = Path::new(&args[4]);
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(20))
        .build()?;
    let mut state: Value = match tokio::fs::read(path).await {
        Ok(bytes) => {
            if tokio::fs::metadata(path).await?.permissions().mode() & 0o077 != 0 {
                return Err("credential state must be private mode 0600".into());
            }
            serde_json::from_slice(&bytes)?
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let claim = checked(
                client
                    .post(format!("{api}/v1/onboarding/agent-codes"))
                    .send()
                    .await
                    .map_err(reqwest::Error::without_url)?,
            )
            .await?;
            let account = checked(
                client
                    .post(format!("{api}/v1/onboarding/claims"))
                    .json(&json!({"code":claim["code"],"email":args[1]}))
                    .send()
                    .await
                    .map_err(reqwest::Error::without_url)?,
            )
            .await?;
            let state = json!({"api":api,"email":args[1],"handle":args[2],"account_id":account["account"]["id"],"api_token":account["api_token"]});
            if state["api_token"].as_str().is_none() {
                return Err("missing account credential".into());
            }
            save(path, &state).await?;
            state
        }
        Err(error) => return Err(error.into()),
    };
    if state["api"] != api || state["email"] != args[1] || state["handle"] != args[2] {
        return Err("saved state belongs to another account or environment".into());
    }
    let token = state["api_token"]
        .as_str()
        .ok_or("missing saved credential")?
        .to_owned();
    if state["profile_id"].as_str().is_none() {
        // Recover a previous accepted create if the process stopped before saving it.
        let existing = client
            .get(format!("{api}/v1/profiles/{}", args[2]))
            .bearer_auth(&token)
            .send()
            .await
            .map_err(reqwest::Error::without_url)?;
        let profile = if existing.status().is_success() {
            let profile: Value = existing.json().await?;
            if profile["owned_by_viewer"] != true {
                return Err("handle belongs to another account".into());
            }
            profile
        } else if existing.status() == reqwest::StatusCode::NOT_FOUND {
            checked(client.post(format!("{api}/v1/profiles")).bearer_auth(&token)
                .json(&json!({"handle":args[2],"display_name":args[3],"kind":"human","bio":"Building useful tools with people and agents."}))
                .send().await.map_err(reqwest::Error::without_url)?).await?
        } else {
            return Err(format!("profile lookup returned HTTP {}", existing.status()).into());
        };
        state["profile_id"] = profile["id"].clone();
        save(path, &state).await?;
    }
    println!(
        "Ready @{}; credential saved privately; no Apple session fabricated",
        args[2]
    );
    Ok(())
}
