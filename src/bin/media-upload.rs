//! Upload a local artifact through Tardy's existing authorization/completion boundary.
//! Credentials and presigned URLs stay in memory; stdout contains only asset identity.
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{path::Path, time::Duration};

fn probe(bytes: &[u8]) -> Result<Value, Box<dyn std::error::Error>> {
    let value: Value = serde_json::from_slice(bytes)?;
    let stream = value["streams"]
        .as_array()
        .and_then(|streams| streams.first())
        .ok_or("video stream missing")?;
    let width = stream["width"].as_u64().ok_or("video width missing")?;
    let height = stream["height"].as_u64().ok_or("video height missing")?;
    let seconds: f64 = value["format"]["duration"]
        .as_str()
        .ok_or("video duration missing")?
        .parse()?;
    if width != 1080 || height != 1920 || !seconds.is_finite() || seconds <= 0.0 || seconds > 3600.0
    {
        return Err("reel must be 1080x1920 with a finite duration of at most one hour".into());
    }
    Ok(json!({"width":width,"height":height,"duration_ms":(seconds*1000.0).round() as u64}))
}

async fn inspect(file: &str) -> Result<Value, Box<dyn std::error::Error>> {
    let path = Path::new(file);
    media_type(path)?;
    let length = tokio::fs::metadata(path).await?.len();
    if length == 0 || length > 128 * 1024 * 1024 {
        return Err("artifact must be nonempty and at most 128 MiB".into());
    }
    let bytes = tokio::fs::read(path).await?;
    let mut result = json!({"bytes":length,"sha256_base64":STANDARD.encode(Sha256::digest(bytes))});
    if path.extension().and_then(|s| s.to_str()) == Some("mp4") {
        let output = tokio::process::Command::new("ffprobe")
            .args([
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height:format=duration",
                "-of",
                "json",
                file,
            ])
            .output()
            .await
            .map_err(|_| "ffprobe is required to validate reel format")?;
        if !output.status.success() {
            return Err("ffprobe could not inspect video".into());
        }
        result
            .as_object_mut()
            .unwrap()
            .extend(probe(&output.stdout)?.as_object().unwrap().clone());
    }
    Ok(result)
}

#[derive(Deserialize)]
struct Credential {
    api: String,
    api_token: String,
    profile_id: uuid::Uuid,
}

fn media_type(path: &Path) -> Result<(&'static str, &'static str), &'static str> {
    match path.extension().and_then(|s| s.to_str()) {
        Some("mp4") => Ok(("message_attachment", "video/mp4")),
        Some("jpg" | "jpeg") => Ok(("poster", "image/jpeg")),
        Some("png") => Ok(("poster", "image/png")),
        _ => Err("supported artifacts: mp4, jpg, jpeg, png"),
    }
}

async fn checked(response: reqwest::Response) -> Result<Value, Box<dyn std::error::Error>> {
    if !response.status().is_success() {
        return Err(format!("Tardy returned HTTP {}", response.status()).into());
    }
    Ok(response.json().await?)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    if arguments.len() == 2 && arguments[0] == "--inspect" {
        println!("{}", inspect(&arguments[1]).await?);
        return Ok(());
    }
    if arguments.len() != 2 {
        return Err("usage: media-upload CREDENTIAL_STATE ARTIFACT".into());
    }
    let state: Credential = serde_json::from_slice(&tokio::fs::read(&arguments[0]).await?)?;
    let file = Path::new(&arguments[1]);
    let (kind, content_type) = media_type(file)?;
    let length = tokio::fs::metadata(file).await?.len();
    if length == 0 || length > 128 * 1024 * 1024 {
        return Err("artifact must be nonempty and at most 128 MiB".into());
    }
    let bytes = tokio::fs::read(file).await?;
    let hash = Sha256::digest(&bytes);
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(120))
        .build()?;
    let api = state.api.trim_end_matches('/');
    let authorization = checked(client.post(format!("{api}/v1/uploads"))
        .bearer_auth(&state.api_token).header("x-tardy-profile-id", state.profile_id.to_string())
        .json(&json!({"profile_id":state.profile_id,"kind":kind,"content_type":content_type,"byte_length":bytes.len(),"sha256_base64":STANDARD.encode(hash)}))
        .send().await.map_err(reqwest::Error::without_url)?).await?;
    let id: uuid::Uuid = authorization["id"]
        .as_str()
        .ok_or("missing upload identity")?
        .parse()?;
    let url = authorization["url"]
        .as_str()
        .ok_or("missing upload target")?;
    let mut put = client.put(url).body(bytes.clone());
    if let Some(headers) = authorization["headers"].as_object() {
        for (name, value) in headers {
            put = put.header(name, value.as_str().ok_or("invalid upload header")?);
        }
    }
    let response = put.send().await.map_err(reqwest::Error::without_url)?;
    if !response.status().is_success() {
        return Err(format!("object upload returned HTTP {}", response.status()).into());
    }
    let complete = checked(
        client
            .post(format!("{api}/v1/uploads/{id}/complete"))
            .bearer_auth(&state.api_token)
            .header("x-tardy-profile-id", state.profile_id.to_string())
            .send()
            .await
            .map_err(reqwest::Error::without_url)?,
    )
    .await?;
    let playback = complete["url"].as_str().ok_or_else(|| {
        format!("upload {id} is not ready; wait for media verification, do not republish")
    })?;
    let mut returned = client
        .get(playback)
        .send()
        .await
        .map_err(reqwest::Error::without_url)?;
    if !returned.status().is_success() {
        return Err(format!("asset readback returned HTTP {}", returned.status()).into());
    }
    let mut readback = Vec::with_capacity(length as usize);
    while let Some(chunk) = returned
        .chunk()
        .await
        .map_err(reqwest::Error::without_url)?
    {
        if readback.len() + chunk.len() > length as usize {
            return Err("asset readback exceeds authorized size".into());
        }
        readback.extend_from_slice(&chunk);
    }
    if Sha256::digest(&readback) != hash {
        return Err("uploaded artifact readback checksum mismatch".into());
    }
    println!(
        "{}",
        json!({"asset_id":id,"bytes":length,"sha256_base64":STANDARD.encode(hash),"verified":true})
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn upload_kinds_are_narrow() {
        assert_eq!(
            media_type(Path::new("reel.mp4")).unwrap(),
            ("message_attachment", "video/mp4")
        );
        assert_eq!(
            media_type(Path::new("poster.jpg")).unwrap(),
            ("poster", "image/jpeg")
        );
        assert!(media_type(Path::new("credentials.json")).is_err());
    }
    #[test]
    fn validates_portrait_and_encoded_duration() {
        let valid = br#"{"streams":[{"width":1080,"height":1920}],"format":{"duration":"22.004"}}"#;
        assert_eq!(probe(valid).unwrap()["duration_ms"], 22004);
        for invalid in [
            br#"{"streams":[],"format":{"duration":"22"}}"#.as_slice(),
            br#"{"streams":[{"width":1920,"height":1080}],"format":{"duration":"22"}}"#,
            br#"{"streams":[{"width":1080,"height":1920}],"format":{"duration":"NaN"}}"#,
        ] {
            assert!(probe(invalid).is_err());
        }
    }
}
