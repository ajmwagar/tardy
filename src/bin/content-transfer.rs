//! Replay reviewed reels through authenticated APIs; never restore a development DB.
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, time::Duration};

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

fn sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn validate(manifest: &Value) -> Result<()> {
    if manifest["schema"] != "tardy.production-content-transfer.v1"
        || manifest["target_api"] != "https://api.tardy.news"
    {
        return Err("unsupported manifest or production destination".into());
    }
    let entries = manifest["entries"].as_array().ok_or("missing entries")?;
    if entries.is_empty() || entries.len() > 100 {
        return Err("invalid entry count".into());
    }
    let mut requests = HashSet::new();
    let mut sources = HashSet::new();
    for entry in entries {
        if entry["target_visibility"] != "private" {
            return Err("work reels must remain private".into());
        }
        for key in [
            "source_post_id",
            "target_request_id",
            "production_video_asset_id",
            "production_poster_asset_id",
        ] {
            entry[key]
                .as_str()
                .ok_or("missing durable identity")?
                .parse::<uuid::Uuid>()?;
        }
        if !requests.insert(entry["target_request_id"].as_str().unwrap())
            || !sources.insert(entry["source_post_id"].as_str().unwrap())
        {
            return Err("duplicate source or request identity".into());
        }
        if entry["duration_ms"].as_u64().unwrap_or(0) == 0 {
            return Err("invalid duration".into());
        }
    }
    Ok(())
}

