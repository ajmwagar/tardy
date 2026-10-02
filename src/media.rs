use async_trait::async_trait;
use rusty_s3::{Bucket, Credentials, S3Action, UrlStyle};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, RwLock};
use std::time::Duration;
use utoipa::ToSchema;
use uuid::Uuid;

const UPLOAD_TTL_MS: u64 = 15 * 60 * 1_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum MediaKind {
    Scene,
    Voiceover,
    AudioOriginal,
    Poster,
    VideoOriginal,
}

impl MediaKind {
    fn db_name(self) -> &'static str {
        match self {
            Self::Scene => "scene",
            Self::Voiceover => "voiceover",
            Self::AudioOriginal => "audio_original",
            Self::Poster => "poster",
            Self::VideoOriginal => "video_original",
        }
    }

    fn max_bytes(self) -> u64 {
        match self {
            Self::Scene => 1 << 20,
            Self::Poster => 10 << 20,
            Self::Voiceover => 25 << 20,
            Self::AudioOriginal => 500 << 20,
            Self::VideoOriginal => 250 << 20,
        }
    }
    fn allows(self, mime: &str) -> bool {
        match self {
            Self::Scene => mime == "application/json",
            Self::Poster => matches!(mime, "image/jpeg" | "image/png" | "image/webp"),
            Self::Voiceover => matches!(mime, "audio/mp4" | "audio/mpeg" | "audio/ogg"),
            Self::AudioOriginal => matches!(
                mime,
                "audio/mp4" | "audio/mpeg" | "audio/ogg" | "audio/wav" | "audio/flac"
            ),
            Self::VideoOriginal => matches!(mime, "video/mp4" | "video/quicktime" | "video/webm"),
        }
    }
    fn key_segment(self) -> &'static str {
        match self {
            Self::Scene => "structured",
            Self::Voiceover => "audio",
            Self::AudioOriginal => "music-originals",
            Self::Poster => "poster",
            Self::VideoOriginal => "video",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct UploadIntent {
    pub profile_id: Uuid,
    pub kind: MediaKind,
    pub content_type: String,
    pub byte_length: u64,
    pub sha256_base64: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct UploadAuthorization {
    pub id: Uuid,
    pub method: String,
    pub url: String,
    pub headers: BTreeMap<String, String>,
    pub expires_at_ms: u64,
    pub max_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct MediaAsset {
    pub id: Uuid,
    pub profile_id: Uuid,
    pub kind: MediaKind,
    pub object_key: String,
    pub content_type: String,
    pub byte_length: u64,
    pub sha256_base64: Option<String>,
    pub status: MediaStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum MediaStatus {
    Quarantined,
    Ready,
}

#[derive(Debug, Clone)]
struct UploadSession {
    id: Uuid,
    profile_id: Uuid,
    kind: MediaKind,
    object_key: String,
    content_type: String,
    byte_length: u64,
    sha256_base64: Option<String>,
    expires_at_ms: u64,
    completed: Option<MediaAsset>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObjectMetadata {
    pub content_type: Option<String>,
    pub byte_length: u64,
    pub sha256_base64: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum MediaError {
    #[error("R2 is not configured")]
    Unconfigured,
    #[error("unsupported media type for this upload kind")]
    UnsupportedType,
    #[error("upload size must be between 1 and {0} bytes")]
    InvalidSize(u64),
    #[error("upload not found or expired")]
    NotFound,
    #[error("access denied")]
    Forbidden,
    #[error("uploaded object metadata does not match authorization")]
    MetadataMismatch,
    #[error("object store: {0}")]
    ObjectStore(String),
    #[error("media state lock poisoned")]
    Poisoned,
    #[error("timestamp overflow")]
    TimestampOverflow,
}

#[async_trait]
pub trait ObjectStore: Send + Sync {
    async fn presign_put(
        &self,
        key: &str,
        content_type: &str,
        byte_length: u64,
        sha256_base64: Option<&str>,
        expires: Duration,
    ) -> Result<(String, String, BTreeMap<String, String>), MediaError>;
    async fn head(&self, key: &str) -> Result<ObjectMetadata, MediaError>;
    async fn presign_get(&self, key: &str, expires: Duration) -> Result<String, MediaError>;
}

pub struct R2ObjectStore {
    bucket: Bucket,
    credentials: Credentials,
    client: reqwest::Client,
}

impl R2ObjectStore {
    pub fn from_env() -> Result<Option<Self>, MediaError> {
        let Some(account_id) = std::env::var("R2_ACCOUNT_ID").ok() else {
            return Ok(None);
        };
        let access_key = std::env::var("R2_ACCESS_KEY_ID").map_err(|_| MediaError::Unconfigured)?;
        let secret = std::env::var("R2_SECRET_ACCESS_KEY").map_err(|_| MediaError::Unconfigured)?;
        let bucket_name = std::env::var("R2_BUCKET").map_err(|_| MediaError::Unconfigured)?;
        let endpoint = format!("https://{account_id}.r2.cloudflarestorage.com")
            .parse()
            .map_err(|error| MediaError::ObjectStore(format!("invalid R2 endpoint: {error}")))?;
        let bucket = Bucket::new(endpoint, UrlStyle::Path, bucket_name, "auto")
            .map_err(|error| MediaError::ObjectStore(format!("invalid R2 bucket: {error}")))?;
        Ok(Some(Self {
            bucket,
            credentials: Credentials::new(access_key, secret),
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(10))
                .build()
                .map_err(|error| MediaError::ObjectStore(error.to_string()))?,
        }))
    }

    /// Upload trusted server-generated bytes directly. Client uploads still use the
    /// quarantine/authorize flow; workers use this narrow path for derived cache objects.
    pub async fn put_bytes(
        &self,
        key: &str,
        content_type: &str,
        bytes: Vec<u8>,
    ) -> Result<(), MediaError> {
        let (_, url, headers) = self
            .presign_put(
                key,
                content_type,
                bytes.len() as u64,
                None,
                Duration::from_secs(300),
            )
            .await?;
        let mut request = self.client.put(url).body(bytes);
        for (name, value) in headers {
            if !name.eq_ignore_ascii_case("host") {
                request = request.header(name, value);
            }
        }
        let response = request
            .send()
            .await
            .map_err(|error| MediaError::ObjectStore(error.to_string()))?;
        if !response.status().is_success() {
            return Err(MediaError::ObjectStore(format!(
                "HTTP {}",
                response.status()
            )));
        }
        Ok(())
    }
}

#[async_trait]
impl ObjectStore for R2ObjectStore {
    async fn presign_put(
        &self,
        key: &str,
        content_type: &str,
        byte_length: u64,
        sha256_base64: Option<&str>,
        expires: Duration,
    ) -> Result<(String, String, BTreeMap<String, String>), MediaError> {
        let mut action = self.bucket.put_object(Some(&self.credentials), key);
        action.headers_mut().insert("content-type", content_type);
        let length = byte_length.to_string();
        action.headers_mut().insert("content-length", &length);
        if let Some(checksum) = sha256_base64 {
            action
                .headers_mut()
                .insert("x-amz-checksum-sha256", checksum);
        }
        let headers = action
            .headers_mut()
            .iter()
            .map(|(name, value)| (name.to_owned(), value.to_owned()))
            .collect();
        Ok(("PUT".into(), action.sign(expires).into(), headers))
    }

    async fn head(&self, key: &str) -> Result<ObjectMetadata, MediaError> {
        let mut action = self.bucket.head_object(Some(&self.credentials), key);
        action
            .headers_mut()
            .insert("x-amz-checksum-mode", "ENABLED");
        let url = action.sign(Duration::from_secs(60));
        let value = self
            .client
            .head(url)
            .header("x-amz-checksum-mode", "ENABLED")
            .send()
            .await
            .map_err(|error| MediaError::ObjectStore(error.to_string()))?;
        if !value.status().is_success() {
            return Err(MediaError::ObjectStore(format!("HTTP {}", value.status())));
        }
        let headers = value.headers();
        Ok(ObjectMetadata {
            content_type: headers
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned),
            byte_length: headers
                .get(reqwest::header::CONTENT_LENGTH)
                .and_then(|value| value.to_str().ok())
                .ok_or(MediaError::MetadataMismatch)?
                .parse()
                .map_err(|_| MediaError::MetadataMismatch)?,
            sha256_base64: headers
                .get("x-amz-checksum-sha256")
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned),
        })
    }

    async fn presign_get(&self, key: &str, expires: Duration) -> Result<String, MediaError> {
        Ok(self
            .bucket
            .get_object(Some(&self.credentials), key)
            .sign(expires)
            .into())
    }
}

pub struct MediaService {
    object_store: Option<Arc<dyn ObjectStore>>,
    pool: Option<PgPool>,
    sessions: RwLock<HashMap<Uuid, UploadSession>>,
}

impl MediaService {
    pub fn new(object_store: Option<Arc<dyn ObjectStore>>) -> Self {
        Self {
            object_store,
            pool: None,
            sessions: RwLock::new(HashMap::new()),
        }
    }
    pub fn from_env() -> Result<Self, MediaError> {
        Ok(Self::new(
            R2ObjectStore::from_env()?.map(|store| Arc::new(store) as Arc<dyn ObjectStore>),
        ))
    }

    pub fn from_env_with_pool(pool: PgPool) -> Result<Self, MediaError> {
        let mut service = Self::from_env()?;
        service.pool = Some(pool);
        Ok(service)
    }

    pub async fn authorize(
        &self,
        actor: Uuid,
        intent: UploadIntent,
        now_ms: u64,
    ) -> Result<UploadAuthorization, MediaError> {
        if actor != intent.profile_id {
            return Err(MediaError::Forbidden);
        }
        if !intent.kind.allows(&intent.content_type) {
            return Err(MediaError::UnsupportedType);
        }
        let max_bytes = intent.kind.max_bytes();
        if intent.byte_length == 0 || intent.byte_length > max_bytes {
            return Err(MediaError::InvalidSize(max_bytes));
        }
        let store = self.object_store.as_ref().ok_or(MediaError::Unconfigured)?;
        let id = Uuid::new_v4();
        let key = format!("quarantine/{}/{}/{}", actor, intent.kind.key_segment(), id);
        let expires_at_ms = now_ms
            .checked_add(UPLOAD_TTL_MS)
            .ok_or(MediaError::TimestampOverflow)?;
        let (method, url, headers) = store
            .presign_put(
                &key,
                &intent.content_type,
                intent.byte_length,
                intent.sha256_base64.as_deref(),
                Duration::from_millis(UPLOAD_TTL_MS),
            )
            .await?;
        if let Some(pool) = &self.pool {
            sqlx::query("INSERT INTO media_upload_sessions (id,profile_id,kind,object_key,content_type,byte_length,sha256_base64,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,to_timestamp($8::double precision/1000.0))")
                .bind(id)
                .bind(actor)
                .bind(intent.kind.db_name())
                .bind(&key)
                .bind(&intent.content_type)
                .bind(intent.byte_length as i64)
                .bind(&intent.sha256_base64)
                .bind(expires_at_ms as f64)
                .execute(pool)
                .await
                .map_err(|error| MediaError::ObjectStore(format!("persist upload: {error}")))?;
        } else {
            self.sessions
                .write()
                .map_err(|_| MediaError::Poisoned)?
                .insert(
                    id,
                    UploadSession {
                        id,
                        profile_id: actor,
                        kind: intent.kind,
                        object_key: key,
                        content_type: intent.content_type,
                        byte_length: intent.byte_length,
                        sha256_base64: intent.sha256_base64,
                        expires_at_ms,
                        completed: None,
                    },
                );
        }
        Ok(UploadAuthorization {
            id,
            method,
            url,
            headers,
            expires_at_ms,
            max_bytes,
        })
    }

    pub async fn complete(
        &self,
        actor: Uuid,
        id: Uuid,
        now_ms: u64,
    ) -> Result<MediaAsset, MediaError> {
        let session = if let Some(pool) = &self.pool {
            let row = sqlx::query("SELECT id,profile_id,kind,object_key,content_type,byte_length,sha256_base64,extract(epoch from expires_at)*1000 AS expires_at_ms,completed_asset_id FROM media_upload_sessions WHERE id=$1")
                .bind(id).fetch_optional(pool).await
                .map_err(|error| MediaError::ObjectStore(format!("read upload: {error}")))?
                .ok_or(MediaError::NotFound)?;
            let kind = parse_kind(row.try_get::<String, _>("kind").map_err(db_media)?.as_str())?;
            let completed_id: Option<Uuid> = row.try_get("completed_asset_id").map_err(db_media)?;
            let completed = if let Some(asset_id) = completed_id {
                Some(self.asset(asset_id).await?)
            } else {
                None
            };
            UploadSession {
                id: row.try_get("id").map_err(db_media)?,
                profile_id: row.try_get("profile_id").map_err(db_media)?,
                kind,
                object_key: row.try_get("object_key").map_err(db_media)?,
                content_type: row.try_get("content_type").map_err(db_media)?,
                byte_length: row.try_get::<i64, _>("byte_length").map_err(db_media)? as u64,
                sha256_base64: row.try_get("sha256_base64").map_err(db_media)?,
                expires_at_ms: row.try_get::<f64, _>("expires_at_ms").map_err(db_media)? as u64,
                completed,
            }
        } else {
            self.sessions
                .read()
                .map_err(|_| MediaError::Poisoned)?
                .get(&id)
                .cloned()
                .ok_or(MediaError::NotFound)?
        };
        if session.profile_id != actor {
            return Err(MediaError::Forbidden);
        }
        if let Some(asset) = session.completed {
            return Ok(asset);
        }
        if session.expires_at_ms <= now_ms {
            return Err(MediaError::NotFound);
        }
        let actual = self
            .object_store
            .as_ref()
            .ok_or(MediaError::Unconfigured)?
            .head(&session.object_key)
            .await?;
        if actual.byte_length != session.byte_length
            || actual.content_type.as_deref() != Some(&session.content_type)
            || (session.sha256_base64.is_some() && actual.sha256_base64 != session.sha256_base64)
        {
            return Err(MediaError::MetadataMismatch);
        }
        let asset = MediaAsset {
            id: session.id,
            profile_id: actor,
            kind: session.kind,
            object_key: session.object_key,
            content_type: session.content_type,
            byte_length: session.byte_length,
            sha256_base64: session.sha256_base64,
            status: if session.kind == MediaKind::Poster {
                MediaStatus::Ready
            } else {
                MediaStatus::Quarantined
            },
        };
        if let Some(pool) = &self.pool {
            sqlx::query("INSERT INTO media_assets (id,profile_id,kind,object_key,content_type,byte_length,sha256_base64,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING")
                .bind(asset.id).bind(asset.profile_id).bind(asset.kind.db_name()).bind(&asset.object_key).bind(&asset.content_type).bind(asset.byte_length as i64).bind(&asset.sha256_base64).bind(status_name(asset.status))
                .execute(pool).await.map_err(|error| MediaError::ObjectStore(format!("persist asset: {error}")))?;
            sqlx::query("UPDATE media_upload_sessions SET completed_asset_id=$2 WHERE id=$1")
                .bind(id)
                .bind(asset.id)
                .execute(pool)
                .await
                .map_err(|error| MediaError::ObjectStore(format!("complete upload: {error}")))?;
        } else {
            self.sessions
                .write()
                .map_err(|_| MediaError::Poisoned)?
                .get_mut(&id)
                .ok_or(MediaError::NotFound)?
                .completed = Some(asset.clone());
        }
        Ok(asset)
    }

    pub async fn ready_asset(&self, actor: Uuid, id: Uuid) -> Result<MediaAsset, MediaError> {
        let asset = self.asset(id).await?;
        if asset.profile_id != actor {
            return Err(MediaError::Forbidden);
        }
        if asset.status != MediaStatus::Ready {
            return Err(MediaError::Forbidden);
        }
        Ok(asset)
    }

    pub async fn delivery_url(&self, id: Uuid) -> Result<String, MediaError> {
        let asset = self.asset(id).await?;
        if asset.status != MediaStatus::Ready {
            return Err(MediaError::Forbidden);
        }
        self.object_store
            .as_ref()
            .ok_or(MediaError::Unconfigured)?
            .presign_get(&asset.object_key, Duration::from_secs(5 * 60))
            .await
    }

    async fn asset(&self, id: Uuid) -> Result<MediaAsset, MediaError> {
        if let Some(pool) = &self.pool {
            let row = sqlx::query("SELECT id,profile_id,kind,object_key,content_type,byte_length,sha256_base64,status FROM media_assets WHERE id=$1")
                .bind(id).fetch_optional(pool).await.map_err(|error| MediaError::ObjectStore(format!("read asset: {error}")))?.ok_or(MediaError::NotFound)?;
            return Ok(MediaAsset {
                id: row.try_get("id").map_err(db_media)?,
                profile_id: row.try_get("profile_id").map_err(db_media)?,
                kind: parse_kind(row.try_get::<String, _>("kind").map_err(db_media)?.as_str())?,
                object_key: row.try_get("object_key").map_err(db_media)?,
                content_type: row.try_get("content_type").map_err(db_media)?,
                byte_length: row.try_get::<i64, _>("byte_length").map_err(db_media)? as u64,
                sha256_base64: row.try_get("sha256_base64").map_err(db_media)?,
                status: parse_status(
                    row.try_get::<String, _>("status")
                        .map_err(db_media)?
                        .as_str(),
                )?,
            });
        }
        self.sessions
            .read()
            .map_err(|_| MediaError::Poisoned)?
            .values()
            .find_map(|session| session.completed.clone().filter(|asset| asset.id == id))
            .ok_or(MediaError::NotFound)
    }
}

fn parse_kind(value: &str) -> Result<MediaKind, MediaError> {
    match value {
        "structured" | "scene" => Ok(MediaKind::Scene),
        "audio" | "voiceover" => Ok(MediaKind::Voiceover),
        "music-originals" | "audio_original" => Ok(MediaKind::AudioOriginal),
        "poster" => Ok(MediaKind::Poster),
        "video" | "video_original" => Ok(MediaKind::VideoOriginal),
        _ => Err(MediaError::MetadataMismatch),
    }
}
fn status_name(value: MediaStatus) -> &'static str {
    match value {
        MediaStatus::Quarantined => "quarantined",
        MediaStatus::Ready => "ready",
    }
}
fn parse_status(value: &str) -> Result<MediaStatus, MediaError> {
    match value {
        "quarantined" => Ok(MediaStatus::Quarantined),
        "ready" => Ok(MediaStatus::Ready),
        _ => Err(MediaError::MetadataMismatch),
    }
}
fn db_media(error: sqlx::Error) -> MediaError {
    MediaError::ObjectStore(format!("database: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    struct Fake {
        metadata: Mutex<Option<ObjectMetadata>>,
    }
    #[async_trait]
    impl ObjectStore for Fake {
        async fn presign_put(
            &self,
            _: &str,
            content_type: &str,
            byte_length: u64,
            _: Option<&str>,
            _: Duration,
        ) -> Result<(String, String, BTreeMap<String, String>), MediaError> {
            *self.metadata.lock().unwrap() = Some(ObjectMetadata {
                content_type: Some(content_type.into()),
                byte_length,
                sha256_base64: None,
            });
            Ok((
                "PUT".into(),
                "https://r2.test/upload".into(),
                BTreeMap::new(),
            ))
        }
        async fn head(&self, _: &str) -> Result<ObjectMetadata, MediaError> {
            Ok(self.metadata.lock().unwrap().clone().unwrap())
        }
        async fn presign_get(&self, key: &str, _: Duration) -> Result<String, MediaError> {
            Ok(format!("https://r2.test/{key}"))
        }
    }

    #[tokio::test]
    async fn authorizes_and_head_verifies_an_upload() {
        let service = MediaService::new(Some(Arc::new(Fake {
            metadata: Mutex::new(None),
        })));
        let profile = Uuid::new_v4();
        let auth = service
            .authorize(
                profile,
                UploadIntent {
                    profile_id: profile,
                    kind: MediaKind::Scene,
                    content_type: "application/json".into(),
                    byte_length: 42,
                    sha256_base64: None,
                },
                1,
            )
            .await
            .unwrap();
        assert_eq!(auth.method, "PUT");
        let asset = service.complete(profile, auth.id, 2).await.unwrap();
        assert_eq!(asset.status, MediaStatus::Quarantined);
        assert_eq!(service.complete(profile, auth.id, 3).await.unwrap(), asset);
    }

    #[tokio::test]
    async fn rejects_oversized_or_cross_profile_uploads() {
        let service = MediaService::new(Some(Arc::new(Fake {
            metadata: Mutex::new(None),
        })));
        let profile = Uuid::new_v4();
        let other = Uuid::new_v4();
        let intent = UploadIntent {
            profile_id: profile,
            kind: MediaKind::Scene,
            content_type: "application/json".into(),
            byte_length: 2 << 20,
            sha256_base64: None,
        };
        assert!(matches!(
            service.authorize(profile, intent.clone(), 1).await,
            Err(MediaError::InvalidSize(_))
        ));
        assert!(matches!(
            service.authorize(other, intent, 1).await,
            Err(MediaError::Forbidden)
        ));
    }

    #[tokio::test]
    async fn r2_adapter_presigns_a_put_without_network_io() {
        let store = R2ObjectStore {
            bucket: Bucket::new(
                "https://account.r2.cloudflarestorage.com".parse().unwrap(),
                UrlStyle::Path,
                "media",
                "auto",
            )
            .unwrap(),
            credentials: Credentials::new("access", "secret"),
            client: reqwest::Client::new(),
        };
        let (method, url, headers) = store
            .presign_put(
                "quarantine/profile/scene/upload",
                "application/json",
                42,
                None,
                Duration::from_secs(60),
            )
            .await
            .unwrap();
        assert_eq!(method, "PUT");
        assert!(url.starts_with("https://account.r2.cloudflarestorage.com/media/quarantine/"));
        assert!(url.contains("X-Amz-Signature="));
        assert_eq!(
            headers.get("content-type").map(String::as_str),
            Some("application/json")
        );
    }
}
