use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use std::collections::HashSet;
use utoipa::ToSchema;
use uuid::Uuid;

/// Who a profile follows and who follows it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FollowGraph {
    pub following: HashSet<Uuid>,
    pub followers: HashSet<Uuid>,
}

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

#[derive(Debug, Clone, Copy, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AppEngagementKind {
    Favorite,
    Unfavorite,
    Reply,
    Share,
    ShareViaDm,
    ShareViaCopyLink,
    PhotoExpand,
    VideoOpen,
    OpenLink,
    ProfileClick,
    Dwell,
    Vqv,
    NotInterested,
    Alarm,
    Unalarm,
    Repost,
    Unrepost,
    FollowAuthor,
    UnfollowAuthor,
}

impl AppEngagementKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Favorite => "favorite",
            Self::Unfavorite => "unfavorite",
            Self::Reply => "reply",
            Self::Share => "share",
            Self::ShareViaDm => "share_via_dm",
            Self::ShareViaCopyLink => "share_via_copy_link",
            Self::PhotoExpand => "photo_expand",
            Self::VideoOpen => "video_open",
            Self::OpenLink => "open_link",
            Self::ProfileClick => "profile_click",
            Self::Dwell => "dwell",
            Self::Vqv => "vqv",
            Self::NotInterested => "not_interested",
            Self::Alarm => "alarm",
            Self::Unalarm => "unalarm",
            Self::Repost => "repost",
            Self::Unrepost => "unrepost",
            Self::FollowAuthor => "follow_author",
            Self::UnfollowAuthor => "unfollow_author",
        }
    }

    fn targets_author(self) -> bool {
        matches!(self, Self::FollowAuthor | Self::UnfollowAuthor)
    }
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct AppEngagementAction {
    #[serde(rename = "type")]
    pub kind: AppEngagementKind,
    pub post_id: Option<Uuid>,
    pub author_id: Option<Uuid>,
    pub ms: Option<u64>,
    pub watched_ms: Option<u64>,
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
pub struct ConversationSummary {
    pub id: Uuid,
    pub mode: ConversationMode,
    pub participants: Vec<Uuid>,
    pub last_message: Option<ConversationMessage>,
    pub unread_count: i64,
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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reactions: Vec<ReactionSummary>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ReactionSummary {
    pub kind: String,
    pub account_ids: Vec<Uuid>,
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

#[derive(Debug, Clone, Serialize)]
pub struct AppFeedPost {
    pub id: Uuid,
    pub author_id: Uuid,
    pub format: &'static str,
    pub media: Vec<serde_json::Value>,
    pub caption: String,
    pub links: Vec<serde_json::Value>,
    pub created_at_ms: i64,
    pub like_count: i64,
    pub comment_count: i64,
    pub share_count: i64,
    pub alarm_count: i64,
    pub repost_count: i64,
    pub viewer_has_liked: bool,
    pub viewer_has_alarm: bool,
    pub viewer_has_reposted: bool,
    pub viewer_has_saved: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct AppAccount {
    pub id: Uuid,
    pub kind: IdentityKind,
    pub handle: String,
    pub display_name: String,
    pub avatar_url: String,
    pub bio: String,
    pub verified: bool,
    pub followers: i64,
    pub following: i64,
    pub post_count: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owned_by_viewer: Option<bool>,
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

    pub async fn record_engagements(
        &self,
        viewer: Uuid,
        actions: &[AppEngagementAction],
    ) -> Result<(), SocialError> {
        let mut tx = self.pool.begin().await?;
        for action in actions {
            let (post_id, author_id) = if action.kind.targets_author() {
                if action.post_id.is_some() || action.author_id.is_none() {
                    return Err(SocialError::Invalid("author engagement target"));
                }
                (None, action.author_id)
            } else {
                if action.author_id.is_some() || action.post_id.is_none() {
                    return Err(SocialError::Invalid("post engagement target"));
                }
                (action.post_id, None)
            };
            let duration = match action.kind {
                AppEngagementKind::Dwell => action.ms,
                AppEngagementKind::Vqv => action.watched_ms,
                _ if action.ms.is_some() || action.watched_ms.is_some() => {
                    return Err(SocialError::Invalid("unexpected engagement duration"));
                }
                _ => None,
            };
            if matches!(
                action.kind,
                AppEngagementKind::Dwell | AppEngagementKind::Vqv
            ) && duration.is_none()
            {
                return Err(SocialError::Invalid("missing engagement duration"));
            }

            if let Some(post_id) = post_id {
                let visible: bool = sqlx::query_scalar(
                    "SELECT EXISTS(SELECT 1 FROM tardy_posts p WHERE p.id=$1 AND
                     (p.visibility='public' OR p.author_profile_id=$2 OR
                      (p.visibility='followers' AND EXISTS(SELECT 1 FROM profile_follows f
                       WHERE f.follower_profile_id=$2 AND f.followed_profile_id=p.author_profile_id))))",
                )
                .bind(post_id)
                .bind(viewer)
                .fetch_one(&mut *tx)
                .await?;
                if !visible {
                    continue;
                }
            }
            if let Some(author_id) = author_id {
                let exists: bool = sqlx::query_scalar(
                    "SELECT EXISTS(SELECT 1 FROM social_identities WHERE profile_id=$1)",
                )
                .bind(author_id)
                .fetch_one(&mut *tx)
                .await?;
                if !exists {
                    continue;
                }
            }

            let duration = duration
                .map(i64::try_from)
                .transpose()
                .map_err(|_| SocialError::Invalid("engagement duration is too large"))?;

            sqlx::query(
                "INSERT INTO engagement_events
                 (id,viewer_profile_id,kind,post_id,author_id,duration_ms)
                 VALUES ($1,$2,$3,$4,$5,$6)",
            )
            .bind(Uuid::new_v4())
            .bind(viewer)
            .bind(action.kind.as_str())
            .bind(post_id)
            .bind(author_id)
            .bind(duration)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    pub async fn app_feed(
        &self,
        viewer: Option<Uuid>,
        limit: i64,
    ) -> Result<Vec<AppFeedPost>, SocialError> {
        let rows = sqlx::query(
            "SELECT p.id,p.author_profile_id,p.caption,p.created_at,l.canonical_url,
                    (SELECT count(*) FROM post_comments c WHERE c.post_id=p.id)::bigint AS comment_count
             FROM tardy_posts p
             LEFT JOIN shared_links l ON l.id=p.shared_link_id
             WHERE p.visibility='public'
                OR p.author_profile_id=$1
                OR (p.visibility='followers' AND EXISTS (
                    SELECT 1 FROM profile_follows f
                    WHERE f.follower_profile_id=$1 AND f.followed_profile_id=p.author_profile_id))
             ORDER BY p.created_at DESC,p.id DESC LIMIT $2",
        )
        .bind(viewer)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                let link: Option<String> = row.try_get("canonical_url")?;
                Ok(AppFeedPost {
                    id: row.try_get("id")?,
                    author_id: row.try_get("author_profile_id")?,
                    format: "photo",
                    media: Vec::new(),
                    caption: row.try_get("caption")?,
                    links: link
                        .map(|url| {
                            vec![serde_json::json!({"kind":"other","label":"Open link","url":url})]
                        })
                        .unwrap_or_default(),
                    created_at_ms: row
                        .try_get::<DateTime<Utc>, _>("created_at")?
                        .timestamp_millis(),
                    like_count: 0,
                    comment_count: row.try_get("comment_count")?,
                    share_count: 0,
                    alarm_count: 0,
                    repost_count: 0,
                    viewer_has_liked: false,
                    viewer_has_alarm: false,
                    viewer_has_reposted: false,
                    viewer_has_saved: false,
                })
            })
            .collect()
    }

    /// Posts visible to `viewer`, optionally restricted to one author. The app's first
    /// feed contract deliberately uses a bounded, non-opaque page: callers return a null
    /// cursor until keyset pagination is added rather than pretending an offset is stable.
    pub async fn app_posts(
        &self,
        viewer: Option<Uuid>,
        author: Option<Uuid>,
        limit: i64,
    ) -> Result<Vec<AppFeedPost>, SocialError> {
        let rows = sqlx::query(
            "SELECT p.id,p.author_profile_id,p.caption,p.created_at,l.canonical_url,
                    (SELECT count(*) FROM post_comments c WHERE c.post_id=p.id)::bigint AS comment_count
             FROM tardy_posts p
             LEFT JOIN shared_links l ON l.id=p.shared_link_id
             WHERE ($2::uuid IS NULL OR p.author_profile_id=$2)
               AND (p.visibility='public'
                    OR p.author_profile_id=$1
                    OR (p.visibility='followers' AND EXISTS (
                        SELECT 1 FROM profile_follows f
                        WHERE f.follower_profile_id=$1 AND f.followed_profile_id=p.author_profile_id)))
             ORDER BY p.created_at DESC,p.id DESC LIMIT $3",
        )
        .bind(viewer)
        .bind(author)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(app_post_from_row).collect()
    }

    pub async fn app_accounts(&self, ids: &[Uuid]) -> Result<Vec<AppAccount>, SocialError> {
        let rows = sqlx::query(
            "SELECT i.profile_id,i.kind,i.handle,
                    COALESCE(h.display_name,i.handle) AS display_name,
                    COALESCE(NULLIF(h.avatar_url,''),'https://tardy.news/favicon.svg') AS avatar_url,
                    COALESCE(h.bio,'') AS bio,
                    (SELECT count(*) FROM profile_follows f WHERE f.followed_profile_id=i.profile_id)::bigint AS followers,
                    (SELECT count(*) FROM profile_follows f WHERE f.follower_profile_id=i.profile_id)::bigint AS following,
                    (SELECT count(*) FROM tardy_posts p WHERE p.author_profile_id=i.profile_id)::bigint AS post_count
             FROM social_identities i
             LEFT JOIN human_profiles h ON h.profile_id=i.profile_id
             WHERE i.profile_id=ANY($1)",
        )
        .bind(ids)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(app_account_from_row).collect()
    }

    pub async fn app_account_by_id(&self, id: Uuid) -> Result<AppAccount, SocialError> {
        let accounts = self.app_accounts(&[id]).await?;
        accounts.into_iter().next().ok_or(SocialError::NotFound)
    }

    pub async fn app_account_by_handle(&self, handle: &str) -> Result<AppAccount, SocialError> {
        let handle = normalize_handle(handle)?;
        let id = sqlx::query_scalar("SELECT profile_id FROM social_identities WHERE handle=$1")
            .bind(handle)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(SocialError::NotFound)?;
        self.app_account_by_id(id).await
    }

    pub async fn search_app_accounts(
        &self,
        viewer_account: Uuid,
        query: &str,
        limit: i64,
    ) -> Result<Vec<AppAccount>, SocialError> {
        let query = query.trim().to_ascii_lowercase();
        if query.len() > 100 || !(1..=100).contains(&limit) {
            return Err(SocialError::Invalid("invalid profile search"));
        }
        let pattern = format!("%{query}%");
        let prefix = format!("{query}%");
        let rows = sqlx::query(
            "SELECT i.profile_id,i.kind,i.handle,
                    COALESCE(h.display_name,i.handle) AS display_name,
                    COALESCE(NULLIF(h.avatar_url,''),'https://tardy.news/favicon.svg') AS avatar_url,
                    COALESCE(h.bio,'') AS bio,
                    (SELECT count(*) FROM profile_follows f WHERE f.followed_profile_id=i.profile_id)::bigint AS followers,
                    (SELECT count(*) FROM profile_follows f WHERE f.follower_profile_id=i.profile_id)::bigint AS following,
                    (SELECT count(*) FROM tardy_posts p WHERE p.author_profile_id=i.profile_id)::bigint AS post_count,
                    i.account_id=$1 AS owned_by_viewer
             FROM social_identities i
             LEFT JOIN human_profiles h ON h.profile_id=i.profile_id
             WHERE $2='' OR i.handle ILIKE $3 OR COALESCE(h.display_name,i.handle) ILIKE $3
             ORDER BY (i.account_id=$1 AND i.kind='agent') DESC,
                      (lower(i.handle)=$2) DESC,
                      (i.handle ILIKE $4) DESC,
                      i.handle
             LIMIT $5",
        )
        .bind(viewer_account)
        .bind(&query)
        .bind(pattern)
        .bind(prefix)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(app_account_from_row).collect()
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

    /// The viewer's follow graph for ranking, in one query: who they follow, and who follows
    /// them back (for the value model's mutual-follow boost).
    pub async fn follow_graph(&self, viewer: Uuid) -> Result<FollowGraph, SocialError> {
        let rows = sqlx::query(
            "SELECT followed_profile_id AS id, true AS outbound FROM profile_follows WHERE follower_profile_id=$1
             UNION ALL
             SELECT follower_profile_id AS id, false AS outbound FROM profile_follows WHERE followed_profile_id=$1",
        )
        .bind(viewer)
        .fetch_all(&self.pool)
        .await?;
        let mut graph = FollowGraph::default();
        for row in rows {
            let id: Uuid = row.try_get("id")?;
            if row.try_get::<bool, _>("outbound")? {
                graph.following.insert(id);
            } else {
                graph.followers.insert(id);
            }
        }
        Ok(graph)
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

    pub async fn conversations(
        &self,
        actor: Uuid,
    ) -> Result<Vec<ConversationSummary>, SocialError> {
        let rows = sqlx::query(
            "SELECT c.id,c.mode,array_agg(DISTINCT p.profile_id ORDER BY p.profile_id) AS participants,
                    mine.last_read_sequence,
                    last_message.id AS last_id,last_message.sequence AS last_sequence,
                    last_message.sender_profile_id AS last_sender_profile_id,
                    last_message.body AS last_body,last_message.shared_link_id AS last_shared_link_id,
                    last_message.created_at AS last_created_at,last_message.reactions AS last_reactions,
                    count(DISTINCT unread.id) FILTER (WHERE unread.sender_profile_id<>$1) AS unread_count
             FROM conversations c JOIN conversation_participants mine ON mine.conversation_id=c.id AND mine.profile_id=$1
             JOIN conversation_participants p ON p.conversation_id=c.id
             LEFT JOIN LATERAL (
                 SELECT m.id,m.sequence,m.sender_profile_id,m.body,m.shared_link_id,m.created_at,
                        (SELECT COALESCE(jsonb_agg(jsonb_build_object('kind',r.kind,'account_ids',r.account_ids)
                             ORDER BY r.sort), '[]'::jsonb)
                         FROM (SELECT kind,array_agg(reactor_profile_id ORDER BY reactor_profile_id) account_ids,
                                      min(CASE kind WHEN 'like' THEN 1 WHEN 'love' THEN 2 WHEN 'laugh' THEN 3 WHEN 'emphasize' THEN 4 WHEN 'question' THEN 5 WHEN 'seen' THEN 6 ELSE 7 END) sort
                               FROM conversation_message_reactions WHERE message_id=m.id GROUP BY kind) r) AS reactions
                 FROM conversation_messages m WHERE m.conversation_id=c.id
                 ORDER BY m.sequence DESC LIMIT 1
             ) last_message ON true
             LEFT JOIN conversation_messages unread ON unread.conversation_id=c.id AND unread.sequence>mine.last_read_sequence
             GROUP BY c.id,c.mode,c.created_at,mine.last_read_sequence,last_message.id,last_message.sequence,
                      last_message.sender_profile_id,last_message.body,last_message.shared_link_id,last_message.created_at,
                      last_message.reactions
             ORDER BY COALESCE(last_message.created_at,c.created_at) DESC,c.id",
        )
        .bind(actor)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                let mode: String = row.try_get("mode")?;
                let id = row.try_get("id")?;
                let last_message = row
                    .try_get::<Option<Uuid>, _>("last_id")?
                    .map(|message_id| ConversationMessage {
                        id: message_id,
                        conversation_id: id,
                        sequence: row.try_get("last_sequence").expect("selected with last id"),
                        sender_profile_id: row
                            .try_get("last_sender_profile_id")
                            .expect("selected with last id"),
                        body: row.try_get("last_body").expect("selected with last id"),
                        shared_link_id: row
                            .try_get("last_shared_link_id")
                            .expect("selected with last id"),
                        created_at: row
                            .try_get("last_created_at")
                            .expect("selected with last id"),
                        reactions: serde_json::from_value(
                            row.try_get("last_reactions")
                                .expect("selected with last id"),
                        )
                        .expect("reaction rows have a stable shape"),
                    });
                Ok(ConversationSummary {
                    id,
                    mode: parse_mode(&mode)?,
                    participants: row.try_get("participants")?,
                    last_message,
                    unread_count: row.try_get("unread_count")?,
                })
            })
            .collect()
    }

    pub async fn mark_read(
        &self,
        actor: Uuid,
        conversation_id: Uuid,
        through_message_id: Uuid,
    ) -> Result<(), SocialError> {
        let updated = sqlx::query(
            "UPDATE conversation_participants p SET last_read_sequence=GREATEST(p.last_read_sequence,m.sequence)
             FROM conversation_messages m
             WHERE p.conversation_id=$1 AND p.profile_id=$2
               AND m.id=$3 AND m.conversation_id=p.conversation_id",
        )
        .bind(conversation_id)
        .bind(actor)
        .bind(through_message_id)
        .execute(&self.pool)
        .await?
        .rows_affected();
        if updated == 0 {
            return Err(SocialError::NotFound);
        }
        Ok(())
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
        let rows = sqlx::query("SELECT m.id,m.conversation_id,m.sequence,m.sender_profile_id,m.body,m.shared_link_id,m.created_at,
                    (SELECT COALESCE(jsonb_agg(jsonb_build_object('kind',r.kind,'account_ids',r.account_ids) ORDER BY r.sort), '[]'::jsonb)
                     FROM (SELECT kind,array_agg(reactor_profile_id ORDER BY reactor_profile_id) account_ids,
                                  min(CASE kind WHEN 'like' THEN 1 WHEN 'love' THEN 2 WHEN 'laugh' THEN 3 WHEN 'emphasize' THEN 4 WHEN 'question' THEN 5 WHEN 'seen' THEN 6 ELSE 7 END) sort
                           FROM conversation_message_reactions WHERE message_id=m.id GROUP BY kind) r) AS reactions
             FROM conversation_messages m WHERE m.conversation_id=$1 AND m.sequence>$2 ORDER BY m.sequence LIMIT $3")
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
            reactions: Vec::new(),
        };
        tx.commit().await?;
        Ok(message)
    }

    pub async fn react_to_message(
        &self,
        actor: Uuid,
        conversation_id: Uuid,
        message_id: Uuid,
        kind: &str,
    ) -> Result<ConversationMessage, SocialError> {
        if !matches!(
            kind,
            "like" | "love" | "laugh" | "emphasize" | "question" | "seen" | "done"
        ) {
            return Err(SocialError::Invalid("invalid reaction kind"));
        }
        let mut tx = self.pool.begin().await?;
        require_participant(&mut tx, conversation_id, actor).await?;
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM conversation_messages WHERE id=$1 AND conversation_id=$2)",
        )
        .bind(message_id)
        .bind(conversation_id)
        .fetch_one(&mut *tx)
        .await?;
        if !exists {
            return Err(SocialError::NotFound);
        }
        sqlx::query("INSERT INTO conversation_message_reactions (message_id,reactor_profile_id,kind) VALUES ($1,$2,$3)
                     ON CONFLICT (message_id,reactor_profile_id) DO UPDATE SET kind=excluded.kind,updated_at=now()")
            .bind(message_id).bind(actor).bind(kind).execute(&mut *tx).await?;
        tx.commit().await?;
        self.message(actor, conversation_id, message_id).await
    }

    pub async fn clear_message_reaction(
        &self,
        actor: Uuid,
        conversation_id: Uuid,
        message_id: Uuid,
    ) -> Result<ConversationMessage, SocialError> {
        let mut tx = self.pool.begin().await?;
        require_participant(&mut tx, conversation_id, actor).await?;
        sqlx::query("DELETE FROM conversation_message_reactions WHERE message_id=$1 AND reactor_profile_id=$2")
            .bind(message_id).bind(actor).execute(&mut *tx).await?;
        tx.commit().await?;
        self.message(actor, conversation_id, message_id).await
    }

    pub async fn set_typing(
        &self,
        actor: Uuid,
        conversation_id: Uuid,
        active: bool,
    ) -> Result<(), SocialError> {
        let mut tx = self.pool.begin().await?;
        require_participant(&mut tx, conversation_id, actor).await?;
        if active {
            sqlx::query("INSERT INTO conversation_typing (conversation_id,profile_id,expires_at)
                         VALUES ($1,$2,now() + interval '5 seconds')
                         ON CONFLICT (conversation_id,profile_id) DO UPDATE SET expires_at=excluded.expires_at")
                .bind(conversation_id).bind(actor).execute(&mut *tx).await?;
        } else {
            sqlx::query(
                "DELETE FROM conversation_typing WHERE conversation_id=$1 AND profile_id=$2",
            )
            .bind(conversation_id)
            .bind(actor)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    pub async fn typing(
        &self,
        actor: Uuid,
        conversation_id: Uuid,
    ) -> Result<Vec<Uuid>, SocialError> {
        let mut tx = self.pool.begin().await?;
        require_participant(&mut tx, conversation_id, actor).await?;
        sqlx::query("DELETE FROM conversation_typing WHERE expires_at<=now()")
            .execute(&mut *tx)
            .await?;
        let profiles = sqlx::query_scalar(
            "SELECT profile_id FROM conversation_typing
             WHERE conversation_id=$1 AND profile_id<>$2 AND expires_at>now()
             ORDER BY profile_id",
        )
        .bind(conversation_id)
        .bind(actor)
        .fetch_all(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(profiles)
    }

    async fn message(
        &self,
        actor: Uuid,
        conversation_id: Uuid,
        message_id: Uuid,
    ) -> Result<ConversationMessage, SocialError> {
        self.messages(actor, conversation_id, 0, 100)
            .await?
            .into_iter()
            .find(|message| message.id == message_id)
            .ok_or(SocialError::NotFound)
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
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'_' | b'-'))
    {
        return Err(SocialError::Invalid("invalid handle"));
    }
    Ok(value)
}

#[cfg(test)]
mod handle_tests {
    use super::*;

    #[test]
    fn source_profile_handles_round_trip_through_public_lookup_validation() {
        assert_eq!(
            normalize_handle("@Source-Hacker-News-New").unwrap(),
            "source-hacker-news-new"
        );
        assert!(normalize_handle("bad handle").is_err());
    }
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
fn app_account_from_row(row: sqlx::postgres::PgRow) -> Result<AppAccount, SocialError> {
    Ok(AppAccount {
        id: row.try_get("profile_id")?,
        kind: parse_kind(&row.try_get::<String, _>("kind")?)?,
        handle: row.try_get("handle")?,
        display_name: row.try_get("display_name")?,
        avatar_url: row.try_get("avatar_url")?,
        bio: row.try_get("bio")?,
        verified: false,
        followers: row.try_get("followers")?,
        following: row.try_get("following")?,
        post_count: row.try_get("post_count")?,
        owned_by_viewer: row.try_get("owned_by_viewer").ok(),
    })
}
fn app_post_from_row(row: sqlx::postgres::PgRow) -> Result<AppFeedPost, SocialError> {
    let link: Option<String> = row.try_get("canonical_url")?;
    Ok(AppFeedPost {
        id: row.try_get("id")?,
        author_id: row.try_get("author_profile_id")?,
        format: "photo",
        media: Vec::new(),
        caption: row.try_get("caption")?,
        links: link
            .map(|url| vec![serde_json::json!({"kind":"other","label":"Open link","url":url})])
            .unwrap_or_default(),
        created_at_ms: row
            .try_get::<DateTime<Utc>, _>("created_at")?
            .timestamp_millis(),
        like_count: 0,
        comment_count: row.try_get("comment_count")?,
        share_count: 0,
        alarm_count: 0,
        repost_count: 0,
        viewer_has_liked: false,
        viewer_has_alarm: false,
        viewer_has_reposted: false,
        viewer_has_saved: false,
    })
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
        reactions: serde_json::from_value(row.try_get("reactions")?)
            .map_err(|_| SocialError::Invalid("persisted reactions"))?,
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
