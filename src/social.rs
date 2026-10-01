use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum SocialError {
    #[error("social database: {0}")]
    Database(#[from] sqlx::Error),
    #[error("invalid social request: {0}")]
    Invalid(&'static str),
    #[error("social resource not found")]
    NotFound,
    #[error("social action is not permitted")]
    Forbidden,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum IdentityKind {
    Human,
    Agent,
    Project,
    Channel,
}

impl Default for IdentityKind {
    fn default() -> Self {
        Self::Human
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ConversationMode {
    Dm,
    Work,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PostVisibility {
    Private,
    Followers,
    Public,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct SocialIdentity {
    pub profile_id: Uuid,
    pub account_id: Uuid,
    pub handle: String,
    pub kind: IdentityKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct Conversation {
    pub id: Uuid,
    pub mode: ConversationMode,
    pub participants: Vec<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ConversationMessage {
    pub id: Uuid,
    pub conversation_id: Uuid,
    pub sequence: i64,
    pub sender_profile_id: Uuid,
    pub body: String,
    pub shared_link_id: Option<Uuid>,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct SharedLink {
    pub id: Uuid,
    pub canonical_url: String,
    pub provider: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct TardyPost {
    pub id: Uuid,
    pub author_profile_id: Uuid,
    pub caption: String,
    pub shared_link_id: Option<Uuid>,
    pub visibility: PostVisibility,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct Comment {
    pub id: Uuid,
    pub post_id: Uuid,
    pub author_profile_id: Uuid,
    pub body: String,
    pub mentioned_profile_ids: Vec<Uuid>,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: DateTime<Utc>,
}

#[derive(Clone)]
pub struct PgSocialStore {
    pool: PgPool,
}

impl PgSocialStore {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn register_identity(
        &self,
        account_id: Uuid,
        profile_id: Uuid,
        handle: &str,
        kind: IdentityKind,
    ) -> Result<SocialIdentity, SocialError> {
        let handle = normalize_handle(handle)?;
        sqlx::query("INSERT INTO social_identities (profile_id,account_id,handle,kind) VALUES ($1,$2,$3,$4) ON CONFLICT (profile_id) DO UPDATE SET account_id=excluded.account_id,handle=excluded.handle,kind=excluded.kind")
            .bind(profile_id).bind(account_id).bind(&handle).bind(kind_name(kind)).execute(&self.pool).await?;
        Ok(SocialIdentity {
            profile_id,
            account_id,
            handle,
            kind,
        })
    }

    pub async fn transfer_identity(
        &self,
        profile_id: Uuid,
        account_id: Uuid,
    ) -> Result<(), SocialError> {
        let result = sqlx::query("UPDATE social_identities SET account_id=$1 WHERE profile_id=$2")
            .bind(account_id)
            .bind(profile_id)
            .execute(&self.pool)
            .await?;
        if result.rows_affected() == 1 {
            Ok(())
        } else {
            Err(SocialError::NotFound)
        }
    }

    pub async fn delete_identities(&self, profile_ids: &[Uuid]) -> Result<(), SocialError> {
        sqlx::query("DELETE FROM social_identities WHERE profile_id=ANY($1)")
            .bind(profile_ids)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn follow(&self, actor: Uuid, target: Uuid) -> Result<(), SocialError> {
        if actor == target {
            return Err(SocialError::Invalid("cannot follow yourself"));
        }
        let result = sqlx::query("INSERT INTO profile_follows (follower_profile_id,followed_profile_id) VALUES ($1,$2) ON CONFLICT DO NOTHING")
            .bind(actor).bind(target).execute(&self.pool).await;
        map_foreign_key(result)?;
        Ok(())
    }

    pub async fn unfollow(&self, actor: Uuid, target: Uuid) -> Result<(), SocialError> {
        sqlx::query(
            "DELETE FROM profile_follows WHERE follower_profile_id=$1 AND followed_profile_id=$2",
        )
        .bind(actor)
        .bind(target)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn create_conversation(
        &self,
        actor: Uuid,
        recipient: Uuid,
    ) -> Result<Conversation, SocialError> {
        if actor == recipient {
            return Err(SocialError::Invalid(
                "conversation requires another participant",
            ));
        }
        let mut tx = self.pool.begin().await?;
        require_identity(&mut tx, actor).await?;
        let recipient_kind = require_identity(&mut tx, recipient).await?;
        let mode = if recipient_kind == IdentityKind::Agent {
            ConversationMode::Work
        } else {
            ConversationMode::Dm
        };
        let id = Uuid::new_v4();
        sqlx::query("INSERT INTO conversations (id,mode,created_by,promoted_by,promoted_at) VALUES ($1,$2,$3,CASE WHEN $2='work' THEN $3 END,CASE WHEN $2='work' THEN now() END)")
            .bind(id).bind(mode_name(mode)).bind(actor).execute(&mut *tx).await?;
        for profile in [actor, recipient] {
            sqlx::query("INSERT INTO conversation_participants (conversation_id,profile_id,invited_by) VALUES ($1,$2,$3)").bind(id).bind(profile).bind(actor).execute(&mut *tx).await?;
        }
        if mode == ConversationMode::Work {
            sqlx::query("INSERT INTO conversation_agent_grants (conversation_id,agent_profile_id,granted_by,context_from_sequence) VALUES ($1,$2,$3,1)")
                .bind(id).bind(recipient).bind(actor).execute(&mut *tx).await?;
        }
        tx.commit().await?;
        Ok(Conversation {
            id,
            mode,
            participants: vec![actor, recipient],
        })
    }

    pub async fn conversations(&self, actor: Uuid) -> Result<Vec<Conversation>, SocialError> {
        let rows = sqlx::query(
            "SELECT c.id,c.mode,array_agg(p.profile_id ORDER BY p.joined_at,p.profile_id) AS participants
             FROM conversations c JOIN conversation_participants mine ON mine.conversation_id=c.id AND mine.profile_id=$1
             JOIN conversation_participants p ON p.conversation_id=c.id
             GROUP BY c.id,c.mode,c.created_at ORDER BY c.created_at DESC,c.id",
        )
        .bind(actor)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                let mode: String = row.try_get("mode")?;
                Ok(Conversation {
                    id: row.try_get("id")?,
                    mode: parse_mode(&mode)?,
                    participants: row.try_get("participants")?,
                })
            })
            .collect()
    }

    pub async fn messages(
        &self,
        actor: Uuid,
        conversation_id: Uuid,
        after: i64,
        limit: i64,
    ) -> Result<Vec<ConversationMessage>, SocialError> {
        if after < 0 || !(1..=100).contains(&limit) {
            return Err(SocialError::Invalid("invalid message cursor or limit"));
        }
        let allowed: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM conversation_participants WHERE conversation_id=$1 AND profile_id=$2)")
            .bind(conversation_id).bind(actor).fetch_one(&self.pool).await?;
        if !allowed {
            return Err(SocialError::Forbidden);
        }
        let rows = sqlx::query("SELECT id,conversation_id,sequence,sender_profile_id,body,shared_link_id,created_at FROM conversation_messages WHERE conversation_id=$1 AND sequence>$2 ORDER BY sequence LIMIT $3")
            .bind(conversation_id).bind(after).bind(limit).fetch_all(&self.pool).await?;
        rows.into_iter().map(|row| message_from_row(&row)).collect()
    }

    pub async fn summon_agent(
        &self,
        actor_account: Uuid,
        actor: Uuid,
        conversation_id: Uuid,
        agent: Uuid,
        include_anchor_share: bool,
    ) -> Result<Conversation, SocialError> {
        let mut tx = self.pool.begin().await?;
        require_participant(&mut tx, conversation_id, actor).await?;
        if require_identity(&mut tx, agent).await? != IdentityKind::Agent {
            return Err(SocialError::Invalid("summoned profile is not an agent"));
        }
        let owns_agent: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM social_identities WHERE profile_id=$1 AND account_id=$2)",
        )
        .bind(agent)
        .bind(actor_account)
        .fetch_one(&mut *tx)
        .await?;
        if !owns_agent {
            return Err(SocialError::Forbidden);
        }
        let next_sequence: i64 = sqlx::query_scalar("SELECT COALESCE(max(sequence),0)+1 FROM conversation_messages WHERE conversation_id=$1").bind(conversation_id).fetch_one(&mut *tx).await?;
        sqlx::query("UPDATE conversations SET mode='work',promoted_by=COALESCE(promoted_by,$2),promoted_at=COALESCE(promoted_at,now()) WHERE id=$1")
            .bind(conversation_id).bind(actor).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO conversation_participants (conversation_id,profile_id,invited_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING")
            .bind(conversation_id).bind(agent).bind(actor).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO conversation_agent_grants (conversation_id,agent_profile_id,granted_by,context_from_sequence,include_anchor_share) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING")
            .bind(conversation_id).bind(agent).bind(actor).bind(next_sequence).bind(include_anchor_share).execute(&mut *tx).await?;
        emit_agent_event(&mut tx, "agent_share", conversation_id, agent, serde_json::json!({"conversation_id": conversation_id, "context_from_sequence": next_sequence, "include_anchor_share": include_anchor_share})).await?;
        let participants = sqlx::query_scalar("SELECT profile_id FROM conversation_participants WHERE conversation_id=$1 ORDER BY joined_at,profile_id").bind(conversation_id).fetch_all(&mut *tx).await?;
        tx.commit().await?;
        Ok(Conversation {
            id: conversation_id,
            mode: ConversationMode::Work,
            participants,
        })
    }

    pub async fn add_shared_link(&self, raw_url: &str) -> Result<SharedLink, SocialError> {
        let (canonical_url, provider) = canonicalize_url(raw_url)?;
        let id = Uuid::new_v4();
        let mut tx = self.pool.begin().await?;
        let row = sqlx::query("INSERT INTO shared_links (id,canonical_url,provider) VALUES ($1,$2,$3) ON CONFLICT (canonical_url) DO UPDATE SET canonical_url=excluded.canonical_url RETURNING id,canonical_url,provider,status")
            .bind(id).bind(&canonical_url).bind(&provider).fetch_one(&mut *tx).await?;
        let stored_id: Uuid = row.try_get("id")?;
        if stored_id == id {
            sqlx::query("INSERT INTO outbox (id,topic,aggregate_type,aggregate_id,payload,available_at,created_at) VALUES ($1,'shared_link.enrichment_requested.v1','shared_link',$2,$3,now(),now()) ON CONFLICT DO NOTHING")
                .bind(Uuid::new_v4()).bind(id.to_string()).bind(serde_json::json!({"shared_link_id": id, "canonical_url": canonical_url, "provider": provider})).execute(&mut *tx).await?;
        }
        let link = SharedLink {
            id: stored_id,
            canonical_url: row.try_get("canonical_url")?,
            provider: row.try_get("provider")?,
            status: row.try_get("status")?,
        };
        tx.commit().await?;
        Ok(link)
    }

    pub async fn send_message(
        &self,
        actor: Uuid,
        conversation_id: Uuid,
        body: &str,
        shared_link_id: Option<Uuid>,
    ) -> Result<ConversationMessage, SocialError> {
        let body = validated_text(body, 10_000)?;
        let mut tx = self.pool.begin().await?;
        require_participant(&mut tx, conversation_id, actor).await?;
        sqlx::query("SELECT id FROM conversations WHERE id=$1 FOR UPDATE")
            .bind(conversation_id)
            .fetch_one(&mut *tx)
            .await?;
        let sequence: i64 = sqlx::query_scalar("SELECT COALESCE(max(sequence),0)+1 FROM conversation_messages WHERE conversation_id=$1").bind(conversation_id).fetch_one(&mut *tx).await?;
        let id = Uuid::new_v4();
        let row = sqlx::query("INSERT INTO conversation_messages (id,conversation_id,sequence,sender_profile_id,body,shared_link_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING created_at")
            .bind(id).bind(conversation_id).bind(sequence).bind(actor).bind(body).bind(shared_link_id).fetch_one(&mut *tx).await?;
        let agents: Vec<Uuid> = sqlx::query_scalar("SELECT agent_profile_id FROM conversation_agent_grants WHERE conversation_id=$1 AND can_reply AND agent_profile_id<>$2 AND context_from_sequence<=$3")
            .bind(conversation_id).bind(actor).bind(sequence).fetch_all(&mut *tx).await?;
        for agent in agents {
            emit_agent_event(&mut tx, "work_message", id, agent, serde_json::json!({"conversation_id": conversation_id, "message_id": id, "sequence": sequence, "body": body, "shared_link_id": shared_link_id})).await?;
        }
        let message = ConversationMessage {
            id,
            conversation_id,
            sequence,
            sender_profile_id: actor,
            body: body.into(),
            shared_link_id,
            created_at: row.try_get("created_at")?,
        };
        tx.commit().await?;
        Ok(message)
    }

    pub async fn publish_post(
        &self,
        actor: Uuid,
        client_request_id: Uuid,
        caption: &str,
        shared_link_id: Option<Uuid>,
        visibility: PostVisibility,
    ) -> Result<TardyPost, SocialError> {
        let caption = validated_text(caption, 5_000)?;
        let row = sqlx::query("INSERT INTO tardy_posts (id,author_profile_id,client_request_id,caption,shared_link_id,visibility) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (author_profile_id,client_request_id) DO UPDATE SET client_request_id=excluded.client_request_id RETURNING id,author_profile_id,caption,shared_link_id,visibility,created_at")
            .bind(Uuid::new_v4()).bind(actor).bind(client_request_id).bind(caption).bind(shared_link_id).bind(visibility_name(visibility)).fetch_one(&self.pool).await?;
        Ok(post_from_row(&row)?)
    }

    pub async fn comment(
        &self,
        actor: Uuid,
        post_id: Uuid,
        body: &str,
        mentions: &[Uuid],
    ) -> Result<Comment, SocialError> {
        let body = validated_text(body, 5_000)?;
        let mut unique = mentions.to_vec();
        unique.sort();
        unique.dedup();
        if unique.len() > 20 {
            return Err(SocialError::Invalid("too many mentions"));
        }
        let mut tx = self.pool.begin().await?;
        let exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM tardy_posts WHERE id=$1)")
                .bind(post_id)
                .fetch_one(&mut *tx)
                .await?;
        if !exists {
            return Err(SocialError::NotFound);
        }
        let id = Uuid::new_v4();
        let created_at: DateTime<Utc> = sqlx::query_scalar("INSERT INTO post_comments (id,post_id,author_profile_id,body) VALUES ($1,$2,$3,$4) RETURNING created_at")
            .bind(id).bind(post_id).bind(actor).bind(body).fetch_one(&mut *tx).await?;
        for mentioned in &unique {
            let kind = require_identity(&mut tx, *mentioned).await?;
            let reply_requested = kind == IdentityKind::Agent;
            sqlx::query("INSERT INTO comment_mentions (comment_id,mentioned_profile_id,reply_requested) VALUES ($1,$2,$3)").bind(id).bind(mentioned).bind(reply_requested).execute(&mut *tx).await?;
            let event_kind = if reply_requested {
                "agent_reply_requested"
            } else {
                "comment_mention"
            };
            emit_agent_event(&mut tx, event_kind, id, *mentioned, serde_json::json!({"post_id": post_id, "comment_id": id, "body": body, "reply_requested": reply_requested})).await?;
        }
        tx.commit().await?;
        Ok(Comment {
            id,
            post_id,
            author_profile_id: actor,
            body: body.into(),
            mentioned_profile_ids: unique,
            created_at,
        })
    }
}

async fn require_identity(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    profile: Uuid,
) -> Result<IdentityKind, SocialError> {
    let kind: Option<String> =
        sqlx::query_scalar("SELECT kind FROM social_identities WHERE profile_id=$1")
            .bind(profile)
            .fetch_optional(&mut **tx)
            .await?;
    kind.map(|value| parse_kind(&value))
        .transpose()?
        .ok_or(SocialError::NotFound)
}

async fn require_participant(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    conversation: Uuid,
    actor: Uuid,
) -> Result<(), SocialError> {
    let allowed: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM conversation_participants WHERE conversation_id=$1 AND profile_id=$2)").bind(conversation).bind(actor).fetch_one(&mut **tx).await?;
    if allowed {
        Ok(())
    } else {
        Err(SocialError::Forbidden)
    }
}

async fn emit_agent_event(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    kind: &str,
    _subject: Uuid,
    recipient: Uuid,
    payload: serde_json::Value,
) -> Result<(), SocialError> {
    let event_id: Option<i64> = sqlx::query_scalar("INSERT INTO feed_events (kind,subject_id,recipient_profile_id,hashtags,payload) VALUES ($1,$2,$3,'{}',$4) ON CONFLICT (kind,subject_id) DO NOTHING RETURNING id")
        .bind(kind).bind(Uuid::new_v4()).bind(recipient).bind(payload).fetch_optional(&mut **tx).await?;
    if let Some(event_id) = event_id {
        sqlx::query("INSERT INTO webhook_deliveries (id,subscription_id,event_id) SELECT gen_random_uuid(),id,$1 FROM feed_subscriptions WHERE active AND delivery='webhook' AND kind='agent_inbox' AND profile_id=$2 ON CONFLICT DO NOTHING")
            .bind(event_id).bind(recipient).execute(&mut **tx).await?;
    }
    Ok(())
}

fn canonicalize_url(raw: &str) -> Result<(String, String), SocialError> {
    let mut parsed = url::Url::parse(raw).map_err(|_| SocialError::Invalid("invalid share URL"))?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err(SocialError::Invalid("share URL must be HTTP(S)"));
    }
    parsed.set_fragment(None);
    let normalized_host = parsed
        .host_str()
        .unwrap_or_default()
        .trim_start_matches("www.")
        .to_ascii_lowercase();
    parsed
        .set_host(Some(&normalized_host))
        .map_err(|_| SocialError::Invalid("invalid share URL host"))?;
    let mut retained: Vec<(String, String)> = parsed
        .query_pairs()
        .filter(|(key, _)| {
            !key.starts_with("utm_") && !matches!(key.as_ref(), "fbclid" | "gclid" | "si")
        })
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    retained.sort();
    parsed.set_query(None);
    if !retained.is_empty() {
        parsed.query_pairs_mut().extend_pairs(retained);
    }
    let host = parsed.host_str().unwrap_or_default();
    let provider = match host {
        "instagram.com" => "instagram",
        "tiktok.com" => "tiktok",
        "youtube.com" | "youtu.be" => "youtube",
        "github.com" => "github",
        _ => "web",
    }
    .to_owned();
    Ok((parsed.to_string(), provider))
}

fn normalize_handle(value: &str) -> Result<String, SocialError> {
    let value = value.trim().trim_start_matches('@').to_ascii_lowercase();
    if value.len() < 2
        || value.len() > 32
        || !value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
    {
        return Err(SocialError::Invalid("invalid handle"));
    }
    Ok(value)
}
fn validated_text(value: &str, max: usize) -> Result<&str, SocialError> {
    let value = value.trim();
    if value.is_empty() || value.len() > max {
        Err(SocialError::Invalid("text is empty or too long"))
    } else {
        Ok(value)
    }
}
fn kind_name(value: IdentityKind) -> &'static str {
    match value {
        IdentityKind::Human => "human",
        IdentityKind::Agent => "agent",
        IdentityKind::Project => "project",
        IdentityKind::Channel => "channel",
    }
}
fn parse_kind(value: &str) -> Result<IdentityKind, SocialError> {
    match value {
        "human" => Ok(IdentityKind::Human),
        "agent" => Ok(IdentityKind::Agent),
        "project" => Ok(IdentityKind::Project),
        "channel" => Ok(IdentityKind::Channel),
        _ => Err(SocialError::Invalid("persisted identity kind")),
    }
}
fn mode_name(value: ConversationMode) -> &'static str {
    match value {
        ConversationMode::Dm => "dm",
        ConversationMode::Work => "work",
    }
}
fn parse_mode(value: &str) -> Result<ConversationMode, SocialError> {
    match value {
        "dm" => Ok(ConversationMode::Dm),
        "work" => Ok(ConversationMode::Work),
        _ => Err(SocialError::Invalid("persisted conversation mode")),
    }
}
fn visibility_name(value: PostVisibility) -> &'static str {
    match value {
        PostVisibility::Private => "private",
        PostVisibility::Followers => "followers",
        PostVisibility::Public => "public",
    }
}
fn parse_visibility(value: &str) -> Result<PostVisibility, SocialError> {
    match value {
        "private" => Ok(PostVisibility::Private),
        "followers" => Ok(PostVisibility::Followers),
        "public" => Ok(PostVisibility::Public),
        _ => Err(SocialError::Invalid("persisted visibility")),
    }
}
fn post_from_row(row: &sqlx::postgres::PgRow) -> Result<TardyPost, SocialError> {
    Ok(TardyPost {
        id: row.try_get("id")?,
        author_profile_id: row.try_get("author_profile_id")?,
        caption: row.try_get("caption")?,
        shared_link_id: row.try_get("shared_link_id")?,
        visibility: parse_visibility(row.try_get::<String, _>("visibility")?.as_str())?,
        created_at: row.try_get("created_at")?,
    })
}
fn message_from_row(row: &sqlx::postgres::PgRow) -> Result<ConversationMessage, SocialError> {
    Ok(ConversationMessage {
        id: row.try_get("id")?,
        conversation_id: row.try_get("conversation_id")?,
        sequence: row.try_get("sequence")?,
        sender_profile_id: row.try_get("sender_profile_id")?,
        body: row.try_get("body")?,
        shared_link_id: row.try_get("shared_link_id")?,
        created_at: row.try_get("created_at")?,
    })
}
fn map_foreign_key(
    result: Result<sqlx::postgres::PgQueryResult, sqlx::Error>,
) -> Result<sqlx::postgres::PgQueryResult, SocialError> {
    result.map_err(|error| {
        if error.as_database_error().and_then(|e| e.code()).as_deref() == Some("23503") {
            SocialError::NotFound
        } else {
            SocialError::Database(error)
        }
    })
}
