use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum AudioError {
    #[error("audio database: {0}")]
    Database(#[from] sqlx::Error),
    #[error("invalid audio request: {0}")]
    Invalid(&'static str),
    #[error("audio resource not found")]
    NotFound,
    #[error("audio action is not permitted")]
    Forbidden,
    #[error("audio rights are not cleared for this use")]
    RightsNotCleared,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReleaseType {
    Single,
    Ep,
    Album,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct AudioRelease {
    pub id: Uuid,
    pub owner_profile_id: Uuid,
    pub title: String,
    pub release_type: ReleaseType,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct NewAudioRelease {
    pub title: String,
    pub release_type: ReleaseType,
    pub artwork_r2_key: Option<String>,
    pub release_date: Option<String>,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct NewOriginalTrack {
    pub track_number: i32,
    #[serde(default = "one")]
    pub disc_number: i32,
    pub title: String,
    pub artist_name: String,
    pub duration_ms: i64,
    pub audio_r2_key: String,
    pub content_hash: String,
    #[serde(default)]
    pub credits: Vec<serde_json::Value>,
    pub attests_controls_recording: bool,
    pub attests_controls_composition: bool,
    pub permits_commercial_use: bool,
}
fn one() -> i32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct AudioTrack {
    pub id: Uuid,
    pub release_id: Uuid,
    pub uploader_profile_id: Uuid,
    pub title: String,
    pub artist_name: String,
    pub duration_ms: i64,
    pub recognition_status: String,
    pub rights_status: String,
    pub attribution_text: Option<String>,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct AttachPostAudio {
    pub track_id: Uuid,
    #[serde(default)]
    pub start_ms: i64,
    pub duration_ms: i64,
    #[serde(default = "full_volume")]
    pub volume_millipercent: i32,
}
fn full_volume() -> i32 {
    100_000
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct AudioUsage {
    pub event_id: Uuid,
    pub post_id: Option<Uuid>,
    pub kind: AudioUsageKind,
    #[serde(default)]
    pub listen_ms: i64,
    pub territory: Option<String>,
}

#[derive(Debug, Clone, Copy, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AudioUsageKind {
    PlayStarted,
    QualifiedPlay,
    PlayCompleted,
    Export,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct TrendingAudio {
    pub track: AudioTrack,
    pub uses_24h: i64,
    pub qualified_plays_24h: i64,
    pub score: i64,
}

#[derive(Clone)]
pub struct PgAudioStore {
    pool: PgPool,
}

impl PgAudioStore {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn create_release(
        &self,
        actor: Uuid,
        input: NewAudioRelease,
    ) -> Result<AudioRelease, AudioError> {
        let title = text(&input.title, 300)?;
        let id = Uuid::new_v4();
        sqlx::query("INSERT INTO audio_releases (id,owner_profile_id,title,release_type,artwork_r2_key,release_date) VALUES ($1,$2,$3,$4,$5,$6::date)")
            .bind(id).bind(actor).bind(title).bind(release_name(input.release_type)).bind(input.artwork_r2_key).bind(input.release_date).execute(&self.pool).await?;
        Ok(AudioRelease {
            id,
            owner_profile_id: actor,
            title: title.into(),
            release_type: input.release_type,
        })
    }

    pub async fn add_original_track(
        &self,
        actor: Uuid,
        release: Uuid,
        input: NewOriginalTrack,
    ) -> Result<AudioTrack, AudioError> {
        if !input.attests_controls_recording || !input.attests_controls_composition {
            return Err(AudioError::Invalid(
                "creator must attest control of recording and composition",
            ));
        }
        if input.track_number < 1
            || input.disc_number < 1
            || !(1_000..=7_200_000).contains(&input.duration_ms)
            || input.audio_r2_key.trim().is_empty()
            || input.content_hash.trim().is_empty()
        {
            return Err(AudioError::Invalid("invalid track metadata"));
        }
        let mut tx = self.pool.begin().await?;
        let owns: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM audio_releases WHERE id=$1 AND owner_profile_id=$2)",
        )
        .bind(release)
        .bind(actor)
        .fetch_one(&mut *tx)
        .await?;
        if !owns {
            return Err(AudioError::Forbidden);
        }
        let id = Uuid::new_v4();
        let row=sqlx::query("INSERT INTO audio_tracks (id,release_id,uploader_profile_id,track_number,disc_number,title,artist_name,duration_ms,audio_r2_key,content_hash,credits) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *")
            .bind(id).bind(release).bind(actor).bind(input.track_number).bind(input.disc_number).bind(text(&input.title,300)?).bind(text(&input.artist_name,300)?).bind(input.duration_ms).bind(input.audio_r2_key).bind(input.content_hash).bind(serde_json::Value::Array(input.credits)).fetch_one(&mut *tx).await?;
        sqlx::query("INSERT INTO audio_rights_grants (id,track_id,grantor_profile_id,basis,controls_recording,controls_composition,permits_sync,permits_on_demand_streaming,permits_commercial_use,attestation_version) VALUES ($1,$2,$3,'creator_attestation',true,true,true,true,$4,'creator-original-v1')")
            .bind(Uuid::new_v4()).bind(id).bind(actor).bind(input.permits_commercial_use).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO outbox (id,topic,aggregate_type,aggregate_id,payload,available_at,created_at) VALUES ($1,'audio.recognition_requested.v1','audio_track',$2,$3,now(),now())")
            .bind(Uuid::new_v4()).bind(id.to_string()).bind(serde_json::json!({"track_id":id})).execute(&mut *tx).await?;
        let track = track_from_row(&row)?;
        tx.commit().await?;
        Ok(track)
    }

    /// Called by a trusted fingerprint adapter. A match records attribution but never grants rights.
    pub async fn record_recognition(
        &self,
        track: Uuid,
        provider: &str,
        matched: Option<RecognitionMatch>,
    ) -> Result<(), AudioError> {
        let mut tx = self.pool.begin().await?;
        if let Some(value) = matched {
            sqlx::query("INSERT INTO audio_recognition_matches (id,track_id,provider,provider_recording_id,title,artist_name,album_title,isrc,confidence_millionths,attribution,raw_reference) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING")
                .bind(Uuid::new_v4()).bind(track).bind(provider).bind(value.provider_recording_id).bind(value.title).bind(value.artist_name).bind(value.album_title).bind(value.isrc).bind(value.confidence_millionths).bind(value.attribution).bind(value.raw_reference).execute(&mut *tx).await?;
            sqlx::query("UPDATE audio_tracks SET recognition_status='matched',rights_status='pending',attribution_text=$2 WHERE id=$1").bind(track).bind(value.attribution_text).execute(&mut *tx).await?;
        } else {
            sqlx::query("UPDATE audio_tracks SET recognition_status='no_match',rights_status='cleared' WHERE id=$1 AND EXISTS (SELECT 1 FROM audio_rights_grants WHERE track_id=$1 AND basis='creator_attestation' AND controls_recording AND controls_composition AND permits_sync AND permits_on_demand_streaming)").bind(track).execute(&mut *tx).await?;
        }
        tx.commit().await?;
        Ok(())
    }

    pub async fn attach(
        &self,
        actor: Uuid,
        post: Uuid,
        input: AttachPostAudio,
    ) -> Result<(), AudioError> {
        let mut tx = self.pool.begin().await?;
        let owns_post: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM tardy_posts WHERE id=$1 AND author_profile_id=$2)",
        )
        .bind(post)
        .bind(actor)
        .fetch_one(&mut *tx)
        .await?;
        if !owns_post {
            return Err(AudioError::Forbidden);
        }
        let cleared: bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM audio_tracks t JOIN audio_rights_grants g ON g.track_id=t.id WHERE t.id=$1 AND t.rights_status='cleared' AND g.permits_sync AND g.permits_on_demand_streaming AND (g.valid_until IS NULL OR g.valid_until>now()))").bind(input.track_id).fetch_one(&mut *tx).await?;
        if !cleared {
            return Err(AudioError::RightsNotCleared);
        }
        sqlx::query("INSERT INTO post_audio (post_id,track_id,attached_by_profile_id,start_ms,duration_ms,volume_millipercent) VALUES ($1,$2,$3,$4,$5,$6)")
            .bind(post).bind(input.track_id).bind(actor).bind(input.start_ms).bind(input.duration_ms).bind(input.volume_millipercent).execute(&mut *tx).await?;
        insert_usage(
            &mut tx,
            input.track_id,
            Some(post),
            Some(actor),
            "post_created",
            Uuid::new_v4(),
            input.duration_ms,
            None,
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn usage(
        &self,
        actor: Option<Uuid>,
        track: Uuid,
        input: AudioUsage,
    ) -> Result<(), AudioError> {
        let kind = match input.kind {
            AudioUsageKind::PlayStarted => "play_started",
            AudioUsageKind::QualifiedPlay => "qualified_play",
            AudioUsageKind::PlayCompleted => "play_completed",
            AudioUsageKind::Export => "export",
        };
        let mut tx = self.pool.begin().await?;
        insert_usage(
            &mut tx,
            track,
            input.post_id,
            actor,
            kind,
            input.event_id,
            input.listen_ms,
            input.territory.as_deref(),
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn trending(&self, limit: i64) -> Result<Vec<TrendingAudio>, AudioError> {
        if !(1..=100).contains(&limit) {
            return Err(AudioError::Invalid("limit must be 1-100"));
        }
        let rows=sqlx::query("SELECT t.*,count(*) FILTER (WHERE e.kind='post_created')::bigint uses,count(*) FILTER (WHERE e.kind IN ('qualified_play','play_completed'))::bigint plays,(count(*) FILTER (WHERE e.kind='post_created')*100+count(*) FILTER (WHERE e.kind='qualified_play')*10+count(*) FILTER (WHERE e.kind='play_completed')*20)::bigint score FROM audio_tracks t JOIN audio_usage_events e ON e.track_id=t.id AND e.occurred_at>=now()-interval '24 hours' WHERE t.rights_status='cleared' GROUP BY t.id ORDER BY score DESC,t.id LIMIT $1").bind(limit).fetch_all(&self.pool).await?;
        rows.into_iter()
            .map(|row| {
                Ok(TrendingAudio {
                    track: track_from_row(&row)?,
                    uses_24h: row.try_get("uses")?,
                    qualified_plays_24h: row.try_get("plays")?,
                    score: row.try_get("score")?,
                })
            })
            .collect()
    }
}

#[derive(Debug, Clone)]
pub struct RecognitionMatch {
    pub provider_recording_id: String,
    pub title: Option<String>,
    pub artist_name: Option<String>,
    pub album_title: Option<String>,
    pub isrc: Option<String>,
    pub confidence_millionths: i32,
    pub attribution_text: Option<String>,
    pub attribution: serde_json::Value,
    pub raw_reference: serde_json::Value,
}

async fn insert_usage(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    track: Uuid,
    post: Option<Uuid>,
    actor: Option<Uuid>,
    kind: &str,
    event: Uuid,
    listen: i64,
    territory: Option<&str>,
) -> Result<(), AudioError> {
    let usage_id = Uuid::new_v4();
    let inserted=sqlx::query_scalar::<_,Uuid>("INSERT INTO audio_usage_events (id,track_id,post_id,actor_profile_id,kind,idempotency_key,occurred_at,listen_ms,territory) VALUES ($1,$2,$3,$4,$5,$6,now(),$7,$8) ON CONFLICT (track_id,idempotency_key) DO NOTHING RETURNING id").bind(usage_id).bind(track).bind(post).bind(actor).bind(kind).bind(event).bind(listen).bind(territory).fetch_optional(&mut **tx).await?;
    if inserted.is_some()
        && matches!(
            kind,
            "qualified_play" | "play_completed" | "export" | "post_created"
        )
    {
        sqlx::query("INSERT INTO audio_royalty_ledger (id,usage_event_id,payee_profile_id,right_type,amount_micros,calculation_version) SELECT gen_random_uuid(),$1,grantor_profile_id,right_type,0,'pending-rates-v1' FROM audio_rights_grants CROSS JOIN (VALUES ('recording'),('composition')) rights(right_type) WHERE track_id=$2 ON CONFLICT DO NOTHING")
            .bind(usage_id).bind(track).execute(&mut **tx).await?;
    }
    Ok(())
}
fn release_name(v: ReleaseType) -> &'static str {
    match v {
        ReleaseType::Single => "single",
        ReleaseType::Ep => "ep",
        ReleaseType::Album => "album",
    }
}
fn text(v: &str, max: usize) -> Result<&str, AudioError> {
    let v = v.trim();
    if v.is_empty() || v.len() > max {
        Err(AudioError::Invalid("text is empty or too long"))
    } else {
        Ok(v)
    }
}
fn track_from_row(row: &sqlx::postgres::PgRow) -> Result<AudioTrack, AudioError> {
    Ok(AudioTrack {
        id: row.try_get("id")?,
        release_id: row.try_get("release_id")?,
        uploader_profile_id: row.try_get("uploader_profile_id")?,
        title: row.try_get("title")?,
        artist_name: row.try_get("artist_name")?,
        duration_ms: row.try_get("duration_ms")?,
        recognition_status: row.try_get("recognition_status")?,
        rights_status: row.try_get("rights_status")?,
        attribution_text: row.try_get("attribution_text")?,
    })
}
