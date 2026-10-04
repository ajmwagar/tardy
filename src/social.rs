use crate::push::{NewNotification, PgPushStore};
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
    #[error("social notification: {0}")]
    Notification(#[from] crate::push::PushError),
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
    pub title: Option<String>,
    pub participants: Vec<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ConversationSummary {
    pub id: Uuid,
    pub mode: ConversationMode,
    pub title: Option<String>,
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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub media: Vec<MessageMedia>,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reactions: Vec<ReactionSummary>,
    /// Participants other than the sender whose durable read watermark reached this message.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub read_by: Vec<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct MessageMedia {
    pub asset_id: Uuid,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub url: String,
    pub content_type: String,
    pub byte_length: u64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub file_name: Option<String>,
    pub alt_text: Option<String>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub caption: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct TardyPost {
    pub id: Uuid,
    pub author_profile_id: Uuid,
    pub caption: String,
    pub media: Vec<PostMedia>,
    pub shared_link_id: Option<Uuid>,
    pub visibility: PostVisibility,
    #[schema(value_type = String, format = DateTime)]
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PostMedia {
    #[serde(rename = "type")]
    pub kind: String,
    pub url: String,
    pub poster_url: Option<String>,
    pub width: u32,
    pub height: u32,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
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

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AppSearchResult {
    pub post: AppFeedPost,
    pub relevance_score: f64,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AppAccount {
    pub id: Uuid,
    pub kind: IdentityKind,
    pub handle: String,
    pub display_name: String,
    pub avatar_url: String,
    pub bio: String,
    pub verified: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verification_tier: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub super_tardy_slot: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub brand_affiliate: Option<BrandAffiliate>,
    pub followers: i64,
    pub following: i64,
    pub post_count: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owned_by_viewer: Option<bool>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct BrandAffiliate {
    pub profile_id: Uuid,
    pub handle: String,
    pub avatar_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct SetBrandAffiliate {
    pub label: Option<String>,
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
                      EXISTS(SELECT 1 FROM social_identities viewer_identity
                             JOIN profile_ownership owned
                               ON owned.owner_account_id=viewer_identity.account_id
                             WHERE viewer_identity.profile_id=$2
                               AND owned.profile_id=p.author_profile_id) OR
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

    /// Sets the viewer's current like state. PUT and DELETE are intentionally idempotent.
    pub async fn set_post_liked(
        &self,
        viewer: Uuid,
        post_id: Uuid,
        liked: bool,
    ) -> Result<(), SocialError> {
        let mut tx = self.pool.begin().await?;
        let visible: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM tardy_posts p WHERE p.id=$1 AND
             (p.visibility='public' OR p.author_profile_id=$2 OR
              EXISTS(SELECT 1 FROM social_identities viewer_identity
                     JOIN profile_ownership owned
                       ON owned.owner_account_id=viewer_identity.account_id
                     WHERE viewer_identity.profile_id=$2
                       AND owned.profile_id=p.author_profile_id) OR
              (p.visibility='followers' AND EXISTS(SELECT 1 FROM profile_follows f
               WHERE f.follower_profile_id=$2 AND f.followed_profile_id=p.author_profile_id))))",
        )
        .bind(post_id)
        .bind(viewer)
        .fetch_one(&mut *tx)
        .await?;
        if !visible {
            return Err(SocialError::NotFound);
        }
        if liked {
            let inserted = sqlx::query(
                "INSERT INTO post_likes (post_id,profile_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
            )
            .bind(post_id)
            .bind(viewer)
            .execute(&mut *tx)
            .await?;
            if inserted.rows_affected() == 1 {
                let author: Uuid =
                    sqlx::query_scalar("SELECT author_profile_id FROM tardy_posts WHERE id=$1")
                        .bind(post_id)
                        .fetch_one(&mut *tx)
                        .await?;
                if author != viewer {
                    let handle = identity_handle(&mut tx, viewer).await?;
                    notify_human(
                        &mut tx,
                        author,
                        viewer,
                        "like",
                        &format!("@{handle}"),
                        "liked your tardy",
                        Some(post_id),
                        None,
                    )
                    .await?;
                }
            }
        } else {
            sqlx::query("DELETE FROM post_likes WHERE post_id=$1 AND profile_id=$2")
                .bind(post_id)
                .bind(viewer)
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    /// Sets an alarm or repost marker. Both operations are idempotent and use the same
    /// visibility boundary as likes; engagement events remain the separate ranking ledger.
    pub async fn set_post_marker(
        &self,
        viewer: Uuid,
        post_id: Uuid,
        marker: &str,
        enabled: bool,
    ) -> Result<(), SocialError> {
        let table = match marker {
            "alarm" => "post_alarms",
            "repost" => "post_reposts",
            _ => return Err(SocialError::Invalid("invalid post marker")),
        };
        let mut tx = self.pool.begin().await?;
        let visible: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM tardy_posts p WHERE p.id=$1 AND
             (p.visibility='public' OR p.author_profile_id=$2 OR
              EXISTS(SELECT 1 FROM social_identities viewer_identity
                     JOIN profile_ownership owned
                       ON owned.owner_account_id=viewer_identity.account_id
                     WHERE viewer_identity.profile_id=$2
                       AND owned.profile_id=p.author_profile_id) OR
              (p.visibility='followers' AND EXISTS(SELECT 1 FROM profile_follows f
               WHERE f.follower_profile_id=$2 AND f.followed_profile_id=p.author_profile_id))))",
        )
        .bind(post_id)
        .bind(viewer)
        .fetch_one(&mut *tx)
        .await?;
        if !visible {
            return Err(SocialError::NotFound);
        }
        let statement = if enabled {
            format!(
                "INSERT INTO {table} (post_id,profile_id) VALUES ($1,$2) ON CONFLICT DO NOTHING"
            )
        } else {
            format!("DELETE FROM {table} WHERE post_id=$1 AND profile_id=$2")
        };
        sqlx::query(&statement)
            .bind(post_id)
            .bind(viewer)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn app_feed(
        &self,
        viewer: Option<Uuid>,
        limit: i64,
    ) -> Result<Vec<AppFeedPost>, SocialError> {
        let rows = sqlx::query(
            "SELECT p.id,p.author_profile_id,p.caption,p.media,p.created_at,l.canonical_url,
                    (SELECT count(*) FROM post_comments c WHERE c.post_id=p.id)::bigint AS comment_count,
                    (SELECT count(*) FROM post_likes x WHERE x.post_id=p.id)::bigint AS like_count,
                    (SELECT count(*) FROM post_alarms x WHERE x.post_id=p.id)::bigint AS alarm_count,
                    (SELECT count(*) FROM post_reposts x WHERE x.post_id=p.id)::bigint AS repost_count,
                    EXISTS(SELECT 1 FROM post_likes x WHERE x.post_id=p.id AND x.profile_id=$1) AS viewer_has_liked,
                    EXISTS(SELECT 1 FROM post_alarms x WHERE x.post_id=p.id AND x.profile_id=$1) AS viewer_has_alarm,
                    EXISTS(SELECT 1 FROM post_reposts x WHERE x.post_id=p.id AND x.profile_id=$1) AS viewer_has_reposted
             FROM tardy_posts p
             LEFT JOIN shared_links l ON l.id=p.shared_link_id
             WHERE p.visibility='public'
                OR p.author_profile_id=$1
                OR EXISTS(SELECT 1 FROM social_identities viewer_identity
                          JOIN profile_ownership owned
                            ON owned.owner_account_id=viewer_identity.account_id
                          WHERE viewer_identity.profile_id=$1
                            AND owned.profile_id=p.author_profile_id)
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
                    format: post_format(&row)?,
                    media: app_media(&row)?,
                    caption: row.try_get("caption")?,
                    links: link
                        .map(|url| {
                            vec![serde_json::json!({"kind":"other","label":"Open link","url":url})]
                        })
                        .unwrap_or_default(),
                    created_at_ms: row
                        .try_get::<DateTime<Utc>, _>("created_at")?
                        .timestamp_millis(),
                    like_count: row.try_get("like_count")?,
                    comment_count: row.try_get("comment_count")?,
                    share_count: 0,
                    alarm_count: row.try_get("alarm_count")?,
                    repost_count: row.try_get("repost_count")?,
                    viewer_has_liked: row.try_get("viewer_has_liked")?,
                    viewer_has_alarm: row.try_get("viewer_has_alarm")?,
                    viewer_has_reposted: row.try_get("viewer_has_reposted")?,
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
            "SELECT p.id,p.author_profile_id,p.caption,p.media,p.created_at,l.canonical_url,
                    (SELECT count(*) FROM post_comments c WHERE c.post_id=p.id)::bigint AS comment_count,
                    (SELECT count(*) FROM post_likes x WHERE x.post_id=p.id)::bigint AS like_count,
                    (SELECT count(*) FROM post_alarms x WHERE x.post_id=p.id)::bigint AS alarm_count,
                    (SELECT count(*) FROM post_reposts x WHERE x.post_id=p.id)::bigint AS repost_count,
                    EXISTS(SELECT 1 FROM post_likes x WHERE x.post_id=p.id AND x.profile_id=$1) AS viewer_has_liked,
                    EXISTS(SELECT 1 FROM post_alarms x WHERE x.post_id=p.id AND x.profile_id=$1) AS viewer_has_alarm,
                    EXISTS(SELECT 1 FROM post_reposts x WHERE x.post_id=p.id AND x.profile_id=$1) AS viewer_has_reposted
             FROM tardy_posts p
             LEFT JOIN shared_links l ON l.id=p.shared_link_id
             WHERE ($2::uuid IS NULL OR p.author_profile_id=$2)
               AND (p.visibility='public'
                    OR p.author_profile_id=$1
                    OR EXISTS(SELECT 1 FROM social_identities viewer_identity
                              JOIN profile_ownership owned
                                ON owned.owner_account_id=viewer_identity.account_id
                              WHERE viewer_identity.profile_id=$1
                                AND owned.profile_id=p.author_profile_id)
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

    pub async fn app_post(
        &self,
        viewer: Option<Uuid>,
        id: Uuid,
    ) -> Result<AppFeedPost, SocialError> {
        let row = sqlx::query(
            "SELECT p.id,p.author_profile_id,p.caption,p.media,p.created_at,l.canonical_url,
                    (SELECT count(*) FROM post_comments c WHERE c.post_id=p.id)::bigint AS comment_count,
                    (SELECT count(*) FROM post_likes x WHERE x.post_id=p.id)::bigint AS like_count,
                    (SELECT count(*) FROM post_alarms x WHERE x.post_id=p.id)::bigint AS alarm_count,
                    (SELECT count(*) FROM post_reposts x WHERE x.post_id=p.id)::bigint AS repost_count,
                    EXISTS(SELECT 1 FROM post_likes x WHERE x.post_id=p.id AND x.profile_id=$1) AS viewer_has_liked,
                    EXISTS(SELECT 1 FROM post_alarms x WHERE x.post_id=p.id AND x.profile_id=$1) AS viewer_has_alarm,
                    EXISTS(SELECT 1 FROM post_reposts x WHERE x.post_id=p.id AND x.profile_id=$1) AS viewer_has_reposted
             FROM tardy_posts p
             LEFT JOIN shared_links l ON l.id=p.shared_link_id
             WHERE p.id=$2 AND (p.visibility='public'
                    OR p.author_profile_id=$1
                    OR EXISTS(SELECT 1 FROM social_identities viewer_identity
                              JOIN profile_ownership owned
                                ON owned.owner_account_id=viewer_identity.account_id
                              WHERE viewer_identity.profile_id=$1
                                AND owned.profile_id=p.author_profile_id)
                    OR (p.visibility='followers' AND EXISTS (
                        SELECT 1 FROM profile_follows f
                        WHERE f.follower_profile_id=$1 AND f.followed_profile_id=p.author_profile_id))
                    OR EXISTS (
                        SELECT 1 FROM conversation_messages m
                        JOIN conversation_participants participant
                          ON participant.conversation_id=m.conversation_id
                        JOIN shared_links shared ON shared.id=m.shared_link_id
                        WHERE participant.profile_id=$1
                          AND shared.canonical_url=('https://tardy.news/t/' || p.id::text)
                    ))",
        )
        .bind(viewer)
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(SocialError::NotFound)?;
        app_post_from_row(row)
    }

    /// PostgreSQL supplies deterministic candidate retrieval and first-stage ranking.
    /// An optional model reranker can reorder this bounded public result set upstream.
    pub async fn search_app_posts(
        &self,
        viewer: Option<Uuid>,
        query: &str,
        limit: i64,
    ) -> Result<Vec<AppSearchResult>, SocialError> {
        let query = query.trim();
        if query.is_empty() || query.len() > 500 || !(1..=100).contains(&limit) {
            return Err(SocialError::Invalid("invalid post search"));
        }
        let rows = sqlx::query(
            "WITH q AS (SELECT websearch_to_tsquery('english',$2) value)
             SELECT p.id,p.author_profile_id,p.caption,p.media,p.created_at,l.canonical_url,
                    (SELECT count(*) FROM post_comments c WHERE c.post_id=p.id)::bigint AS comment_count,
                    (SELECT count(*) FROM post_likes x WHERE x.post_id=p.id)::bigint AS like_count,
                    (SELECT count(*) FROM post_alarms x WHERE x.post_id=p.id)::bigint AS alarm_count,
                    (SELECT count(*) FROM post_reposts x WHERE x.post_id=p.id)::bigint AS repost_count,
                    EXISTS(SELECT 1 FROM post_likes x WHERE x.post_id=p.id AND x.profile_id=$1) AS viewer_has_liked,
                    EXISTS(SELECT 1 FROM post_alarms x WHERE x.post_id=p.id AND x.profile_id=$1) AS viewer_has_alarm,
                    EXISTS(SELECT 1 FROM post_reposts x WHERE x.post_id=p.id AND x.profile_id=$1) AS viewer_has_reposted,
                    ts_rank_cd(to_tsvector('english',p.caption||' '||i.handle||' '||COALESCE(h.display_name,s.display_name,'')),q.value)::float8 AS relevance_score
             FROM tardy_posts p
             JOIN social_identities i ON i.profile_id=p.author_profile_id
             LEFT JOIN human_profiles h ON h.profile_id=i.profile_id
             LEFT JOIN source_channels s ON i.kind='channel' AND i.handle='source-'||s.id
             LEFT JOIN shared_links l ON l.id=p.shared_link_id
             CROSS JOIN q
             WHERE (p.visibility='public'
                    OR p.author_profile_id=$1
                    OR EXISTS(SELECT 1 FROM social_identities viewer_identity
                              JOIN profile_ownership owned
                                ON owned.owner_account_id=viewer_identity.account_id
                              WHERE viewer_identity.profile_id=$1
                                AND owned.profile_id=p.author_profile_id)
                    OR (p.visibility='followers' AND EXISTS (
                        SELECT 1 FROM profile_follows f
                        WHERE f.follower_profile_id=$1 AND f.followed_profile_id=p.author_profile_id)))
               AND to_tsvector('english',p.caption||' '||i.handle||' '||COALESCE(h.display_name,s.display_name,'')) @@ q.value
             ORDER BY relevance_score DESC,p.created_at DESC,p.id DESC LIMIT $3",
        )
        .bind(viewer)
        .bind(query)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                let relevance_score = row.try_get("relevance_score")?;
                Ok(AppSearchResult {
                    post: app_post_from_row(row)?,
                    relevance_score,
                })
            })
            .collect()
    }

    pub async fn app_accounts(&self, ids: &[Uuid]) -> Result<Vec<AppAccount>, SocialError> {
        let rows = sqlx::query(
            "SELECT i.profile_id,i.kind,i.handle,
                    COALESCE(NULLIF(i.display_name,''),h.display_name,s.display_name,i.handle) AS display_name,
                    COALESCE(NULLIF(i.avatar_url,''),NULLIF(h.avatar_url,''),'https://tardy.news/favicon.svg') AS avatar_url,
                    COALESCE(NULLIF(i.bio,''),h.bio,CASE WHEN s.id IS NOT NULL THEN 'Updates from '||s.display_name||', with links to the original source.' END,'') AS bio,
                    badges.verification_tier,badges.super_tardy_slot,badges.brand_profile_id,
                    badges.brand_handle,badges.brand_avatar_url,badges.brand_label,
                    (SELECT count(*) FROM profile_follows f WHERE f.followed_profile_id=i.profile_id)::bigint AS followers,
                    (SELECT count(*) FROM profile_follows f WHERE f.follower_profile_id=i.profile_id)::bigint AS following,
                    (SELECT count(*) FROM tardy_posts p WHERE p.author_profile_id=i.profile_id)::bigint AS post_count
             FROM social_identities i
             LEFT JOIN human_profiles h ON h.profile_id=i.profile_id
             LEFT JOIN source_channels s ON i.kind='channel' AND i.handle='source-'||s.id
             LEFT JOIN active_profile_badges badges ON badges.profile_id=i.profile_id
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

    pub async fn owned_agents_for_profile(
        &self,
        owner_profile_id: Uuid,
    ) -> Result<Vec<AppAccount>, SocialError> {
        let account_id: Uuid = sqlx::query_scalar(
            "SELECT account_id FROM social_identities WHERE profile_id=$1 AND kind='human'",
        )
        .bind(owner_profile_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(SocialError::NotFound)?;
        let ids: Vec<Uuid> = sqlx::query_scalar(
            "SELECT agent.profile_id
             FROM profile_ownership owned
             JOIN social_identities agent ON agent.profile_id=owned.profile_id
             WHERE owned.owner_account_id=$1 AND agent.kind='agent'
             ORDER BY owned.created_at,agent.profile_id",
        )
        .bind(account_id)
        .fetch_all(&self.pool)
        .await?;
        self.app_accounts(&ids).await
    }

    pub async fn update_owned_agent_profile(
        &self,
        owner_account_id: Uuid,
        profile_id: Uuid,
        handle: Option<&str>,
        display_name: Option<&str>,
        bio: Option<&str>,
        avatar_url: Option<&str>,
    ) -> Result<AppAccount, SocialError> {
        let handle = handle.map(normalize_handle).transpose()?;
        let display_name = display_name.map(str::trim);
        if display_name.is_some_and(|value| value.is_empty() || value.chars().count() > 80) {
            return Err(SocialError::Invalid(
                "agent name must be between 1 and 80 characters",
            ));
        }
        let bio = bio.map(str::trim);
        if bio.is_some_and(|value| value.chars().count() > 500) {
            return Err(SocialError::Invalid(
                "agent bio must be at most 500 characters",
            ));
        }
        let avatar_url = avatar_url.map(str::trim);
        if avatar_url.is_some_and(|value| {
            value.len() > 2048
                || (!value.is_empty()
                    && !value.starts_with("https://")
                    && !value.starts_with("http://"))
        }) {
            return Err(SocialError::Invalid("agent avatar must be an http(s) URL"));
        }
        let changed = sqlx::query(
            "UPDATE social_identities SET
                 handle=COALESCE($3,handle),
                 display_name=COALESCE($4,display_name),
                 bio=COALESCE($5,bio),
                 avatar_url=COALESCE($6,avatar_url)
             WHERE profile_id=$1 AND kind='agent'
               AND EXISTS(SELECT 1 FROM profile_ownership owned
                          WHERE owned.profile_id=social_identities.profile_id
                            AND owned.owner_account_id=$2)",
        )
        .bind(profile_id)
        .bind(owner_account_id)
        .bind(handle)
        .bind(display_name)
        .bind(bio)
        .bind(avatar_url)
        .execute(&self.pool)
        .await;
        match changed {
            Ok(result) if result.rows_affected() == 1 => self.app_account_by_id(profile_id).await,
            Ok(_) => Err(SocialError::Forbidden),
            Err(error)
                if error
                    .as_database_error()
                    .is_some_and(|db| db.code().as_deref() == Some("23505")) =>
            {
                Err(SocialError::Invalid("that agent handle is already taken"))
            }
            Err(error) => Err(error.into()),
        }
    }

    pub async fn mark_owned_accounts(
        &self,
        viewer_account: Uuid,
        accounts: &mut [AppAccount],
    ) -> Result<(), SocialError> {
        let ids = accounts
            .iter()
            .map(|account| account.id)
            .collect::<Vec<_>>();
        let owned: Vec<Uuid> = sqlx::query_scalar(
            "SELECT profile_id FROM profile_ownership
             WHERE owner_account_id=$1 AND profile_id=ANY($2)",
        )
        .bind(viewer_account)
        .bind(&ids)
        .fetch_all(&self.pool)
        .await?;
        let owned = owned.into_iter().collect::<std::collections::HashSet<_>>();
        for account in accounts {
            account.owned_by_viewer = Some(owned.contains(&account.id));
        }
        Ok(())
    }

    pub async fn set_brand_affiliate(
        &self,
        actor_account_id: Uuid,
        brand_profile_id: Uuid,
        profile_id: Uuid,
        label: Option<&str>,
    ) -> Result<AppAccount, SocialError> {
        let label = label.unwrap_or("").trim();
        if label.len() > 50 || brand_profile_id == profile_id {
            return Err(SocialError::Invalid("invalid brand affiliation"));
        }
        let result = sqlx::query(
            "INSERT INTO profile_brand_affiliations
                 (profile_id,brand_profile_id,granted_by_account_id,label)
             SELECT $1,i.profile_id,$2,$3
             FROM social_identities i
             WHERE i.profile_id=$4 AND i.account_id=$2 AND i.kind IN ('project','channel')
             ON CONFLICT (profile_id) DO UPDATE SET
                 brand_profile_id=excluded.brand_profile_id,
                 granted_by_account_id=excluded.granted_by_account_id,
                 label=excluded.label,
                 created_at=now()",
        )
        .bind(profile_id)
        .bind(actor_account_id)
        .bind(label)
        .bind(brand_profile_id)
        .execute(&self.pool)
        .await?;
        if result.rows_affected() == 0 {
            return Err(SocialError::Forbidden);
        }
        self.app_account_by_id(profile_id).await
    }

    pub async fn clear_brand_affiliate(
        &self,
        actor_account_id: Uuid,
        brand_profile_id: Uuid,
        profile_id: Uuid,
    ) -> Result<(), SocialError> {
        let result = sqlx::query(
            "DELETE FROM profile_brand_affiliations ba
             USING social_identities brand
             WHERE ba.profile_id=$1 AND ba.brand_profile_id=$2
               AND brand.profile_id=ba.brand_profile_id
               AND brand.account_id=$3 AND brand.kind IN ('project','channel')",
        )
        .bind(profile_id)
        .bind(brand_profile_id)
        .bind(actor_account_id)
        .execute(&self.pool)
        .await?;
        if result.rows_affected() == 0 {
            return Err(SocialError::NotFound);
        }
        Ok(())
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
                    COALESCE(NULLIF(i.display_name,''),h.display_name,s.display_name,i.handle) AS display_name,
                    COALESCE(NULLIF(i.avatar_url,''),NULLIF(h.avatar_url,''),'https://tardy.news/favicon.svg') AS avatar_url,
                    COALESCE(NULLIF(i.bio,''),h.bio,CASE WHEN s.id IS NOT NULL THEN 'Updates from '||s.display_name||', with links to the original source.' END,'') AS bio,
                    badges.verification_tier,badges.super_tardy_slot,badges.brand_profile_id,
                    badges.brand_handle,badges.brand_avatar_url,badges.brand_label,
                    (SELECT count(*) FROM profile_follows f WHERE f.followed_profile_id=i.profile_id)::bigint AS followers,
                    (SELECT count(*) FROM profile_follows f WHERE f.follower_profile_id=i.profile_id)::bigint AS following,
                    (SELECT count(*) FROM tardy_posts p WHERE p.author_profile_id=i.profile_id)::bigint AS post_count,
                    EXISTS(SELECT 1 FROM profile_ownership owned
                           WHERE owned.owner_account_id=$1
                             AND owned.profile_id=i.profile_id) AS owned_by_viewer
             FROM social_identities i
             LEFT JOIN human_profiles h ON h.profile_id=i.profile_id
             LEFT JOIN source_channels s ON i.kind='channel' AND i.handle='source-'||s.id
             LEFT JOIN active_profile_badges badges ON badges.profile_id=i.profile_id
             WHERE $2='' OR i.handle ILIKE $3 OR COALESCE(NULLIF(i.display_name,''),h.display_name,s.display_name,i.handle) ILIKE $3
             ORDER BY (EXISTS(SELECT 1 FROM profile_ownership owned
                              WHERE owned.owner_account_id=$1
                                AND owned.profile_id=i.profile_id)
                       AND i.kind='agent') DESC,
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
        display_name: &str,
        bio: &str,
    ) -> Result<SocialIdentity, SocialError> {
        let handle = normalize_handle(handle)?;
        let display_name = display_name.trim();
        let bio = bio.trim();
        if display_name.is_empty() || display_name.chars().count() > 80 || bio.chars().count() > 500
        {
            return Err(SocialError::Invalid("invalid profile metadata"));
        }
        sqlx::query("INSERT INTO social_identities (profile_id,account_id,handle,kind,display_name,bio) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (profile_id) DO UPDATE SET account_id=excluded.account_id,handle=excluded.handle,kind=excluded.kind,display_name=excluded.display_name,bio=excluded.bio")
            .bind(profile_id).bind(account_id).bind(&handle).bind(kind_name(kind)).bind(display_name).bind(bio).execute(&self.pool).await?;
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
        let mut tx = self.pool.begin().await?;
        let result = sqlx::query("INSERT INTO profile_follows (follower_profile_id,followed_profile_id) VALUES ($1,$2) ON CONFLICT DO NOTHING")
            .bind(actor).bind(target).execute(&mut *tx).await;
        let inserted = map_foreign_key(result)?.rows_affected() == 1;
        if inserted {
            let handle = identity_handle(&mut tx, actor).await?;
            notify_human(
                &mut tx,
                target,
                actor,
                "follow",
                &format!("@{handle}"),
                "started following you",
                None,
                None,
            )
            .await?;
        }
        tx.commit().await?;
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
        self.create_group_conversation(actor, &[recipient], None)
            .await
    }

    pub async fn create_group_conversation(
        &self,
        actor: Uuid,
        recipients: &[Uuid],
        title: Option<&str>,
    ) -> Result<Conversation, SocialError> {
        let mut recipients = recipients.to_vec();
        recipients.sort_unstable();
        recipients.dedup();
        if recipients.is_empty() || recipients.len() > 31 || recipients.contains(&actor) {
            return Err(SocialError::Invalid(
                "conversation requires 1-31 other participants",
            ));
        }
        let title = title.map(str::trim).filter(|value| !value.is_empty());
        if title.is_some_and(|value| value.chars().count() > 100) {
            return Err(SocialError::Invalid("group title must be 1-100 characters"));
        }
        let is_direct = recipients.len() == 1 && title.is_none();
        let mut tx = self.pool.begin().await?;
        require_identity(&mut tx, actor).await?;
        let mut agent = None;
        for recipient in &recipients {
            if require_identity(&mut tx, *recipient).await? == IdentityKind::Agent {
                if recipients.len() != 1 {
                    return Err(SocialError::Invalid(
                        "agents must be summoned after creating a human group",
                    ));
                }
                agent = Some(*recipient);
            }
        }
        let mode = if agent.is_some() {
            ConversationMode::Work
        } else {
            ConversationMode::Dm
        };
        if is_direct {
            let recipient = recipients[0];
            let mut pair = [actor, recipient];
            pair.sort_unstable();
            let lock_key = format!("{}:{}", pair[0], pair[1]);
            sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
                .bind(lock_key)
                .execute(&mut *tx)
                .await?;
            if let Some(row) = sqlx::query(
                "SELECT c.id,c.mode,c.title
                 FROM conversations c
                 WHERE c.scope='direct'
                   AND (SELECT array_agg(p.profile_id ORDER BY p.profile_id) FROM conversation_participants p WHERE p.conversation_id=c.id)
                       = (SELECT array_agg(v ORDER BY v) FROM unnest(ARRAY[$1::uuid,$2::uuid]) v)
                 ORDER BY c.created_at,c.id LIMIT 1",
            )
            .bind(actor)
            .bind(recipient)
            .fetch_optional(&mut *tx)
            .await?
            {
                let id: Uuid = row.try_get("id")?;
                let participants = sqlx::query_scalar("SELECT profile_id FROM conversation_participants WHERE conversation_id=$1 ORDER BY joined_at,profile_id")
                    .bind(id).fetch_all(&mut *tx).await?;
                let stored_mode: String = row.try_get("mode")?;
                tx.commit().await?;
                return Ok(Conversation { id, mode: parse_mode(&stored_mode)?, title: row.try_get("title")?, participants });
            }
        }
        let id = Uuid::new_v4();
        sqlx::query("INSERT INTO conversations (id,mode,scope,title,created_by,promoted_by,promoted_at) VALUES ($1,$2,$3,$4,$5,CASE WHEN $2='work' THEN $5 END,CASE WHEN $2='work' THEN now() END)")
            .bind(id).bind(mode_name(mode)).bind(if is_direct { "direct" } else { "group" }).bind(title).bind(actor).execute(&mut *tx).await?;
        let mut participants = Vec::with_capacity(recipients.len() + 1);
        participants.push(actor);
        participants.extend(recipients.iter().copied());
        for profile in &participants {
            sqlx::query("INSERT INTO conversation_participants (conversation_id,profile_id,invited_by) VALUES ($1,$2,$3)").bind(id).bind(profile).bind(actor).execute(&mut *tx).await?;
        }
        if let Some(agent) = agent {
            sqlx::query("INSERT INTO conversation_agent_grants (conversation_id,agent_profile_id,granted_by,context_from_sequence) VALUES ($1,$2,$3,1)")
                .bind(id).bind(agent).bind(actor).execute(&mut *tx).await?;
        }
        let inviter: String =
            sqlx::query_scalar("SELECT handle FROM social_identities WHERE profile_id=$1")
                .bind(actor)
                .fetch_one(&mut *tx)
                .await?;
        let accounts: Vec<Uuid> = sqlx::query_scalar(
            "SELECT DISTINCT account_id FROM social_identities WHERE profile_id=ANY($1) AND kind='human'",
        )
        .bind(&recipients)
        .fetch_all(&mut *tx)
        .await?;
        for account in accounts {
            PgPushStore::enqueue_in(
                &mut tx,
                &NewNotification {
                    source_event_id: Uuid::new_v4(),
                    account_id: account,
                    category: "conversation_invite".into(),
                    title: format!("@{inviter}"),
                    body: "added you to a conversation".into(),
                    deep_link: Some(format!("tardy://messages/{id}")),
                    data: serde_json::Map::from_iter([
                        ("actor_id".into(), serde_json::json!(actor)),
                        ("conversation_id".into(), serde_json::json!(id)),
                    ]),
                },
            )
            .await?;
        }
        tx.commit().await?;
        Ok(Conversation {
            id,
            mode,
            title: title.map(str::to_owned),
            participants,
        })
    }

    pub async fn conversations(
        &self,
        actor: Uuid,
    ) -> Result<Vec<ConversationSummary>, SocialError> {
        let rows = sqlx::query(
            "SELECT c.id,c.mode,c.title,array_agg(DISTINCT p.profile_id ORDER BY p.profile_id) AS participants,
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
             GROUP BY c.id,c.mode,c.title,c.created_at,mine.last_read_sequence,last_message.id,last_message.sequence,
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
                        media: Vec::new(),
                        created_at: row
                            .try_get("last_created_at")
                            .expect("selected with last id"),
                        reactions: serde_json::from_value(
                            row.try_get("last_reactions")
                                .expect("selected with last id"),
                        )
                        .expect("reaction rows have a stable shape"),
                        read_by: Vec::new(),
                    });
                Ok(ConversationSummary {
                    id,
                    mode: parse_mode(&mode)?,
                    title: row.try_get("title")?,
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
        // Agent grants are the privacy boundary, regardless of the cursor supplied by a client.
        // Human participants have no grant row and retain the normal conversation history.
        let grant_from: Option<i64> = sqlx::query_scalar(
            "SELECT context_from_sequence FROM conversation_agent_grants
             WHERE conversation_id=$1 AND agent_profile_id=$2",
        )
        .bind(conversation_id)
        .bind(actor)
        .fetch_optional(&self.pool)
        .await?;
        let effective_after = grant_from
            .map(|sequence| after.max(sequence - 1))
            .unwrap_or(after);
        let rows = sqlx::query("SELECT m.id,m.conversation_id,m.sequence,m.sender_profile_id,m.body,m.shared_link_id,m.created_at,
                    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                        'asset_id',mm.asset_id,
                        'type',CASE WHEN a.content_type LIKE 'image/%' THEN 'image' WHEN a.content_type LIKE 'video/%' THEN 'video' WHEN a.content_type LIKE 'audio/%' THEN 'audio' ELSE 'document' END,
                        'url','',
                        'content_type',a.content_type,
                        'byte_length',a.byte_length,
                        'width',mm.width,
                        'height',mm.height,
                        'file_name',mm.file_name,
                        'alt_text',mm.alt_text) ORDER BY mm.position), '[]'::jsonb)
                     FROM conversation_message_media mm JOIN media_assets a ON a.id=mm.asset_id WHERE mm.message_id=m.id) AS media,
                    (SELECT COALESCE(jsonb_agg(jsonb_build_object('kind',r.kind,'account_ids',r.account_ids) ORDER BY r.sort), '[]'::jsonb)
                     FROM (SELECT kind,array_agg(reactor_profile_id ORDER BY reactor_profile_id) account_ids,
                                  min(CASE kind WHEN 'like' THEN 1 WHEN 'love' THEN 2 WHEN 'laugh' THEN 3 WHEN 'emphasize' THEN 4 WHEN 'question' THEN 5 WHEN 'seen' THEN 6 ELSE 7 END) sort
                           FROM conversation_message_reactions WHERE message_id=m.id GROUP BY kind) r) AS reactions,
                    ARRAY(SELECT p.profile_id FROM conversation_participants p
                          WHERE p.conversation_id=m.conversation_id
                            AND p.profile_id<>m.sender_profile_id
                            AND p.last_read_sequence>=m.sequence
                          ORDER BY p.profile_id) AS read_by
             FROM conversation_messages m WHERE m.conversation_id=$1 AND m.sequence>$2 ORDER BY m.sequence LIMIT $3")
            .bind(conversation_id).bind(effective_after).bind(limit).fetch_all(&self.pool).await?;
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
        sqlx::query("UPDATE conversations SET scope='group' WHERE id=$1 AND (SELECT count(*) FROM conversation_participants WHERE conversation_id=$1)>2")
            .bind(conversation_id).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO conversation_agent_grants (conversation_id,agent_profile_id,granted_by,context_from_sequence,include_anchor_share) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING")
            .bind(conversation_id).bind(agent).bind(actor).bind(next_sequence).bind(include_anchor_share).execute(&mut *tx).await?;
        emit_agent_event(&mut tx, "agent_share", conversation_id, agent, serde_json::json!({"conversation_id": conversation_id, "context_from_sequence": next_sequence, "include_anchor_share": include_anchor_share})).await?;
        let participants = sqlx::query_scalar("SELECT profile_id FROM conversation_participants WHERE conversation_id=$1 ORDER BY joined_at,profile_id").bind(conversation_id).fetch_all(&mut *tx).await?;
        tx.commit().await?;
        Ok(Conversation {
            id: conversation_id,
            mode: ConversationMode::Work,
            title: sqlx::query_scalar("SELECT title FROM conversations WHERE id=$1")
                .bind(conversation_id)
                .fetch_one(&self.pool)
                .await?,
            participants,
        })
    }

    pub async fn rename_conversation(
        &self,
        actor: Uuid,
        conversation_id: Uuid,
        title: Option<&str>,
    ) -> Result<Conversation, SocialError> {
        let title = title.map(str::trim).filter(|value| !value.is_empty());
        if title.is_some_and(|value| value.chars().count() > 100) {
            return Err(SocialError::Invalid("group title must be 1-100 characters"));
        }
        let updated = sqlx::query(
            "UPDATE conversations SET title=$3
             WHERE id=$1 AND created_by=$2 AND scope='group'",
        )
        .bind(conversation_id)
        .bind(actor)
        .bind(title)
        .execute(&self.pool)
        .await?
        .rows_affected();
        if updated == 0 {
            return Err(SocialError::Forbidden);
        }
        self.conversation_for(actor, conversation_id).await
    }

    pub async fn add_participant(
        &self,
        actor: Uuid,
        conversation_id: Uuid,
        profile_id: Uuid,
    ) -> Result<Conversation, SocialError> {
        let mut tx = self.pool.begin().await?;
        require_participant(&mut tx, conversation_id, actor).await?;
        if require_identity(&mut tx, profile_id).await? == IdentityKind::Agent {
            return Err(SocialError::Invalid(
                "add agents through the summon endpoint",
            ));
        }
        sqlx::query("SELECT id FROM conversations WHERE id=$1 FOR UPDATE")
            .bind(conversation_id)
            .execute(&mut *tx)
            .await?;
        let count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM conversation_participants WHERE conversation_id=$1",
        )
        .bind(conversation_id)
        .fetch_one(&mut *tx)
        .await?;
        if count >= 32 {
            return Err(SocialError::Invalid(
                "conversation has reached 32 participants",
            ));
        }
        sqlx::query("INSERT INTO conversation_participants (conversation_id,profile_id,invited_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING")
            .bind(conversation_id).bind(profile_id).bind(actor).execute(&mut *tx).await?;
        sqlx::query("UPDATE conversations SET scope='group' WHERE id=$1")
            .bind(conversation_id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        self.conversation_for(actor, conversation_id).await
    }

    pub async fn remove_participant(
        &self,
        actor: Uuid,
        conversation_id: Uuid,
        profile_id: Uuid,
    ) -> Result<Conversation, SocialError> {
        let mut tx = self.pool.begin().await?;
        require_participant(&mut tx, conversation_id, actor).await?;
        let creator: Uuid =
            sqlx::query_scalar("SELECT created_by FROM conversations WHERE id=$1 FOR UPDATE")
                .bind(conversation_id)
                .fetch_one(&mut *tx)
                .await?;
        if profile_id == creator || actor != creator {
            return Err(SocialError::Forbidden);
        }
        let count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM conversation_participants WHERE conversation_id=$1",
        )
        .bind(conversation_id)
        .fetch_one(&mut *tx)
        .await?;
        if count <= 2 {
            return Err(SocialError::Invalid(
                "conversation must retain at least two participants",
            ));
        }
        sqlx::query("DELETE FROM conversation_agent_grants WHERE conversation_id=$1 AND agent_profile_id=$2")
            .bind(conversation_id).bind(profile_id).execute(&mut *tx).await?;
        let removed = sqlx::query(
            "DELETE FROM conversation_participants WHERE conversation_id=$1 AND profile_id=$2",
        )
        .bind(conversation_id)
        .bind(profile_id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
        if removed == 0 {
            return Err(SocialError::NotFound);
        }
        tx.commit().await?;
        self.conversation_for(actor, conversation_id).await
    }

    async fn conversation_for(
        &self,
        actor: Uuid,
        conversation_id: Uuid,
    ) -> Result<Conversation, SocialError> {
        let row = sqlx::query(
            "SELECT c.id,c.mode,c.title,array_agg(p.profile_id ORDER BY p.joined_at,p.profile_id) AS participants
             FROM conversations c
             JOIN conversation_participants mine ON mine.conversation_id=c.id AND mine.profile_id=$2
             JOIN conversation_participants p ON p.conversation_id=c.id
             WHERE c.id=$1 GROUP BY c.id,c.mode,c.title",
        )
        .bind(conversation_id)
        .bind(actor)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(SocialError::NotFound)?;
        let mode: String = row.try_get("mode")?;
        Ok(Conversation {
            id: row.try_get("id")?,
            mode: parse_mode(&mode)?,
            title: row.try_get("title")?,
            participants: row.try_get("participants")?,
        })
    }

    pub async fn add_shared_link(&self, raw_url: &str) -> Result<SharedLink, SocialError> {
        let (canonical_url, provider) = canonicalize_url(raw_url)?;
        let id = Uuid::new_v4();
        let mut tx = self.pool.begin().await?;
        let row = sqlx::query("INSERT INTO shared_links (id,canonical_url,provider) VALUES ($1,$2,$3) ON CONFLICT (canonical_url) DO UPDATE SET canonical_url=excluded.canonical_url RETURNING id,canonical_url,provider,status,metadata,media_r2_key")
            .bind(id).bind(&canonical_url).bind(&provider).fetch_one(&mut *tx).await?;
        let stored_id: Uuid = row.try_get("id")?;
        if stored_id == id {
            sqlx::query("INSERT INTO outbox (id,topic,aggregate_type,aggregate_id,payload,available_at,created_at) VALUES ($1,'shared_link.enrichment_requested.v1','shared_link',$2,$3,now(),now()) ON CONFLICT DO NOTHING")
                .bind(Uuid::new_v4()).bind(id.to_string()).bind(serde_json::json!({"shared_link_id": id, "canonical_url": canonical_url, "provider": provider})).execute(&mut *tx).await?;
        }
        let metadata: serde_json::Value = row.try_get("metadata")?;
        let link = SharedLink {
            id: stored_id,
            canonical_url: row.try_get("canonical_url")?,
            provider: row.try_get("provider")?,
            status: row.try_get("status")?,
            title: metadata
                .get("title")
                .and_then(|v| v.as_str())
                .map(str::to_owned),
            thumbnail_url: metadata
                .get("thumbnail_url")
                .and_then(|v| v.as_str())
                .map(str::to_owned),
            caption: metadata
                .get("caption")
                .and_then(|v| v.as_str())
                .map(str::to_owned),
            media_url: row.try_get::<Option<String>, _>("media_r2_key")?,
        };
        tx.commit().await?;
        Ok(link)
    }

    pub async fn shared_link(&self, id: Uuid) -> Result<SharedLink, SocialError> {
        let row = sqlx::query("SELECT id,canonical_url,provider,status,metadata,media_r2_key FROM shared_links WHERE id=$1")
            .bind(id).fetch_optional(&self.pool).await?.ok_or(SocialError::NotFound)?;
        let metadata: serde_json::Value = row.try_get("metadata")?;
        Ok(SharedLink {
            id: row.try_get("id")?,
            canonical_url: row.try_get("canonical_url")?,
            provider: row.try_get("provider")?,
            status: row.try_get("status")?,
            title: metadata
                .get("title")
                .and_then(|v| v.as_str())
                .map(str::to_owned),
            thumbnail_url: metadata
                .get("thumbnail_url")
                .and_then(|v| v.as_str())
                .map(str::to_owned),
            caption: metadata
                .get("caption")
                .and_then(|v| v.as_str())
                .map(str::to_owned),
            media_url: row.try_get("media_r2_key")?,
        })
    }

    pub async fn send_message(
        &self,
        actor: Uuid,
        conversation_id: Uuid,
        body: &str,
        shared_link_id: Option<Uuid>,
        media: &[MessageMedia],
    ) -> Result<ConversationMessage, SocialError> {
        let body = body.trim();
        if body.len() > 10_000 || (body.is_empty() && shared_link_id.is_none() && media.is_empty())
        {
            return Err(SocialError::Invalid("message needs text or an attachment"));
        }
        if media.len() > 4
            || media.iter().any(|item| {
                !matches!(item.kind.as_str(), "image" | "video" | "audio" | "document")
                    || item.content_type.is_empty()
                    || item.byte_length == 0
                    || item
                        .width
                        .zip(item.height)
                        .is_some_and(|(width, height)| width == 0 || height == 0)
                    || item.width.is_some() != item.height.is_some()
                    || item
                        .file_name
                        .as_deref()
                        .is_some_and(|name| name.is_empty() || name.len() > 255)
                    || item
                        .alt_text
                        .as_deref()
                        .is_some_and(|text| text.len() > 1000)
            })
        {
            return Err(SocialError::Invalid("invalid message media"));
        }
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
        for (position, item) in media.iter().enumerate() {
            sqlx::query("INSERT INTO conversation_message_media (message_id,position,asset_id,width,height,alt_text,file_name) VALUES ($1,$2,$3,$4,$5,$6,$7)")
                .bind(id).bind(position as i16).bind(item.asset_id).bind(item.width.map(|value| value as i32)).bind(item.height.map(|value| value as i32)).bind(&item.alt_text).bind(&item.file_name).execute(&mut *tx).await?;
        }
        let agents: Vec<(Uuid, i64)> = sqlx::query_as("SELECT agent_profile_id,context_from_sequence FROM conversation_agent_grants WHERE conversation_id=$1 AND can_reply AND agent_profile_id<>$2 AND context_from_sequence<=$3")
            .bind(conversation_id).bind(actor).bind(sequence).fetch_all(&mut *tx).await?;
        for (agent, context_from_sequence) in agents {
            emit_agent_event(&mut tx, "work_message", id, agent, serde_json::json!({"conversation_id": conversation_id, "message_id": id, "sequence": sequence, "context_from_sequence": context_from_sequence, "body": body, "shared_link_id": shared_link_id, "media": media})).await?;
        }
        let sender: String =
            sqlx::query_scalar("SELECT handle FROM social_identities WHERE profile_id=$1")
                .bind(actor)
                .fetch_one(&mut *tx)
                .await?;
        let recipient_accounts: Vec<Uuid> = sqlx::query_scalar(
            "SELECT DISTINCT i.account_id FROM conversation_participants p
             JOIN social_identities i ON i.profile_id=p.profile_id
             WHERE p.conversation_id=$1 AND p.profile_id<>$2 AND i.kind='human'",
        )
        .bind(conversation_id)
        .bind(actor)
        .fetch_all(&mut *tx)
        .await?;
        let preview: String = body.chars().take(180).collect();
        for account in recipient_accounts {
            PgPushStore::enqueue_in(
                &mut tx,
                &NewNotification {
                    source_event_id: Uuid::new_v4(),
                    account_id: account,
                    category: "message".into(),
                    title: format!("@{sender}"),
                    body: preview.clone(),
                    deep_link: Some(format!("tardy://messages/{conversation_id}")),
                    data: serde_json::Map::from_iter([
                        ("actor_id".into(), serde_json::json!(actor)),
                        ("conversation_id".into(), serde_json::json!(conversation_id)),
                        ("message_id".into(), serde_json::json!(id)),
                    ]),
                },
            )
            .await?;
        }
        let message = ConversationMessage {
            id,
            conversation_id,
            sequence,
            sender_profile_id: actor,
            body: body.into(),
            shared_link_id,
            media: media.to_vec(),
            created_at: row.try_get("created_at")?,
            reactions: Vec::new(),
            read_by: Vec::new(),
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
        self.publish_post_with_media(
            actor,
            client_request_id,
            caption,
            shared_link_id,
            visibility,
            &[],
        )
        .await
    }

    pub async fn publish_post_with_media(
        &self,
        actor: Uuid,
        client_request_id: Uuid,
        caption: &str,
        shared_link_id: Option<Uuid>,
        visibility: PostVisibility,
        media: &[PostMedia],
    ) -> Result<TardyPost, SocialError> {
        let caption = validated_text(caption, 5_000)?;
        validate_post_media(media)?;
        let media =
            serde_json::to_value(media).map_err(|_| SocialError::Invalid("invalid media"))?;
        let row = sqlx::query("INSERT INTO tardy_posts (id,author_profile_id,client_request_id,caption,media,shared_link_id,visibility) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (author_profile_id,client_request_id) DO UPDATE SET client_request_id=excluded.client_request_id RETURNING id,author_profile_id,caption,media,shared_link_id,visibility,created_at")
            .bind(Uuid::new_v4()).bind(actor).bind(client_request_id).bind(caption).bind(media).bind(shared_link_id).bind(visibility_name(visibility)).fetch_one(&self.pool).await?;
        Ok(post_from_row(&row)?)
    }

    pub async fn set_post_visibility(
        &self,
        actor: Uuid,
        id: Uuid,
        visibility: PostVisibility,
    ) -> Result<TardyPost, SocialError> {
        let row = sqlx::query("UPDATE tardy_posts SET visibility=$3 WHERE id=$1 AND author_profile_id=$2 RETURNING id,author_profile_id,caption,media,shared_link_id,visibility,created_at")
            .bind(id)
            .bind(actor)
            .bind(visibility_name(visibility))
            .fetch_optional(&self.pool)
            .await?
            .ok_or(SocialError::NotFound)?;
        post_from_row(&row)
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
        let post_author: Uuid = sqlx::query_scalar(VISIBLE_POST_AUTHOR_SQL)
            .bind(post_id)
            .bind(actor)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or(SocialError::NotFound)?;
        let actor_handle = identity_handle(&mut tx, actor).await?;
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
            if !reply_requested && *mentioned != actor {
                notify_human(
                    &mut tx,
                    *mentioned,
                    actor,
                    "mention",
                    &format!("@{actor_handle}"),
                    "mentioned you in a comment",
                    Some(post_id),
                    None,
                )
                .await?;
            }
        }
        if post_author != actor && !unique.contains(&post_author) {
            notify_human(
                &mut tx,
                post_author,
                actor,
                "comment",
                &format!("@{actor_handle}"),
                "commented on your tardy",
                Some(post_id),
                None,
            )
            .await?;
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

    pub async fn comments(&self, actor: Uuid, post_id: Uuid) -> Result<Vec<Comment>, SocialError> {
        let visible = sqlx::query_scalar::<_, Uuid>(VISIBLE_POST_AUTHOR_SQL)
            .bind(post_id)
            .bind(actor)
            .fetch_optional(&self.pool)
            .await?;
        if visible.is_none() {
            return Err(SocialError::NotFound);
        }
        let rows = sqlx::query(
            "SELECT c.id,c.post_id,c.author_profile_id,c.body,c.created_at,
                    COALESCE(array_agg(m.mentioned_profile_id ORDER BY m.mentioned_profile_id)
                        FILTER (WHERE m.mentioned_profile_id IS NOT NULL),'{}') AS mentioned_profile_ids
             FROM post_comments c
             LEFT JOIN comment_mentions m ON m.comment_id=c.id
             WHERE c.post_id=$1
             GROUP BY c.id
             ORDER BY c.created_at,c.id
             LIMIT 500",
        )
        .bind(post_id)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                Ok(Comment {
                    id: row.try_get("id")?,
                    post_id: row.try_get("post_id")?,
                    author_profile_id: row.try_get("author_profile_id")?,
                    body: row.try_get("body")?,
                    mentioned_profile_ids: row.try_get("mentioned_profile_ids")?,
                    created_at: row.try_get("created_at")?,
                })
            })
            .collect()
    }
}

const VISIBLE_POST_AUTHOR_SQL: &str = "SELECT p.author_profile_id
     FROM tardy_posts p
     WHERE p.id=$1 AND (
         p.visibility='public'
         OR p.author_profile_id=$2
         OR EXISTS (
             SELECT 1
             FROM social_identities viewer_identity
             JOIN profile_ownership owned
               ON owned.owner_account_id=viewer_identity.account_id
             WHERE viewer_identity.profile_id=$2
               AND owned.profile_id=p.author_profile_id
         )
         OR (p.visibility='followers' AND EXISTS (
             SELECT 1 FROM profile_follows f
             WHERE f.follower_profile_id=$2
               AND f.followed_profile_id=p.author_profile_id
         ))
     )";

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

async fn identity_handle(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    profile: Uuid,
) -> Result<String, SocialError> {
    sqlx::query_scalar("SELECT handle FROM social_identities WHERE profile_id=$1")
        .bind(profile)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or(SocialError::NotFound)
}

#[allow(clippy::too_many_arguments)]
async fn notify_human(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    recipient_profile: Uuid,
    actor: Uuid,
    category: &str,
    title: &str,
    body: &str,
    post_id: Option<Uuid>,
    conversation_id: Option<Uuid>,
) -> Result<(), SocialError> {
    let account_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT account_id FROM social_identities WHERE profile_id=$1 AND kind='human'",
    )
    .bind(recipient_profile)
    .fetch_optional(&mut **tx)
    .await?;
    let Some(account_id) = account_id else {
        return Ok(());
    };
    let mut data = serde_json::Map::from_iter([("actor_id".into(), serde_json::json!(actor))]);
    let deep_link = if let Some(post_id) = post_id {
        data.insert("post_id".into(), serde_json::json!(post_id));
        Some(format!("tardy://posts/{post_id}"))
    } else if let Some(conversation_id) = conversation_id {
        data.insert("conversation_id".into(), serde_json::json!(conversation_id));
        Some(format!("tardy://messages/{conversation_id}"))
    } else {
        Some(format!("tardy://profiles/{actor}"))
    };
    PgPushStore::enqueue_in(
        tx,
        &NewNotification {
            source_event_id: Uuid::new_v4(),
            account_id,
            category: category.into(),
            title: title.into(),
            body: body.into(),
            deep_link,
            data,
        },
    )
    .await?;
    Ok(())
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
        || !value.bytes().all(|b| {
            b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'_' | b'-' | b'.')
        })
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
        assert_eq!(
            normalize_handle("launch.trailers").unwrap(),
            "launch.trailers"
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
    let verification_tier: Option<String> = row.try_get("verification_tier")?;
    let brand_profile_id: Option<Uuid> = row.try_get("brand_profile_id")?;
    let brand_handle: Option<String> = row.try_get("brand_handle")?;
    let brand_avatar_url: Option<String> = row.try_get("brand_avatar_url")?;
    let brand_label: Option<String> = row.try_get("brand_label")?;
    Ok(AppAccount {
        id: row.try_get("profile_id")?,
        kind: parse_kind(&row.try_get::<String, _>("kind")?)?,
        handle: row.try_get("handle")?,
        display_name: row.try_get("display_name")?,
        avatar_url: row.try_get("avatar_url")?,
        bio: row.try_get("bio")?,
        verified: verification_tier.is_some(),
        verification_tier,
        super_tardy_slot: row.try_get("super_tardy_slot")?,
        brand_affiliate: brand_profile_id.map(|profile_id| BrandAffiliate {
            profile_id,
            handle: brand_handle.unwrap_or_default(),
            avatar_url: brand_avatar_url.unwrap_or_default(),
            label: brand_label,
        }),
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
        format: post_format(&row)?,
        media: app_media(&row)?,
        caption: row.try_get("caption")?,
        links: link
            .map(|url| vec![serde_json::json!({"kind":"other","label":"Open link","url":url})])
            .unwrap_or_default(),
        created_at_ms: row
            .try_get::<DateTime<Utc>, _>("created_at")?
            .timestamp_millis(),
        like_count: row.try_get("like_count")?,
        comment_count: row.try_get("comment_count")?,
        share_count: 0,
        alarm_count: row.try_get("alarm_count")?,
        repost_count: row.try_get("repost_count")?,
        viewer_has_liked: row.try_get("viewer_has_liked")?,
        viewer_has_alarm: row.try_get("viewer_has_alarm")?,
        viewer_has_reposted: row.try_get("viewer_has_reposted")?,
        viewer_has_saved: false,
    })
}
fn post_from_row(row: &sqlx::postgres::PgRow) -> Result<TardyPost, SocialError> {
    Ok(TardyPost {
        id: row.try_get("id")?,
        author_profile_id: row.try_get("author_profile_id")?,
        caption: row.try_get("caption")?,
        media: serde_json::from_value(row.try_get("media")?)
            .map_err(|_| SocialError::Invalid("persisted media"))?,
        shared_link_id: row.try_get("shared_link_id")?,
        visibility: parse_visibility(row.try_get::<String, _>("visibility")?.as_str())?,
        created_at: row.try_get("created_at")?,
    })
}

fn post_format(row: &sqlx::postgres::PgRow) -> Result<&'static str, SocialError> {
    let media = app_media(row)?;
    Ok(
        if media.first().is_some_and(|item| item["type"] == "video") {
            "reel"
        } else if media.len() > 1 {
            "carousel"
        } else {
            "photo"
        },
    )
}

fn app_media(row: &sqlx::postgres::PgRow) -> Result<Vec<serde_json::Value>, SocialError> {
    let media: Vec<serde_json::Value> = serde_json::from_value(row.try_get("media")?)
        .map_err(|_| SocialError::Invalid("persisted media"))?;
    normalize_app_media(media)
}

fn normalize_app_media(
    mut media: Vec<serde_json::Value>,
) -> Result<Vec<serde_json::Value>, SocialError> {
    // The app's reel contract requires a string poster URL. Older agent uploads were
    // allowed to omit it, so keep those rows readable while upload clients migrate to
    // sending a separately generated poster object. Using the video URL is only a
    // compatibility fallback; it is never persisted and therefore cannot become a
    // second source of truth.
    for item in &mut media {
        if item.get("type").and_then(serde_json::Value::as_str) != Some("video") {
            continue;
        }
        let needs_poster = item
            .get("poster_url")
            .is_none_or(serde_json::Value::is_null);
        if needs_poster {
            let Some(url) = item
                .get("url")
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned)
            else {
                return Err(SocialError::Invalid("persisted video URL"));
            };
            item["poster_url"] = serde_json::Value::String(url);
        }
    }
    Ok(media)
}

fn validate_post_media(media: &[PostMedia]) -> Result<(), SocialError> {
    if media.len() > 4 {
        return Err(SocialError::Invalid("too many media items"));
    }
    let media_kind = media.first().map(|item| item.kind.as_str());
    if media_kind == Some("video") && media.len() != 1 {
        return Err(SocialError::Invalid("a reel must contain one video"));
    }
    for item in media {
        let shape_is_valid = match item.kind.as_str() {
            "video" => item.duration_ms > 0,
            "image" => item.duration_ms == 0 && item.poster_url.is_none(),
            _ => false,
        };
        if Some(item.kind.as_str()) != media_kind
            || !shape_is_valid
            || item.width == 0
            || item.height == 0
            || url::Url::parse(&item.url)
                .ok()
                .filter(|url| matches!(url.scheme(), "http" | "https"))
                .is_none()
            || item.poster_url.as_deref().is_some_and(|value| {
                url::Url::parse(value)
                    .ok()
                    .filter(|url| matches!(url.scheme(), "http" | "https"))
                    .is_none()
            })
        {
            return Err(SocialError::Invalid("invalid post media"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod post_media_tests {
    use super::*;

    fn media(kind: &str, duration_ms: u64) -> PostMedia {
        PostMedia {
            kind: kind.into(),
            url: format!("https://media.test/item.{kind}"),
            poster_url: (kind == "video").then(|| "https://media.test/poster.jpg".into()),
            width: 1080,
            height: if kind == "video" { 1920 } else { 1350 },
            duration_ms,
        }
    }

    #[test]
    fn accepts_one_reel_or_an_image_carousel() {
        assert!(validate_post_media(&[media("video", 15_000)]).is_ok());
        assert!(validate_post_media(&[media("image", 0), media("image", 0)]).is_ok());
    }

    #[test]
    fn rejects_mixed_or_multi_video_posts() {
        assert!(validate_post_media(&[media("video", 15_000), media("image", 0)]).is_err());
        assert!(validate_post_media(&[media("video", 15_000), media("video", 15_000)]).is_err());
    }

    #[test]
    fn legacy_video_without_poster_still_satisfies_the_app_contract() {
        let url = "https://media.test/reel.mp4";
        let normalized = normalize_app_media(vec![serde_json::json!({
            "type": "video",
            "url": url,
            "poster_url": null,
            "width": 1080,
            "height": 1920,
            "duration_ms": 15_000
        })])
        .unwrap();

        assert_eq!(normalized[0]["poster_url"], url);
    }
}
fn message_from_row(row: &sqlx::postgres::PgRow) -> Result<ConversationMessage, SocialError> {
    Ok(ConversationMessage {
        id: row.try_get("id")?,
        conversation_id: row.try_get("conversation_id")?,
        sequence: row.try_get("sequence")?,
        sender_profile_id: row.try_get("sender_profile_id")?,
        body: row.try_get("body")?,
        shared_link_id: row.try_get("shared_link_id")?,
        media: serde_json::from_value(row.try_get("media")?)
            .map_err(|_| SocialError::Invalid("persisted message media"))?,
        created_at: row.try_get("created_at")?,
        reactions: serde_json::from_value(row.try_get("reactions")?)
            .map_err(|_| SocialError::Invalid("persisted reactions"))?,
        read_by: row.try_get("read_by")?,
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
