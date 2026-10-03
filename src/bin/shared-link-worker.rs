use serde_json::{Value, json};
use sqlx::PgPool;
use std::{path::PathBuf, time::Duration};
use tardy::media::R2ObjectStore;
use tardy::pg_ingest::PgIngestStore;
use tokio::process::Command;
use uuid::Uuid;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    let database_url = std::env::var("DATABASE_URL")?;
    let cache_dir = PathBuf::from(std::env::var("TARDY_SHARED_MEDIA_DIR")?);
    tokio::fs::create_dir_all(&cache_dir).await?;
    let store = PgIngestStore::connect(&database_url, 2).await?;
    let pool = PgPool::connect(&database_url).await?;
    let object_store = R2ObjectStore::from_env()?;
    let worker = format!("shared-link:{}", Uuid::new_v4());
    loop {
        let events = store
            .claim_outbox_topic(&worker, "shared_link.enrichment_requested.v1", 4)
            .await?;
        if events.is_empty() {
            tokio::time::sleep(Duration::from_secs(2)).await;
            continue;
        }
        for event in events {
            let id = Uuid::parse_str(&event.aggregate_id)?;
            let url = event
                .payload
                .get("canonical_url")
                .and_then(Value::as_str)
                .ok_or("missing canonical_url")?;
            sqlx::query("UPDATE shared_links SET status='processing',last_error=NULL,updated_at=now() WHERE id=$1")
                .bind(id).execute(&pool).await?;
            match enrich(id, url, &cache_dir, object_store.as_ref()).await {
                Ok((metadata, filename)) => {
                    sqlx::query("UPDATE shared_links SET status='ready',metadata=$2,media_r2_key=$3,last_error=NULL,updated_at=now() WHERE id=$1")
                        .bind(id).bind(metadata).bind(filename).execute(&pool).await?;
                    store.mark_outbox_delivered(&worker, event.id).await?;
                }
                Err(error) if event.attempts < 3 => {
                    sqlx::query("UPDATE shared_links SET status='queued',last_error=$2,updated_at=now() WHERE id=$1")
                        .bind(id).bind(error.to_string()).execute(&pool).await?;
                    store
                        .reschedule_outbox(&worker, event.id, &error.to_string(), 30)
                        .await?;
                }
                Err(error) => {
                    sqlx::query("UPDATE shared_links SET status='failed',last_error=$2,updated_at=now() WHERE id=$1")
                        .bind(id).bind(error.to_string()).execute(&pool).await?;
                    store
                        .fail_outbox(&worker, event.id, &error.to_string())
                        .await?;
                }
            }
        }
    }
}

async fn enrich(
    id: Uuid,
    url: &str,
    cache_dir: &std::path::Path,
    object_store: Option<&R2ObjectStore>,
) -> Result<(Value, String), Box<dyn std::error::Error>> {
    let info = tokio::time::timeout(
        Duration::from_secs(45),
        Command::new("uvx")
            .args([
                "--from",
                "yt-dlp",
                "yt-dlp",
                "--skip-download",
                "--dump-single-json",
                "--no-warnings",
                "--",
                url,
            ])
            .output(),
    )
    .await??;
    if !info.status.success() {
        return Err(
            std::io::Error::other(String::from_utf8_lossy(&info.stderr).into_owned()).into(),
        );
    }
    let parsed: Value = serde_json::from_slice(&info.stdout)?;
    let filename = format!("shared-{id}.mp4");
    let output = cache_dir.join(&filename);
    let downloaded = tokio::time::timeout(
        Duration::from_secs(180),
        Command::new("uvx")
            .args([
                "--from",
                "yt-dlp",
                "yt-dlp",
                "--no-playlist",
                "--max-filesize",
                "100M",
                "-f",
                "bv[height<=720]+ba/b",
                "--merge-output-format",
                "mp4",
                "-o",
            ])
            .arg(&output)
            .arg("--")
            .arg(url)
            .output(),
    )
    .await??;
    if !downloaded.status.success() {
        return Err(std::io::Error::other(
            String::from_utf8_lossy(&downloaded.stderr).into_owned(),
        )
        .into());
    }
    if !output.is_file() {
        return Err(std::io::Error::other("yt-dlp completed without producing media").into());
    }
    let thumbnail_url = parsed.get("thumbnail").and_then(Value::as_str);
    let thumbnail_filename = format!("shared-{id}-thumb.jpg");
    let thumbnail_path = cache_dir.join(&thumbnail_filename);
    let thumbnail_bytes = match thumbnail_url {
        Some(url) => Some(
            reqwest::Client::builder()
                .timeout(Duration::from_secs(30))
                .build()?
                .get(url)
                .send()
                .await?
                .error_for_status()?
                .bytes()
                .await?
                .to_vec(),
        ),
        None => None,
    };
    if let Some(bytes) = thumbnail_bytes.as_ref() {
        tokio::fs::write(&thumbnail_path, bytes).await?;
    }
    let (media_key, thumbnail_key) = if let Some(store) = object_store {
        let media_key = format!("shared-links/{id}/video.mp4");
        let thumbnail_key = format!("shared-links/{id}/thumbnail.jpg");
        store
            .put_bytes(&media_key, "video/mp4", tokio::fs::read(&output).await?)
            .await?;
        if let Some(bytes) = thumbnail_bytes {
            store.put_bytes(&thumbnail_key, "image/jpeg", bytes).await?;
        }
        (media_key, thumbnail_url.map(|_| thumbnail_key))
    } else {
        (filename.clone(), thumbnail_url.map(|_| thumbnail_filename))
    };
    let metadata = json!({
        "title": parsed.get("title"), "caption": parsed.get("description"),
        "thumbnail_url": thumbnail_key, "creator": parsed.get("uploader"),
        "duration_seconds": parsed.get("duration"), "source_url": url,
        "attribution_required": true, "cache_scope": "private_conversation"
    });
    Ok((metadata, media_key))
}