async fn get(client: &reqwest::Client, state: &Value, path: &str) -> Result<Value> {
    let response = client
        .get(format!(
            "{}{}",
            state["api"]
                .as_str()
                .ok_or("missing API")?
                .trim_end_matches('/'),
            path
        ))
        .bearer_auth(state["api_token"].as_str().ok_or("missing credential")?)
        .header(
            "x-tardy-profile-id",
            state["profile_id"]
                .as_str()
                .ok_or("missing acting profile")?,
        )
        .send()
        .await
        .map_err(reqwest::Error::without_url)?;
    if !response.status().is_success() {
        return Err(format!("readiness check returned HTTP {}", response.status()).into());
    }
    Ok(response.json().await?)
}

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let apply = args.first().map(String::as_str) == Some("apply");
    if args.len() != if apply { 5 } else { 4 }
        || !matches!(args.first().map(String::as_str), Some("plan" | "apply"))
    {
        return Err("usage: content-transfer plan MANIFEST SOURCE_STATE TARGET_STATE | apply MANIFEST SOURCE_STATE TARGET_STATE VERIFIED_BACKUP_REFERENCE".into());
    }
    let manifest: Value = serde_json::from_slice(&tokio::fs::read(&args[1]).await?)?;
    validate(&manifest)?;
    let source: Value = serde_json::from_slice(&tokio::fs::read(&args[2]).await?)?;
    let target: Value = serde_json::from_slice(&tokio::fs::read(&args[3]).await?)?;
    for (state, side) in [(&source, "source"), (&target, "target")] {
        if state["api"] != manifest[format!("{side}_api")]
            || state["profile_id"] != manifest[format!("{side}_profile_id")]
        {
            return Err("credential does not match manifest environment/author".into());
        }
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(20))
        .build()?;
    let mut captions = Vec::new();
    for entry in manifest["entries"].as_array().unwrap() {
        for kind in ["video", "poster"] {
            let bytes = tokio::fs::read(entry[kind].as_str().ok_or("missing media path")?).await?;
            if sha256(&bytes) != entry[format!("{kind}_sha256")] {
                return Err("media digest mismatch".into());
            }
        }
        let post = get(
            &client,
            &source,
            &format!("/v1/posts/{}", entry["source_post_id"].as_str().unwrap()),
        )
        .await?;
        if post["author_id"] != source["profile_id"] {
            return Err("source author mismatch".into());
        }
        let caption = post["caption"]
            .as_str()
            .ok_or("missing caption")?
            .to_owned();
        if sha256(caption.as_bytes()) != entry["caption_sha256"] {
            return Err("source caption changed; review manifest again".into());
        }
        captions.push(caption);
    }
    let author = get(
        &client,
        &target,
        &format!(
            "/v1/profiles/by-id/{}",
            target["profile_id"].as_str().unwrap()
        ),
    )
    .await?;
    if author["handle"] != manifest["author_handle"] {
        return Err("production author mismatch".into());
    }
    println!(
        "Verified {} private reels, source captions, media digests and production author",
        captions.len()
    );
    if !apply {
        return Ok(());
    }
    // Ownership and backup evidence are mandatory before writes, not inferred from an agent token.
    let owner = get(
        &client,
        &target,
        &format!(
            "/v1/profiles/{}",
            manifest["owner_handle"]
                .as_str()
                .ok_or("missing owner handle")?
        ),
    )
    .await?;
    let agents = get(
        &client,
        &target,
        &format!(
            "/v1/profiles/by-id/{}/agents",
            owner["id"].as_str().ok_or("missing owner id")?
        ),
    )
    .await?;
    if !agents
        .as_array()
        .ok_or("invalid agents response")?
        .iter()
        .any(|agent| agent["id"] == target["profile_id"])
    {
        return Err("production agent is not claimed by expected owner; no posts copied".into());
    }
    if args[4].trim().is_empty() {
        return Err("verified PG backup reference required".into());
    }
    for (entry, caption) in manifest["entries"].as_array().unwrap().iter().zip(captions) {
        let response = client.post("https://api.tardy.news/v1/social/posts")
            .bearer_auth(target["api_token"].as_str().ok_or("missing target token")?)
            .header("x-tardy-profile-id", target["profile_id"].as_str().unwrap())
            .json(&json!({"client_request_id":entry["target_request_id"],"caption":caption,"visibility":"private","shared_link_id":null,
                "media":[{"type":"video","asset_id":entry["production_video_asset_id"],"poster_asset_id":entry["production_poster_asset_id"],
                    "width":1080,"height":1920,"duration_ms":entry["duration_ms"]}]}))
            .send().await.map_err(reqwest::Error::without_url)?;
        if !response.status().is_success() {
            return Err(format!(
                "publish returned HTTP {}; retry same manifest",
                response.status()
            )
            .into());
        }
        let post: Value = response.json().await?;
        if post["visibility"] != "private" || post["author_profile_id"] != target["profile_id"] {
            return Err("queued or unexpected publication response; inspect before retry".into());
        }
        let id = post["id"].as_str().ok_or("missing production post id")?;
        let readback = get(&client, &target, &format!("/v1/posts/{id}")).await?;
        if readback["caption"].as_str() != Some(&caption)
            || readback["author_id"] != target["profile_id"]
        {
            return Err("production post readback mismatch".into());
        }
        println!(
            "{}",
            json!({"source_post_id":entry["source_post_id"],"production_post_id":id,"visibility":"private","backup_reference":args[4]})
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Value {
        let id = uuid::Uuid::new_v4().to_string();
        json!({"schema":"tardy.production-content-transfer.v1","target_api":"https://api.tardy.news","entries":[{
            "source_post_id":id,"target_request_id":id,"production_video_asset_id":id,"production_poster_asset_id":id,
            "target_visibility":"private","duration_ms":20000}]})
    }
    #[test]
    fn accepts_prepared_private_reel() {
        assert!(validate(&fixture()).is_ok());
    }
    #[test]
    fn rejects_public_promotion_and_wrong_destination() {
        let mut m = fixture();
        m["entries"][0]["target_visibility"] = json!("public");
        assert!(validate(&m).is_err());
        m = fixture();
        m["target_api"] = json!("http://example.org");
        assert!(validate(&m).is_err());
    }
    #[test]
    fn rejects_duplicate_retry_identity() {
        let mut m = fixture();
        let e = m["entries"][0].clone();
        m["entries"].as_array_mut().unwrap().push(e);
        assert!(validate(&m).is_err());
    }
}
