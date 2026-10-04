use crate::ads::{
    AdPaymentProcessor, AdsError, CampaignReport, FundingIntent, NewCampaign, PaymentRequired,
    PaymentRequirements, PgAdsStore, ResourceInfo, X402_VERSION,
};
use crate::apple_auth::{AppleAuthError, AppleAuthenticator};
use crate::audio::{
    AttachPostAudio, AudioError, AudioRelease, AudioUsage, NewAudioRelease, NewOriginalTrack,
    PgAudioStore, TrendingAudio,
};
use crate::domain::{
    AgentCapabilities, AgentHandoff, AgentShareReceipt, EngagementKind, LiveEventPayload,
    ProfilePrivacy, ShareSubject, Visibility,
};
use crate::media::{MediaError, MediaService, UploadIntent};
use crate::metrics::Metrics;
use crate::onboarding::{AccountRegistry, OnboardingError, TemporaryTardyAccount};
use crate::pg_accounts::{HumanProfile, HumanSession, PgAccountError, PgAccountStore};
use crate::push::{
    AppNotification, NotificationPreference, NotificationPreferences, PgPushStore, PushDevice,
    PushError, RegisterPushDevice,
};
use crate::ranking::FeedRanker;
use crate::search::{SearchDocument, SearchError, SearchService};
use crate::social::{
    AppAccount, AppEngagementAction, AppFeedPost, AppSearchResult, Comment, Conversation,
    ConversationMessage, ConversationSummary, IdentityKind, PgSocialStore, PostMedia,
    PostVisibility, SetBrandAffiliate, SharedLink, SocialError, TardyPost,
};
use crate::store::{MemoryStore, NewLive, NewProfile, NewReel, Store, StoreError};
use crate::subscriptions::{
    FeedEvent, NewSubscription, PgSubscriptionStore, Subscription, SubscriptionError,
};
use crate::web_billing::{BillingError, PgWebBillingStore, WEB_SESSION_COOKIE};
use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, Path, Query, State};
use axum::http::{HeaderMap, Method, StatusCode, header};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch, post, put};
use axum::{Json, Router, middleware};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use std::{convert::Infallible, time::Duration};
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio_stream::wrappers::ReceiverStream;
use tokio_util::io::ReaderStream;
use tower_http::cors::CorsLayer;
use utoipa::ToSchema;
use uuid::Uuid;

pub struct AppState {
    pub store: Arc<dyn Store>,
    pub ranker: FeedRanker,
    pub public_base_url: String,
    pub accounts: Arc<AccountRegistry>,
    pub pg_accounts: Option<Arc<PgAccountStore>>,
    pub metrics: Arc<Metrics>,
    pub media: Arc<MediaService>,
    pub search: Arc<SearchService>,
    pub push: Option<Arc<PgPushStore>>,
    pub ads: Option<Arc<AdsRuntime>>,
    pub subscriptions: Option<Arc<PgSubscriptionStore>>,
    pub social: Option<Arc<PgSocialStore>>,
    pub audio: Option<Arc<PgAudioStore>>,
    pub apple_auth: Option<Arc<AppleAuthenticator>>,
    pub web_billing: Option<Arc<PgWebBillingStore>>,
}

pub struct AdsRuntime {
    pub store: PgAdsStore,
    pub processor: Arc<dyn AdPaymentProcessor>,
    pub requirement: PaymentRequirements,
    pub atomic_per_budget_micro: u64,
}

impl AppState {
    pub fn in_memory(
        public_base_url: impl Into<String>,
    ) -> Result<Self, crate::ranking::RankingError> {
        Ok(Self {
            store: Arc::new(MemoryStore::default()),
            ranker: FeedRanker::Lua(crate::ranking::LuaRanker::default_policy()?),
            public_base_url: public_base_url.into().trim_end_matches('/').to_owned(),
            accounts: Arc::new(AccountRegistry::in_memory().expect("in-memory account registry")),
            pg_accounts: None,
            metrics: Arc::new(Metrics::new()),
            media: Arc::new(MediaService::new(None)),
            search: Arc::new(SearchService::disabled()),
            push: None,
            ads: None,
            subscriptions: None,
            social: None,
            audio: None,
            apple_auth: None,
            web_billing: None,
        })
    }

    pub fn with_account_db(
        public_base_url: impl Into<String>,
        path: impl AsRef<std::path::Path>,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        Ok(Self {
            store: Arc::new(MemoryStore::default()),
            ranker: FeedRanker::from_env()?,
            public_base_url: public_base_url.into().trim_end_matches('/').to_owned(),
            accounts: Arc::new(AccountRegistry::open(path)?),
            pg_accounts: None,
            metrics: Arc::new(Metrics::new()),
            media: Arc::new(MediaService::from_env()?),
            search: Arc::new(SearchService::from_env()?),
            push: None,
            ads: None,
            subscriptions: None,
            social: None,
            audio: None,
            apple_auth: None,
            web_billing: None,
        })
    }

    pub fn postgres(
        public_base_url: impl Into<String>,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        Ok(Self {
            store: Arc::new(MemoryStore::default()),
            ranker: FeedRanker::from_env()?,
            public_base_url: public_base_url.into().trim_end_matches('/').to_owned(),
            // Unit-only compatibility backend. Production authentication is set by `with_pg_accounts`.
            accounts: Arc::new(AccountRegistry::in_memory()?),
            pg_accounts: None,
            metrics: Arc::new(Metrics::new()),
            media: Arc::new(MediaService::from_env()?),
            search: Arc::new(SearchService::from_env()?),
            push: None,
            ads: None,
            subscriptions: None,
            social: None,
            audio: None,
            apple_auth: None,
            web_billing: None,
        })
    }

    pub fn with_push_store(mut self, push: PgPushStore) -> Self {
        self.push = Some(Arc::new(push));
        self
    }

    pub fn with_media_service(mut self, media: MediaService) -> Self {
        self.media = Arc::new(media);
        self
    }

    pub fn with_ads(mut self, ads: AdsRuntime) -> Self {
        self.ads = Some(Arc::new(ads));
        self
    }

    pub fn with_subscriptions(mut self, value: PgSubscriptionStore) -> Self {
        self.subscriptions = Some(Arc::new(value));
        self
    }

    pub fn with_social_store(mut self, value: PgSocialStore) -> Self {
        self.social = Some(Arc::new(value));
        self
    }

    pub fn with_pg_accounts(mut self, value: PgAccountStore) -> Self {
        self.pg_accounts = Some(Arc::new(value));
        self
    }

    pub fn with_audio_store(mut self, value: PgAudioStore) -> Self {
        self.audio = Some(Arc::new(value));
        self
    }

    pub fn with_apple_auth(mut self, value: AppleAuthenticator) -> Self {
        self.apple_auth = Some(Arc::new(value));
        self
    }

    pub fn with_web_billing(mut self, value: PgWebBillingStore) -> Self {
        self.web_billing = Some(Arc::new(value));
        self
    }

    pub async fn purge_expired_unclaimed_tardies(&self) -> Result<usize, ApiError> {
        let expired = purge_accounts(self, now_ms()?).await?;
        if !expired.is_empty() {
            social_store(self)?.delete_identities(&expired).await?;
            self.store.delete_profiles(&expired)?;
        }
        Ok(expired.len())
    }
}

pub fn router(state: Arc<AppState>) -> Router {
    let metrics = state.metrics.clone();
    let web_origin =
        std::env::var("TARDY_WEB_BASE_URL").unwrap_or_else(|_| "https://tardy.news".into());
    let cors = CorsLayer::new()
        .allow_origin(
            web_origin
                .parse::<axum::http::HeaderValue>()
                .expect("TARDY_WEB_BASE_URL must be an HTTP origin"),
        )
        .allow_credentials(true)
        .allow_methods([Method::GET, Method::POST, Method::DELETE])
        .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION]);
    Router::new()
        .route("/healthz", get(|| async { StatusCode::NO_CONTENT }))
        .route("/metrics", get(metrics_endpoint))
        .route("/openapi.json", get(openapi_endpoint))
        .route("/v1/verification/products", get(verification_products))
        .route("/v1/web/handoffs", post(create_web_handoff))
        .route("/v1/web/session/exchange", post(exchange_web_handoff))
        .route("/v1/web/session", axum::routing::delete(delete_web_session))
        .route("/v1/web/billing", get(web_billing_status))
        .route(
            "/v1/web/billing/stripe/checkout",
            post(stripe_verification_checkout),
        )
        .route("/v1/web/billing/stripe/portal", post(stripe_billing_portal))
        .route("/v1/web/billing/stripe/webhook", post(stripe_webhook))
        .route("/llms.txt", get(llms_txt))
        .route("/mcp", post(crate::mcp::endpoint))
        .route("/v1/sessions", post(create_session))
        .route("/v1/dev/session", post(development_session))
        .route("/v1/session", get(current_session).delete(delete_session))
        .route("/v1/profile", get(current_profile).patch(update_profile))
        .route("/v1/profile/avatar/generate", post(generate_profile_avatar))
        .route("/v1/avatars/{seed}", get(generated_avatar))
        .route("/v1/profile/handle", put(set_profile_handle))
        .route("/v1/profile/suggested-follows", get(suggested_follows))
        .route("/v1/profile/following", get(current_following))
        .route("/v1/profiles", post(create_profile).get(list_profiles))
        .route("/v1/profiles/search", get(search_profiles))
        .route("/v1/profiles/by-id/{id}", get(get_profile_by_id))
        .route("/v1/profiles/by-id/{id}/posts", get(get_profile_posts))
        .route("/v1/profiles/by-id/{id}/agents", get(get_profile_agents))
        .route("/v1/profiles/{handle}", get(get_profile))
        .route("/v1/agents/{id}/profile", patch(update_agent_profile))
        .route(
            "/v1/agents/{id}/avatar/generate",
            post(generate_agent_avatar),
        )
        .route(
            "/v1/brands/{brand_id}/affiliates/{profile_id}",
            put(set_brand_affiliate).delete(clear_brand_affiliate),
        )
        .route(
            "/v1/profiles/{profile_id}/follow",
            put(follow_profile).delete(unfollow_profile),
        )
        .route("/v1/profile/privacy", post(update_privacy))
        .route("/v1/blocks/{profile_id}", post(block_profile))
        .route("/v1/dm-threads", post(create_thread))
        .route(
            "/v1/dm-threads/{id}/messages",
            post(send_message).get(list_messages),
        )
        .route("/v1/shares", post(create_share))
        .route("/v1/shares/{id}/revoke", post(revoke_share))
        .route("/v1/shared/{token}", get(resolve_share))
        .route("/v1/onboarding/agent-codes", post(issue_agent_code))
        .route("/v1/onboarding/claims", post(claim_agent_code))
        .route("/v1/onboarding/tardies", post(register_tardy_account))
        .route(
            "/v1/onboarding/tardies/connect",
            post(connect_tardy_account),
        )
        .route("/v1/onboarding/tardy-claims", post(claim_tardy_account))
        .route("/v1/onboarding/complete", post(complete_onboarding))
        .route("/v1/uploads", post(authorize_upload))
        .route("/v1/uploads/{id}/complete", post(complete_upload))
        .route("/v1/reels", post(publish_reel))
        .route("/v1/reels/{id}/engagements", post(record_engagement))
        .route("/v1/saved-posts", get(list_saved_posts))
        .route("/v1/saved-posts/{id}", put(save_post).delete(unsave_post))
        .route("/v1/posts/{id}", get(get_app_post))
        .route("/v1/posts/{id}/like", put(like_post).delete(unlike_post))
        .route("/v1/posts/{id}/alarm", put(alarm_post).delete(unalarm_post))
        .route(
            "/v1/posts/{id}/repost",
            put(repost_post).delete(unrepost_post),
        )
        .route(
            "/v1/ai-consents/search",
            post(grant_search_consent).delete(revoke_search_consent),
        )
        .route("/v1/search", post(search_posts))
        .route("/v1/explore", get(explore_feed).post(explore_posts))
        .route("/v1/lives", post(start_live))
        .route("/v1/lives/{id}/events", post(append_event).get(list_events))
        .route("/v1/lives/{id}/end", post(end_live))
        .route("/v1/feed", get(feed))
        .route("/v1/feed/reels", get(reels_feed))
        .route("/v1/engagements", post(record_app_engagements))
        .route("/v1/stories", get(stories))
        .route("/v1/dev/blobs/{name}", get(local_blob))
        .route(
            "/v1/dev/uploads/{*key}",
            get(local_upload)
                .head(local_upload)
                .put(put_local_upload)
                .layer(DefaultBodyLimit::max(250 << 20)),
        )
        .route("/v1/dev/brags/{slug}/{name}", get(local_brag))
        .route("/v1/feed/hyper-tardy", get(hyper_tardy_feed))
        .route("/v1/agent-handoffs", post(agent_handoff))
        .route("/v1/agent-shares", post(share_to_agent))
        .route("/v1/social/shared-links", post(create_shared_link))
        .route("/v1/social/shared-links/{id}", get(get_shared_link))
        .route(
            "/v1/social/conversations",
            post(create_social_conversation).get(list_social_conversations),
        )
        .route(
            "/v1/social/conversations/{id}/messages",
            post(send_social_message).get(list_social_messages),
        )
        .route(
            "/v1/social/conversations/{id}/events",
            get(stream_social_conversation),
        )
        .route(
            "/v1/social/conversations/{id}",
            put(rename_social_conversation),
        )
        .route(
            "/v1/social/conversations/{id}/participants",
            post(add_social_conversation_participant),
        )
        .route(
            "/v1/social/conversations/{id}/participants/{profile_id}",
            axum::routing::delete(remove_social_conversation_participant),
        )
        .route(
            "/v1/social/conversations/{id}/messages/{message_id}/reaction",
            put(set_social_message_reaction).delete(clear_social_message_reaction),
        )
        .route(
            "/v1/social/conversations/{id}/typing",
            get(list_social_typing)
                .put(start_social_typing)
                .delete(stop_social_typing),
        )
        .route(
            "/v1/social/conversations/{id}/read",
            post(mark_social_conversation_read),
        )
        .route(
            "/v1/social/conversations/{id}/agents",
            post(summon_social_agent),
        )
        .route("/v1/social/posts", post(publish_social_post))
        .route(
            "/v1/social/posts/{id}/visibility",
            put(set_social_post_visibility),
        )
        .route(
            "/v1/social/posts/{id}/comments",
            get(list_post_comments).post(create_post_comment),
        )
        .route("/v1/audio/releases", post(create_audio_release))
        .route("/v1/audio/releases/{id}/tracks", post(add_audio_track))
        .route("/v1/social/posts/{id}/audio", post(attach_post_audio))
        .route("/v1/audio/tracks/{id}/usage", post(record_audio_usage))
        .route("/v1/audio/trending", get(trending_audio))
        .route("/v1/push/devices", post(register_push_device))
        .route(
            "/v1/push/devices/{id}",
            axum::routing::delete(unregister_push_device),
        )
        .route("/v1/push/devices/unregister", post(unregister_push_token))
        .route(
            "/v1/push/preferences",
            get(get_notification_preferences).put(set_notification_preference),
        )
        .route("/v1/notifications", get(list_notifications))
        .route("/v1/notifications/read", post(mark_notifications_read))
        .route("/v1/ad-campaigns", post(create_ad_campaign))
        .route(
            "/v1/ad-campaigns/{id}/funding-intents",
            post(create_ad_funding_intent),
        )
        .route("/v1/ad-campaigns/{id}/report", get(ad_campaign_report))
        .route(
            "/v1/ad-funding-intents/{id}/settle",
            post(settle_ad_funding),
        )
        .route("/v1/feed-subscriptions", post(create_feed_subscription))
        .route(
            "/v1/feed-subscriptions/{id}",
            axum::routing::delete(delete_feed_subscription),
        )
        .route(
            "/v1/feed-subscriptions/{id}/events",
            get(poll_feed_subscription),
        )
        .with_state(state)
        .layer(cors)
        .layer(middleware::from_fn(move |request, next| {
            crate::metrics::track(metrics.clone(), request, next)
        }))
}

async fn verification_products() -> Json<[crate::verification::VerificationProduct; 2]> {
    Json(crate::verification::products())
}

#[derive(Debug, Deserialize, ToSchema)]
pub(crate) struct CreateWebHandoff {
    return_path: String,
}

async fn create_web_handoff(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<CreateWebHandoff>,
) -> Result<Json<crate::web_billing::WebHandoff>, ApiError> {
    let account_id = authenticated_account(&state, &headers).await?;
    Ok(Json(
        web_billing(&state)?
            .issue_handoff(account_id, &body.return_path)
            .await?,
    ))
}

#[derive(Debug, Deserialize, ToSchema)]
pub(crate) struct ExchangeWebHandoff {
    code: String,
}

async fn exchange_web_handoff(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ExchangeWebHandoff>,
) -> Result<Response, ApiError> {
    let session = web_billing(&state)?.exchange_handoff(&body.code).await?;
    let secure = web_billing(&state)?.cookie_secure_attribute();
    let cookie = format!(
        "{WEB_SESSION_COOKIE}={}; Path=/v1/web; Max-Age=2592000; HttpOnly; SameSite=Lax{secure}",
        session.cookie,
    );
    Ok((
        [(header::SET_COOKIE, cookie)],
        Json(serde_json::json!({ "return_path": session.return_path })),
    )
        .into_response())
}

async fn delete_web_session(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    if let Some(token) = web_cookie(&headers) {
        web_billing(&state)?.revoke(token).await?;
    }
    Ok((
        [(
            header::SET_COOKIE,
            format!(
                "{WEB_SESSION_COOKIE}=; Path=/v1/web; Max-Age=0; HttpOnly; SameSite=Lax{}",
                web_billing(&state)?.cookie_secure_attribute()
            ),
        )],
        StatusCode::NO_CONTENT,
    )
        .into_response())
}

async fn web_billing_status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<crate::web_billing::BillingStatus>, ApiError> {
    let account = web_account(&state, &headers).await?;
    Ok(Json(web_billing(&state)?.status(account).await?))
}

#[derive(Debug, Deserialize, ToSchema)]
pub(crate) struct VerificationCheckout {
    tier: crate::verification::VerificationTier,
}

async fn stripe_verification_checkout(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<VerificationCheckout>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_web_origin(&headers)?;
    let account = web_account(&state, &headers).await?;
    let url = web_billing(&state)?
        .stripe_checkout(account, body.tier)
        .await?;
    Ok(Json(serde_json::json!({ "url": url })))
}

async fn stripe_billing_portal(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_web_origin(&headers)?;
    let account = web_account(&state, &headers).await?;
    let url = web_billing(&state)?.stripe_portal(account).await?;
    Ok(Json(serde_json::json!({ "url": url })))
}

async fn stripe_webhook(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Result<StatusCode, ApiError> {
    let signature = headers
        .get("stripe-signature")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| ApiError::unauthorized("Stripe signature is required"))?;
    web_billing(&state)?
        .stripe_webhook(signature, &body)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

fn web_billing(state: &AppState) -> Result<&PgWebBillingStore, ApiError> {
    state.web_billing.as_deref().ok_or_else(|| ApiError {
        status: StatusCode::SERVICE_UNAVAILABLE,
        message: "website billing is not configured".into(),
    })
}

async fn web_account(state: &AppState, headers: &HeaderMap) -> Result<Uuid, ApiError> {
    let token = web_cookie(headers)
        .ok_or_else(|| ApiError::unauthorized("website session is required"))?
        .to_owned();
    Ok(web_billing(state)?.authenticate(&token).await?)
}

fn web_cookie(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .map(str::trim)
        .find_map(|part| part.strip_prefix(&format!("{WEB_SESSION_COOKIE}=")))
}

fn require_web_origin(headers: &HeaderMap) -> Result<(), ApiError> {
    let expected =
        std::env::var("TARDY_WEB_BASE_URL").unwrap_or_else(|_| "https://tardy.news".into());
    match headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) {
        Some(origin) if origin.trim_end_matches('/') == expected.trim_end_matches('/') => Ok(()),
        _ => Err(ApiError::forbidden("website origin is not allowed")),
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub(crate) struct AppEngagementBatch {
    actions: Vec<AppEngagementAction>,
}

async fn record_app_engagements(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<AppEngagementBatch>,
) -> Result<StatusCode, ApiError> {
    let viewer = authenticated_actor(&state, &headers).await?;
    if body.actions.is_empty() || body.actions.len() > 500 {
        return Err(ApiError::unprocessable(
            "engagement batch must contain 1 to 500 actions",
        ));
    }
    social_store(&state)?
        .record_engagements(viewer, &body.actions)
        .await
        .map_err(|error| match error {
            SocialError::Invalid(_) => ApiError::unprocessable(error.to_string()),
            other => other.into(),
        })?;
    Ok(StatusCode::ACCEPTED)
}

async fn like_post(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    social_store(&state)?
        .set_post_liked(authenticated_actor(&state, &headers).await?, id, true)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn unlike_post(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    social_store(&state)?
        .set_post_liked(authenticated_actor(&state, &headers).await?, id, false)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn alarm_post(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    social_store(&state)?
        .set_post_marker(
            authenticated_actor(&state, &headers).await?,
            id,
            "alarm",
            true,
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn unalarm_post(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    social_store(&state)?
        .set_post_marker(
            authenticated_actor(&state, &headers).await?,
            id,
            "alarm",
            false,
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn repost_post(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    social_store(&state)?
        .set_post_marker(
            authenticated_actor(&state, &headers).await?,
            id,
            "repost",
            true,
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn unrepost_post(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    social_store(&state)?
        .set_post_marker(
            authenticated_actor(&state, &headers).await?,
            id,
            "repost",
            false,
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_app_post(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<AppFeedPost>, ApiError> {
    let viewer = Some(authenticated_actor(&state, &headers).await?);
    let mut post = social_store(&state)?.app_post(viewer, id).await?;
    localize_posts(&state, std::slice::from_mut(&mut post));
    Ok(Json(post))
}

/// Session restoration is an explicit route even before the provider exchange lands.
/// This matters to clients carrying an old development token: they receive 401 and can
/// clear the keychain instead of mistaking a missing route for a server outage.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(tag = "provider", rename_all = "snake_case")]
pub(crate) enum SessionCredential {
    Apple {
        identity_token: String,
        authorization_code: String,
        nonce: String,
        full_name: Option<String>,
    },
}

#[derive(Debug, Serialize, ToSchema)]
pub(crate) struct SessionView {
    token: String,
    account_id: Uuid,
    provider: String,
    expires_at_ms: u64,
}

#[derive(Debug, Serialize, ToSchema)]
pub(crate) struct AccountView {
    id: Uuid,
    kind: &'static str,
    handle: String,
    display_name: String,
    avatar_url: String,
    bio: String,
    verified: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    verification_tier: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    super_tardy_slot: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    brand_affiliate: Option<crate::social::BrandAffiliate>,
    followers: u64,
    following: u64,
    post_count: u64,
}

#[derive(Debug, Serialize, ToSchema)]
pub(crate) struct SignedInView {
    session: SessionView,
    account: AccountView,
    onboarded_at_ms: Option<u64>,
}

async fn create_session(
    State(state): State<Arc<AppState>>,
    Json(credential): Json<SessionCredential>,
) -> Result<(StatusCode, Json<SignedInView>), ApiError> {
    let accounts = state
        .pg_accounts
        .as_ref()
        .ok_or_else(|| ApiError::internal("PostgreSQL accounts are not configured"))?;
    let session = match credential {
        SessionCredential::Apple {
            identity_token,
            authorization_code,
            nonce,
            full_name,
        } => {
            if authorization_code.trim().is_empty() {
                return Err(ApiError::bad_request(
                    "Apple authorization code is required",
                ));
            }
            let verifier = state.apple_auth.as_ref().ok_or_else(|| ApiError {
                status: StatusCode::SERVICE_UNAVAILABLE,
                message: "Sign in with Apple is not configured".into(),
            })?;
            let identity = verifier.verify(&identity_token, &nonce).await?;
            accounts
                .sign_in_apple(
                    &identity.subject,
                    identity.email.as_deref(),
                    full_name.as_deref(),
                    &identity.assertion_digest,
                    now_ms()?,
                )
                .await?
        }
    };
    Ok((
        StatusCode::CREATED,
        Json(signed_in_view(&state, session).await?),
    ))
}

#[derive(Deserialize)]
struct DevelopmentSessionRequest {
    email: Option<String>,
}

async fn development_session(
    State(state): State<Arc<AppState>>,
    Json(body): Json<DevelopmentSessionRequest>,
) -> Result<(StatusCode, Json<SignedInView>), ApiError> {
    if std::env::var("TARDY_ENABLE_DEV_AUTH").as_deref() != Ok("yes") {
        return Err(ApiError::not_found("not found"));
    }
    let configured_email = std::env::var("TARDY_DEV_AUTH_EMAIL").ok();
    let email = body
        .email
        .as_deref()
        .filter(|email| !email.trim().is_empty())
        .or(configured_email.as_deref())
        .unwrap_or("orangej20@gmail.com")
        .to_owned();
    let session = state
        .pg_accounts
        .as_ref()
        .ok_or_else(|| ApiError::internal("PostgreSQL accounts are not configured"))?
        .development_session(&email, now_ms()?)
        .await?;
    Ok((
        StatusCode::CREATED,
        Json(signed_in_view(&state, session).await?),
    ))
}

async fn current_session(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<SignedInView>, ApiError> {
    let token = bearer_token(&headers)?
        .ok_or_else(|| ApiError::unauthorized("bearer token is required"))?;
    let accounts = state
        .pg_accounts
        .as_ref()
        .ok_or_else(|| ApiError::internal("PostgreSQL accounts are not configured"))?;
    let session = accounts
        .resume_human_session(token, now_ms()?)
        .await
        .map_err(|_| ApiError::unauthorized("invalid bearer token"))?;
    Ok(Json(signed_in_view(&state, session).await?))
}

async fn delete_session(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    let token = bearer_token(&headers)?
        .ok_or_else(|| ApiError::unauthorized("bearer token is required"))?;
    state
        .pg_accounts
        .as_ref()
        .ok_or_else(|| ApiError::internal("PostgreSQL accounts are not configured"))?
        .revoke_human_session(token, now_ms()?)
        .await
        .map_err(|_| ApiError::unauthorized("invalid bearer token"))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn current_profile(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<AccountView>, ApiError> {
    let account = authenticated_account(&state, &headers).await?;
    let profile = state
        .pg_accounts
        .as_ref()
        .ok_or_else(|| ApiError::internal("PostgreSQL accounts are not configured"))?
        .human_profile_for_account(account)
        .await?;
    Ok(Json(account_view(&state, profile).await?))
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct UpdateProfile {
    display_name: Option<String>,
    bio: Option<String>,
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct UpdateAgentProfile {
    handle: Option<String>,
    display_name: Option<String>,
    bio: Option<String>,
    avatar_url: Option<String>,
}

async fn get_profile_agents(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<AppAccount>>, ApiError> {
    let viewer = authenticated_account(&state, &headers).await?;
    let mut agents = social_store(&state)?.owned_agents_for_profile(id).await?;
    social_store(&state)?
        .mark_owned_accounts(viewer, &mut agents)
        .await?;
    localize_accounts(&mut agents);
    Ok(Json(agents))
}

async fn update_agent_profile(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateAgentProfile>,
) -> Result<Json<AppAccount>, ApiError> {
    if body.handle.is_none()
        && body.display_name.is_none()
        && body.bio.is_none()
        && body.avatar_url.is_none()
    {
        return Err(ApiError::bad_request("agent profile update is empty"));
    }
    let owner = authenticated_account(&state, &headers).await?;
    let mut account = social_store(&state)?
        .update_owned_agent_profile(
            owner,
            id,
            body.handle.as_deref(),
            body.display_name.as_deref(),
            body.bio.as_deref(),
            body.avatar_url.as_deref(),
        )
        .await?;
    account.owned_by_viewer = Some(true);
    localize_accounts(std::slice::from_mut(&mut account));
    Ok(Json(account))
}

async fn generate_agent_avatar(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<AppAccount>, ApiError> {
    let owner = authenticated_account(&state, &headers).await?;
    let avatar_url = dicebear_avatar_url(IdentityKind::Agent, &Uuid::new_v4().to_string());
    let mut account = social_store(&state)?
        .update_owned_agent_profile(owner, id, None, None, None, Some(&avatar_url))
        .await?;
    account.owned_by_viewer = Some(true);
    localize_accounts(std::slice::from_mut(&mut account));
    Ok(Json(account))
}

async fn update_profile(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<UpdateProfile>,
) -> Result<Json<AccountView>, ApiError> {
    if body.display_name.is_none() && body.bio.is_none() {
        return Err(ApiError::bad_request("profile update is empty"));
    }
    let account = authenticated_account(&state, &headers).await?;
    let profile = state
        .pg_accounts
        .as_ref()
        .ok_or_else(|| ApiError::internal("PostgreSQL accounts are not configured"))?
        .update_human_profile(account, body.display_name.as_deref(), body.bio.as_deref())
        .await?;
    Ok(Json(account_view(&state, profile).await?))
}

async fn generate_profile_avatar(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<AccountView>, ApiError> {
    let account = authenticated_account(&state, &headers).await?;
    let seed = Uuid::new_v4();
    let avatar_url = dicebear_avatar_url(IdentityKind::Human, &seed.to_string());
    let profile = state
        .pg_accounts
        .as_ref()
        .ok_or_else(|| ApiError::internal("PostgreSQL accounts are not configured"))?
        .set_human_avatar(account, &avatar_url)
        .await?;
    Ok(Json(account_view(&state, profile).await?))
}

async fn generated_avatar(Path(seed): Path<Uuid>) -> impl IntoResponse {
    let bytes = seed.as_bytes();
    let background = format!(
        "#{:02x}{:02x}{:02x}",
        bytes[0] / 2,
        bytes[1] / 2,
        bytes[2] / 2
    );
    let accent = format!(
        "#{:02x}{:02x}{:02x}",
        160 + bytes[3] % 96,
        140 + bytes[4] % 116,
        bytes[5]
    );
    let svg = format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><rect width="160" height="160" rx="36" fill="{background}"/><circle cx="80" cy="73" r="45" fill="{accent}"/><circle cx="63" cy="68" r="6" fill="#111"/><circle cx="97" cy="68" r="6" fill="#111"/><path d="M57 92 Q80 110 103 92" fill="none" stroke="#111" stroke-width="8" stroke-linecap="round"/><path d="M80 16 L91 36 H69 Z" fill="#ffd400"/></svg>"##
    );
    (
        [
            (header::CONTENT_TYPE, "image/svg+xml; charset=utf-8"),
            (header::CACHE_CONTROL, "public, max-age=31536000, immutable"),
        ],
        svg,
    )
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct SetHandle {
    handle: String,
}

async fn set_profile_handle(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<SetHandle>,
) -> Result<Json<AccountView>, ApiError> {
    let account = authenticated_account(&state, &headers).await?;
    let profile = state
        .pg_accounts
        .as_ref()
        .ok_or_else(|| ApiError::internal("PostgreSQL accounts are not configured"))?
        .set_human_handle(account, &body.handle)
        .await?;
    Ok(Json(account_view(&state, profile).await?))
}

async fn suggested_follows(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<AppAccount>>, ApiError> {
    let account = authenticated_account(&state, &headers).await?;
    let own_profile = state
        .pg_accounts
        .as_ref()
        .ok_or_else(|| ApiError::internal("PostgreSQL accounts are not configured"))?
        .human_profile_for_account(account)
        .await?
        .profile_id;
    let mut accounts = social_store(&state)?
        .search_app_accounts(account, "", 50)
        .await?;
    accounts.retain(|candidate| candidate.id != own_profile);
    localize_accounts(&mut accounts);
    Ok(Json(accounts))
}

async fn complete_onboarding(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<SignedInView>, ApiError> {
    let token = bearer_token(&headers)?
        .ok_or_else(|| ApiError::unauthorized("bearer token is required"))?;
    let accounts = state
        .pg_accounts
        .as_ref()
        .ok_or_else(|| ApiError::internal("PostgreSQL accounts are not configured"))?;
    let session = accounts
        .resume_human_session(token, now_ms()?)
        .await
        .map_err(|_| ApiError::unauthorized("invalid bearer token"))?;
    accounts
        .complete_human_onboarding(session.profile.account_id, now_ms()?)
        .await?;
    let session = accounts.resume_human_session(token, now_ms()?).await?;
    Ok(Json(signed_in_view(&state, session).await?))
}

async fn current_following(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<Uuid>>, ApiError> {
    let account = authenticated_account(&state, &headers).await?;
    Ok(Json(
        state
            .pg_accounts
            .as_ref()
            .ok_or_else(|| ApiError::internal("PostgreSQL accounts are not configured"))?
            .following_profile_ids(account)
            .await?,
    ))
}

#[derive(Deserialize)]
struct ProfilesQuery {
    ids: String,
}

async fn list_profiles(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<ProfilesQuery>,
) -> Result<Json<Vec<AppAccount>>, ApiError> {
    let viewer_account = authenticated_account(&state, &headers).await?;
    let ids = query
        .ids
        .split(',')
        .filter(|value| !value.is_empty())
        .map(|value| {
            Uuid::parse_str(value).map_err(|_| ApiError::bad_request("invalid profile id"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    if ids.len() > 100 {
        return Err(ApiError::bad_request("at most 100 profile ids are allowed"));
    }
    let mut accounts = social_store(&state)?.app_accounts(&ids).await?;
    social_store(&state)?
        .mark_owned_accounts(viewer_account, &mut accounts)
        .await?;
    localize_accounts(&mut accounts);
    Ok(Json(accounts))
}

#[derive(Deserialize)]
struct ProfileSearchQuery {
    #[serde(default)]
    q: String,
}

async fn search_profiles(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<ProfileSearchQuery>,
) -> Result<Json<Vec<AppAccount>>, ApiError> {
    let account = authenticated_account(&state, &headers).await?;
    let mut accounts = social_store(&state)?
        .search_app_accounts(account, &query.q, 50)
        .await?;
    localize_accounts(&mut accounts);
    Ok(Json(accounts))
}

async fn signed_in_view(state: &AppState, value: HumanSession) -> Result<SignedInView, ApiError> {
    let onboarded_at_ms = value.profile.onboarded_at_ms;
    Ok(SignedInView {
        session: SessionView {
            token: value.token,
            account_id: value.profile.profile_id,
            provider: value.provider,
            expires_at_ms: value.expires_at_ms,
        },
        account: account_view(state, value.profile).await?,
        onboarded_at_ms,
    })
}

async fn account_view(state: &AppState, value: HumanProfile) -> Result<AccountView, ApiError> {
    let account = social_store(state)?
        .app_account_by_id(value.profile_id)
        .await?;
    Ok(AccountView {
        id: account.id,
        kind: "human",
        handle: account.handle,
        display_name: account.display_name,
        avatar_url: if account.avatar_url.is_empty()
            || account.avatar_url == "https://tardy.news/favicon.svg"
        {
            dicebear_avatar_url(IdentityKind::Human, &value.handle)
        } else {
            account.avatar_url
        },
        bio: account.bio,
        verified: account.verified,
        verification_tier: account.verification_tier,
        super_tardy_slot: account.super_tardy_slot,
        brand_affiliate: account.brand_affiliate,
        followers: account.followers.max(0) as u64,
        following: account.following.max(0) as u64,
        post_count: account.post_count.max(0) as u64,
    })
}

async fn set_brand_affiliate(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((brand_id, profile_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<SetBrandAffiliate>,
) -> Result<Json<AppAccount>, ApiError> {
    let account_id = authenticated_account(&state, &headers).await?;
    Ok(Json(
        social_store(&state)?
            .set_brand_affiliate(account_id, brand_id, profile_id, body.label.as_deref())
            .await?,
    ))
}

async fn clear_brand_affiliate(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((brand_id, profile_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, ApiError> {
    let account_id = authenticated_account(&state, &headers).await?;
    social_store(&state)?
        .clear_brand_affiliate(account_id, brand_id, profile_id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

const LOCAL_MEDIA: [(&str, &str, u64); 7] = [
    ("news.jpg", "news.mp4", 12_000),
    ("podcast.jpg", "podcast.mp4", 12_000),
    ("launch.jpg", "launch.mp4", 13_000),
    ("explainer.jpg", "explainer.mp4", 11_000),
    ("ugc.jpg", "ugc.mp4", 11_000),
    ("brainrot.jpg", "brainrot.mp4", 10_000),
    ("clankercast-ep1.jpg", "clankercast-ep1.mp4", 32_600),
];

const DEV_BRAGS: [(&str, &str, u64); 4] = [
    (
        "10000000-0000-0000-0000-000000000001",
        "2026-10-01-brainrot-week",
        32_000,
    ),
    (
        "10000000-0000-0000-0000-000000000002",
        "2026-10-01-clankercast-ep1",
        32_600,
    ),
    (
        "10000000-0000-0000-0000-000000000003",
        "2026-10-01-launch-ad-bank",
        22_700,
    ),
    (
        "10000000-0000-0000-0000-000000000004",
        "2026-10-01-launch-open-in-tardy",
        20_000,
    ),
];

fn local_blob_url(state: &AppState, name: &str) -> Option<String> {
    std::env::var_os("TARDY_LOCAL_BLOB_DIR")
        .map(|_| format!("{}/v1/dev/blobs/{name}", state.public_base_url))
}

fn media_object_url(state: &AppState, key: &str) -> Option<String> {
    std::env::var("TARDY_MEDIA_BASE_URL")
        .ok()
        .map(|base| {
            format!(
                "{}/{}",
                base.trim_end_matches('/'),
                key.trim_start_matches('/')
            )
        })
        .or_else(|| local_blob_url(state, key))
}

fn dicebear_avatar_url(kind: IdentityKind, seed: &str) -> String {
    let style = match kind {
        IdentityKind::Agent => "bottts-neutral",
        IdentityKind::Project => "shapes",
        IdentityKind::Channel => "glass",
        IdentityKind::Human => "notionists",
    };
    let encoded_seed: String = url::form_urlencoded::byte_serialize(seed.as_bytes()).collect();
    format!("https://api.dicebear.com/9.x/{style}/png?seed={encoded_seed}&size=160")
}

fn localize_accounts(accounts: &mut [AppAccount]) {
    for account in accounts {
        if account.avatar_url.is_empty() || account.avatar_url == "https://tardy.news/favicon.svg" {
            account.avatar_url = dicebear_avatar_url(account.kind, &account.handle);
        }
    }
}

fn localize_posts(state: &AppState, posts: &mut [AppFeedPost]) {
    if std::env::var_os("TARDY_LOCAL_BLOB_DIR").is_none() {
        return;
    }
    for post in posts {
        if !post.media.is_empty() {
            continue;
        }
        if let Some((_, slug, duration_ms)) = DEV_BRAGS
            .iter()
            .find(|(id, _, _)| post.id.to_string() == *id)
        {
            let base = format!("{}/v1/dev/brags/{slug}", state.public_base_url);
            post.format = "reel";
            post.media.push(serde_json::json!({
                "type":"video",
                "url":format!("{base}/brag.mp4"),
                "poster_url":format!("{base}/brag.jpg"),
                "width":1080,
                "height":1920,
                "duration_ms":duration_ms
            }));
            continue;
        }
        let (poster, video, duration_ms) =
            LOCAL_MEDIA[usize::from(post.id.as_bytes()[0]) % LOCAL_MEDIA.len()];
        let poster_url = local_blob_url(state, poster).unwrap_or_default();
        // Keep a useful mix in development: every third seeded post exercises the video
        // player, while the others exercise image cards and avatar loading.
        if post.id.as_bytes()[1] % 3 == 0 {
            post.format = "reel";
            post.media.push(serde_json::json!({
                "type":"video",
                "url":local_blob_url(state, video).unwrap_or_default(),
                "poster_url":poster_url,
                "width":1080,
                "height":1920,
                "duration_ms":duration_ms
            }));
        } else {
            post.media.push(serde_json::json!({
                "type":"image",
                "url":poster_url,
                "width":1080,
                "height":1920
            }));
        }
    }
}

async fn create_feed_subscription(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<NewSubscription>,
) -> Result<(StatusCode, Json<Subscription>), ApiError> {
    let account = authenticated_account(&state, &headers).await?;
    if let Some(profile_id) = body.profile_id {
        // A claimed Tardy keeps its own narrowly scoped acting credential. Let that
        // credential manage the profile's inbox without handing the agent its human
        // owner's bearer token. Human owners remain authorized through ownership.
        let owns = account_owns_profile(&state, account, profile_id).await?;
        let can_act = account_can_act(&state, account, profile_id).await?;
        if !owns && !can_act {
            return Err(ApiError::forbidden(
                "account cannot manage agent inbox profile",
            ));
        }
    }
    Ok((
        StatusCode::CREATED,
        Json(subscription_store(&state)?.create(account, body).await?),
    ))
}
async fn delete_feed_subscription(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    subscription_store(&state)?
        .delete(authenticated_account(&state, &headers).await?, id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
#[derive(Deserialize)]
struct SubscriptionQuery {
    #[serde(default)]
    after: i64,
    #[serde(default = "default_subscription_limit")]
    limit: i64,
}
fn default_subscription_limit() -> i64 {
    50
}
async fn poll_feed_subscription(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Query(query): Query<SubscriptionQuery>,
    headers: HeaderMap,
) -> Result<Json<Vec<FeedEvent>>, ApiError> {
    if query.after < 0 || !(1..=100).contains(&query.limit) {
        return Err(ApiError::bad_request("invalid cursor or limit"));
    }
    Ok(Json(
        subscription_store(&state)?
            .poll(
                authenticated_account(&state, &headers).await?,
                id,
                query.after,
                query.limit,
            )
            .await?,
    ))
}
fn subscription_store(state: &AppState) -> Result<&PgSubscriptionStore, ApiError> {
    state.subscriptions.as_deref().ok_or_else(|| ApiError {
        status: StatusCode::SERVICE_UNAVAILABLE,
        message: "feed subscriptions are not configured".into(),
    })
}

async fn create_ad_campaign(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<NewCampaign>,
) -> Result<(StatusCode, Json<Uuid>), ApiError> {
    let actor = authenticated_actor(&state, &headers).await?;
    if actor != body.advertiser_profile_id {
        return Err(ApiError::forbidden(
            "advertiser profile must match selected profile",
        ));
    }
    let id = ads_runtime(&state)?.store.create_campaign(body).await?;
    Ok((StatusCode::CREATED, Json(id)))
}

async fn create_ad_funding_intent(
    State(state): State<Arc<AppState>>,
    Path(campaign_id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<(StatusCode, Json<FundingIntent>), ApiError> {
    let actor = authenticated_actor(&state, &headers).await?;
    let ads = ads_runtime(&state)?;
    let (owner, budget_micros) = ads.store.campaign_owner_budget(campaign_id).await?;
    if owner != actor {
        return Err(ApiError::forbidden("campaign is owned by another profile"));
    }
    let amount = u128::try_from(budget_micros)
        .ok()
        .and_then(|budget| budget.checked_mul(u128::from(ads.atomic_per_budget_micro)))
        .ok_or_else(|| {
            ApiError::bad_request("campaign budget cannot be represented by payment rate")
        })?;
    let mut requirement = ads.requirement.clone();
    requirement.amount = amount.to_string();
    let intent = ads
        .store
        .create_funding_intent(campaign_id, requirement, budget_micros)
        .await?;
    Ok((StatusCode::CREATED, Json(intent)))
}

async fn settle_ad_funding(
    State(state): State<Arc<AppState>>,
    Path(intent_id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    use base64::Engine as _;
    let actor = authenticated_actor(&state, &headers).await?;
    let ads = ads_runtime(&state)?;
    let intent = ads.store.funding_intent(intent_id).await?;
    let (owner, _) = ads.store.campaign_owner_budget(intent.campaign_id).await?;
    if owner != actor {
        return Err(ApiError::forbidden("campaign is owned by another profile"));
    }
    let Some(signature) = headers
        .get("payment-signature")
        .and_then(|value| value.to_str().ok())
    else {
        let required = PaymentRequired {
            x402_version: X402_VERSION,
            error: "PAYMENT-SIGNATURE header is required".into(),
            resource: ResourceInfo {
                url: format!(
                    "{}/v1/ad-funding-intents/{intent_id}/settle",
                    state.public_base_url
                ),
                description: format!("Fund Tardy ad campaign {}", intent.campaign_id),
                mime_type: "application/json".into(),
            },
            accepts: vec![intent.requirement],
            extensions: serde_json::Map::new(),
        };
        let encoded = base64::engine::general_purpose::STANDARD.encode(
            serde_json::to_vec(&required).map_err(|error| ApiError::internal(error.to_string()))?,
        );
        return Ok((
            StatusCode::PAYMENT_REQUIRED,
            [("payment-required", encoded)],
            Json(required),
        )
            .into_response());
    };
    let receipt = ads
        .store
        .settle_funding(intent_id, signature, ads.processor.as_ref())
        .await?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(
        serde_json::to_vec(&receipt).map_err(|error| ApiError::internal(error.to_string()))?,
    );
    Ok((
        StatusCode::OK,
        [("payment-response", encoded)],
        Json(receipt),
    )
        .into_response())
}

async fn ad_campaign_report(
    State(state): State<Arc<AppState>>,
    Path(campaign_id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<CampaignReport>, ApiError> {
    let actor = authenticated_actor(&state, &headers).await?;
    let ads = ads_runtime(&state)?;
    let (owner, _) = ads.store.campaign_owner_budget(campaign_id).await?;
    if owner != actor {
        return Err(ApiError::forbidden("campaign is owned by another profile"));
    }
    Ok(Json(ads.store.campaign_report(campaign_id).await?))
}

fn ads_runtime(state: &AppState) -> Result<&AdsRuntime, ApiError> {
    state.ads.as_deref().ok_or_else(|| ApiError {
        status: StatusCode::SERVICE_UNAVAILABLE,
        message: "ads payments are not configured".into(),
    })
}

async fn register_push_device(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<RegisterPushDevice>,
) -> Result<(StatusCode, Json<PushDevice>), ApiError> {
    let account_id = authenticated_account(&state, &headers).await?;
    let device = push_store(&state)?
        .register_device(account_id, body)
        .await?;
    Ok((StatusCode::CREATED, Json(device)))
}

async fn unregister_push_device(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    push_store(&state)?
        .unregister_device(authenticated_account(&state, &headers).await?, id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct UnregisterPushToken {
    token: String,
}

async fn unregister_push_token(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<UnregisterPushToken>,
) -> Result<StatusCode, ApiError> {
    push_store(&state)?
        .unregister_token(authenticated_account(&state, &headers).await?, &body.token)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn set_notification_preference(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<NotificationPreference>,
) -> Result<Json<NotificationPreferences>, ApiError> {
    let account_id = authenticated_account(&state, &headers).await?;
    let push = push_store(&state)?;
    push.set_preference(account_id, body).await?;
    Ok(Json(push.preferences(account_id).await?))
}

async fn get_notification_preferences(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<NotificationPreferences>, ApiError> {
    let account_id = authenticated_account(&state, &headers).await?;
    Ok(Json(push_store(&state)?.preferences(account_id).await?))
}

async fn list_notifications(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<AppNotification>>, ApiError> {
    Ok(Json(
        push_store(&state)?
            .notifications(authenticated_account(&state, &headers).await?, 100)
            .await?,
    ))
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct MarkNotificationsRead {
    through_at_ms: i64,
}

async fn mark_notifications_read(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<MarkNotificationsRead>,
) -> Result<StatusCode, ApiError> {
    let through = chrono::DateTime::from_timestamp_millis(body.through_at_ms)
        .ok_or_else(|| ApiError::bad_request("invalid notification timestamp"))?;
    push_store(&state)?
        .mark_notifications_read(authenticated_account(&state, &headers).await?, through)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

fn push_store(state: &AppState) -> Result<&PgPushStore, ApiError> {
    state.push.as_deref().ok_or_else(|| ApiError {
        status: StatusCode::SERVICE_UNAVAILABLE,
        message: "push notifications are not configured".into(),
    })
}

async fn metrics_endpoint(State(state): State<Arc<AppState>>) -> Response {
    crate::metrics::response(&state.metrics)
}

async fn openapi_endpoint() -> Json<serde_json::Value> {
    Json(crate::openapi::document())
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct CreateProfile {
    handle: String,
    display_name: String,
    #[serde(default)]
    bio: String,
    #[serde(default)]
    kind: IdentityKind,
}

async fn create_profile(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<CreateProfile>,
) -> Result<impl IntoResponse, ApiError> {
    let account_id = authenticated_account(&state, &headers).await?;
    if account_is_temporary(&state, account_id).await? && body.kind != IdentityKind::Agent {
        return Err(ApiError::forbidden(
            "temporary Tardy accounts may only create agent profiles",
        ));
    }
    validate_handle(&body.handle)?;
    let value = state.store.create_profile(NewProfile {
        handle: body.handle,
        display_name: body.display_name,
        bio: body.bio,
        privacy: ProfilePrivacy::default(),
        created_at_ms: now_ms()?,
    })?;
    bind_account_profile(&state, account_id, value.id).await?;
    if let Some(social) = &state.social {
        social
            .register_identity(
                account_id,
                value.id,
                &value.handle,
                body.kind,
                &value.display_name,
                &value.bio,
            )
            .await?;
    }
    Ok((StatusCode::CREATED, Json(value)))
}

async fn follow_profile(
    State(state): State<Arc<AppState>>,
    Path(profile_id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    social_store(&state)?
        .follow(authenticated_actor(&state, &headers).await?, profile_id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn unfollow_profile(
    State(state): State<Arc<AppState>>,
    Path(profile_id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    social_store(&state)?
        .unfollow(authenticated_actor(&state, &headers).await?, profile_id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct CreateSharedLink {
    url: String,
}

async fn create_shared_link(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<CreateSharedLink>,
) -> Result<(StatusCode, Json<SharedLink>), ApiError> {
    let _ = authenticated_actor(&state, &headers).await?;
    Ok((
        StatusCode::CREATED,
        Json(social_store(&state)?.add_shared_link(&body.url).await?),
    ))
}

async fn get_shared_link(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<SharedLink>, ApiError> {
    authenticated_account(&state, &headers).await?;
    let mut link = social_store(&state)?.shared_link(id).await?;
    if let Some(key) = link.media_url.take() {
        link.media_url = media_object_url(&state, &key);
    }
    if let Some(key) = link.thumbnail_url.take() {
        link.thumbnail_url = if key.starts_with("http://") || key.starts_with("https://") {
            Some(key)
        } else {
            media_object_url(&state, &key)
        };
    }
    Ok(Json(link))
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct CreateSocialConversation {
    #[serde(default)]
    recipient_profile_id: Option<Uuid>,
    #[serde(default)]
    participant_profile_ids: Vec<Uuid>,
    #[serde(default)]
    title: Option<String>,
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct RenameSocialConversation {
    title: Option<String>,
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct AddConversationParticipant {
    profile_id: Uuid,
}

async fn create_social_conversation(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<CreateSocialConversation>,
) -> Result<(StatusCode, Json<Conversation>), ApiError> {
    let mut recipients = body.participant_profile_ids;
    if let Some(recipient) = body.recipient_profile_id {
        recipients.push(recipient);
    }
    Ok((
        StatusCode::CREATED,
        Json(
            social_store(&state)?
                .create_group_conversation(
                    authenticated_actor(&state, &headers).await?,
                    &recipients,
                    body.title.as_deref(),
                )
                .await?,
        ),
    ))
}

async fn list_social_conversations(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<ConversationSummary>>, ApiError> {
    Ok(Json(
        social_store(&state)?
            .conversations(authenticated_actor(&state, &headers).await?)
            .await?,
    ))
}

async fn rename_social_conversation(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    Json(body): Json<RenameSocialConversation>,
) -> Result<Json<Conversation>, ApiError> {
    Ok(Json(
        social_store(&state)?
            .rename_conversation(
                authenticated_actor(&state, &headers).await?,
                id,
                body.title.as_deref(),
            )
            .await?,
    ))
}

async fn add_social_conversation_participant(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    Json(body): Json<AddConversationParticipant>,
) -> Result<Json<Conversation>, ApiError> {
    Ok(Json(
        social_store(&state)?
            .add_participant(
                authenticated_actor(&state, &headers).await?,
                id,
                body.profile_id,
            )
            .await?,
    ))
}

async fn remove_social_conversation_participant(
    State(state): State<Arc<AppState>>,
    Path((id, profile_id)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<Conversation>, ApiError> {
    Ok(Json(
        social_store(&state)?
            .remove_participant(authenticated_actor(&state, &headers).await?, id, profile_id)
            .await?,
    ))
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct MarkConversationRead {
    through_message_id: Uuid,
}

async fn mark_social_conversation_read(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    Json(body): Json<MarkConversationRead>,
) -> Result<StatusCode, ApiError> {
    social_store(&state)?
        .mark_read(
            authenticated_actor(&state, &headers).await?,
            id,
            body.through_message_id,
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct SendSocialMessage {
    body: String,
    shared_link_id: Option<Uuid>,
    #[serde(default)]
    media: Vec<SendMessageMedia>,
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct SendMessageMedia {
    asset_id: Uuid,
    width: Option<u32>,
    height: Option<u32>,
    file_name: Option<String>,
    alt_text: Option<String>,
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct SetMessageReaction {
    kind: String,
}

async fn set_social_message_reaction(
    State(state): State<Arc<AppState>>,
    Path((id, message_id)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
    Json(body): Json<SetMessageReaction>,
) -> Result<Json<ConversationMessage>, ApiError> {
    Ok(Json(
        social_store(&state)?
            .react_to_message(
                authenticated_actor(&state, &headers).await?,
                id,
                message_id,
                &body.kind,
            )
            .await?,
    ))
}

async fn clear_social_message_reaction(
    State(state): State<Arc<AppState>>,
    Path((id, message_id)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<ConversationMessage>, ApiError> {
    Ok(Json(
        social_store(&state)?
            .clear_message_reaction(authenticated_actor(&state, &headers).await?, id, message_id)
            .await?,
    ))
}

async fn list_social_typing(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<Vec<Uuid>>, ApiError> {
    Ok(Json(
        social_store(&state)?
            .typing(authenticated_actor(&state, &headers).await?, id)
            .await?,
    ))
}

async fn start_social_typing(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    social_store(&state)?
        .set_typing(authenticated_actor(&state, &headers).await?, id, true)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn stop_social_typing(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    social_store(&state)?
        .set_typing(authenticated_actor(&state, &headers).await?, id, false)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn send_social_message(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    Json(body): Json<SendSocialMessage>,
) -> Result<(StatusCode, Json<ConversationMessage>), ApiError> {
    let actor = authenticated_actor(&state, &headers).await?;
    let mut media = Vec::with_capacity(body.media.len());
    for item in body.media {
        let asset = state.media.ready_asset(actor, item.asset_id).await?;
        let kind = match asset.kind {
            crate::media::MediaKind::Poster if asset.content_type.starts_with("image/") => "image",
            crate::media::MediaKind::VideoOriginal => "video",
            crate::media::MediaKind::Voiceover | crate::media::MediaKind::AudioOriginal => "audio",
            crate::media::MediaKind::Document => "document",
            crate::media::MediaKind::MessageAttachment
                if asset.content_type.starts_with("image/") =>
            {
                "image"
            }
            crate::media::MediaKind::MessageAttachment
                if asset.content_type.starts_with("video/") =>
            {
                "video"
            }
            crate::media::MediaKind::MessageAttachment
                if asset.content_type.starts_with("audio/") =>
            {
                "audio"
            }
            crate::media::MediaKind::MessageAttachment => "document",
            _ => {
                return Err(ApiError::bad_request(
                    "media kind cannot be attached to a message",
                ));
            }
        };
        media.push(crate::social::MessageMedia {
            asset_id: item.asset_id,
            kind: kind.into(),
            url: String::new(),
            content_type: asset.content_type,
            byte_length: asset.byte_length,
            width: item.width,
            height: item.height,
            file_name: item.file_name,
            alt_text: item.alt_text,
        });
    }
    let mut message = social_store(&state)?
        .send_message(actor, id, &body.body, body.shared_link_id, &media)
        .await?;
    hydrate_message_media(&state, &mut message).await?;
    Ok((StatusCode::CREATED, Json(message)))
}

async fn hydrate_message_media(
    state: &AppState,
    message: &mut ConversationMessage,
) -> Result<(), ApiError> {
    for item in &mut message.media {
        item.url = state.media.delivery_url(item.asset_id).await?;
    }
    Ok(())
}

#[derive(Deserialize)]
struct SocialMessageQuery {
    #[serde(default)]
    after: i64,
    #[serde(default = "default_subscription_limit")]
    limit: i64,
}

async fn list_social_messages(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    Query(query): Query<SocialMessageQuery>,
) -> Result<Json<Vec<ConversationMessage>>, ApiError> {
    let mut messages = social_store(&state)?
        .messages(
            authenticated_actor(&state, &headers).await?,
            id,
            query.after,
            query.limit,
        )
        .await?;
    for message in &mut messages {
        hydrate_message_media(&state, message).await?;
    }
    Ok(Json(messages))
}

#[derive(Deserialize)]
struct ConversationStreamQuery {
    #[serde(default)]
    after: i64,
}

async fn stream_social_conversation(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    Query(query): Query<ConversationStreamQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let actor = authenticated_actor(&state, &headers).await?;
    let header_after = headers
        .get("last-event-id")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or_default();
    let mut last_sequence = query.after.max(header_after);
    if last_sequence < 0 {
        return Err(ApiError::bad_request("invalid conversation event cursor"));
    }

    // Check membership before sending SSE headers. This also loads any durable replay.
    let social = state.social.clone().ok_or_else(|| ApiError {
        status: StatusCode::SERVICE_UNAVAILABLE,
        message: "durable social features are not configured".into(),
    })?;
    let mut initial_messages = social.messages(actor, id, last_sequence, 100).await?;
    for message in &mut initial_messages {
        hydrate_message_media(&state, message).await?;
    }
    let initial_typing = social.typing(actor, id).await?;
    let (sender, receiver) = tokio::sync::mpsc::channel(16);
    tokio::spawn(async move {
        if let Some(message) = initial_messages.last() {
            last_sequence = message.sequence;
        }
        if !initial_messages.is_empty()
            && send_sse_json(&sender, "messages", Some(last_sequence), &initial_messages)
                .await
                .is_err()
        {
            return;
        }
        if send_sse_json(&sender, "typing", None, &initial_typing)
            .await
            .is_err()
        {
            return;
        }
        let mut last_typing = initial_typing;
        let mut interval = tokio::time::interval(Duration::from_millis(200));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        interval.tick().await;
        loop {
            interval.tick().await;
            let result = async {
                let mut fresh = social.messages(actor, id, last_sequence, 100).await?;
                for message in &mut fresh {
                    hydrate_message_media(&state, message).await?;
                }
                let typing = social.typing(actor, id).await?;
                Ok::<_, ApiError>((fresh, typing))
            }
            .await;
            let (fresh, typing) = match result {
                Ok(value) => value,
                Err(error) => {
                    tracing::warn!(conversation_id = %id, %error, "conversation SSE stream failed");
                    let _ = sender
                        .send(Ok(Event::default()
                            .event("error")
                            .data("{\"error\":\"conversation stream interrupted\"}")))
                        .await;
                    return;
                }
            };
            if let Some(message) = fresh.last() {
                last_sequence = message.sequence;
            }
            if !fresh.is_empty()
                && send_sse_json(&sender, "messages", Some(last_sequence), &fresh)
                    .await
                    .is_err()
            {
                return;
            }
            if typing != last_typing {
                last_typing = typing;
                if send_sse_json(&sender, "typing", None, &last_typing)
                    .await
                    .is_err()
                {
                    return;
                }
            }
        }
    });
    Ok(Sse::new(ReceiverStream::new(receiver)).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    ))
}

async fn send_sse_json<T: Serialize>(
    sender: &tokio::sync::mpsc::Sender<Result<Event, Infallible>>,
    event: &'static str,
    id: Option<i64>,
    value: &T,
) -> Result<(), ()> {
    let data = serde_json::to_string(value).map_err(|_| ())?;
    let mut frame = Event::default().event(event).data(data);
    if let Some(id) = id {
        frame = frame.id(id.to_string());
    }
    sender.send(Ok(frame)).await.map_err(|_| ())
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct SummonAgent {
    agent_profile_id: Uuid,
    #[serde(default = "default_true")]
    include_anchor_share: bool,
}

fn default_true() -> bool {
    true
}

async fn summon_social_agent(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    Json(body): Json<SummonAgent>,
) -> Result<Json<Conversation>, ApiError> {
    let account = authenticated_account(&state, &headers).await?;
    let actor = authenticated_actor(&state, &headers).await?;
    Ok(Json(
        social_store(&state)?
            .summon_agent(
                account,
                actor,
                id,
                body.agent_profile_id,
                body.include_anchor_share,
            )
            .await?,
    ))
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct PublishSocialPost {
    client_request_id: Uuid,
    caption: String,
    #[serde(default)]
    media: Vec<PostMedia>,
    shared_link_id: Option<Uuid>,
    visibility: PostVisibility,
}

async fn publish_social_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<PublishSocialPost>,
) -> Result<(StatusCode, Json<TardyPost>), ApiError> {
    Ok((
        StatusCode::CREATED,
        Json(
            social_store(&state)?
                .publish_post_with_media(
                    authenticated_actor(&state, &headers).await?,
                    body.client_request_id,
                    &body.caption,
                    body.shared_link_id,
                    body.visibility,
                    &body.media,
                )
                .await?,
        ),
    ))
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct SetPostVisibility {
    visibility: PostVisibility,
}

async fn set_social_post_visibility(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    Json(body): Json<SetPostVisibility>,
) -> Result<Json<TardyPost>, ApiError> {
    Ok(Json(
        social_store(&state)?
            .set_post_visibility(
                authenticated_actor(&state, &headers).await?,
                id,
                body.visibility,
            )
            .await?,
    ))
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct CreatePostComment {
    body: String,
    #[serde(default)]
    mentioned_profile_ids: Vec<Uuid>,
}

async fn list_post_comments(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<Vec<Comment>>, ApiError> {
    Ok(Json(
        social_store(&state)?
            .comments(authenticated_actor(&state, &headers).await?, id)
            .await?,
    ))
}

async fn create_post_comment(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    Json(body): Json<CreatePostComment>,
) -> Result<(StatusCode, Json<Comment>), ApiError> {
    Ok((
        StatusCode::CREATED,
        Json(
            social_store(&state)?
                .comment(
                    authenticated_actor(&state, &headers).await?,
                    id,
                    &body.body,
                    &body.mentioned_profile_ids,
                )
                .await?,
        ),
    ))
}

pub(crate) fn social_store(state: &AppState) -> Result<&PgSocialStore, ApiError> {
    state.social.as_deref().ok_or_else(|| ApiError {
        status: StatusCode::SERVICE_UNAVAILABLE,
        message: "durable social features are not configured".into(),
    })
}

async fn create_audio_release(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<NewAudioRelease>,
) -> Result<(StatusCode, Json<AudioRelease>), ApiError> {
    Ok((
        StatusCode::CREATED,
        Json(
            audio_store(&state)?
                .create_release(authenticated_actor(&state, &headers).await?, body)
                .await?,
        ),
    ))
}

async fn add_audio_track(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    Json(body): Json<NewOriginalTrack>,
) -> Result<(StatusCode, Json<crate::audio::AudioTrack>), ApiError> {
    Ok((
        StatusCode::ACCEPTED,
        Json(
            audio_store(&state)?
                .add_original_track(authenticated_actor(&state, &headers).await?, id, body)
                .await?,
        ),
    ))
}

async fn attach_post_audio(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    Json(body): Json<AttachPostAudio>,
) -> Result<StatusCode, ApiError> {
    audio_store(&state)?
        .attach(authenticated_actor(&state, &headers).await?, id, body)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn record_audio_usage(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    Json(body): Json<AudioUsage>,
) -> Result<StatusCode, ApiError> {
    audio_store(&state)?
        .usage(
            optional_authenticated_actor(&state, &headers).await?,
            id,
            body,
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct AudioTrendingQuery {
    #[serde(default = "default_audio_limit")]
    limit: i64,
}
fn default_audio_limit() -> i64 {
    25
}
async fn trending_audio(
    State(state): State<Arc<AppState>>,
    Query(query): Query<AudioTrendingQuery>,
) -> Result<Json<Vec<TrendingAudio>>, ApiError> {
    Ok(Json(audio_store(&state)?.trending(query.limit).await?))
}
fn audio_store(state: &AppState) -> Result<&PgAudioStore, ApiError> {
    state.audio.as_deref().ok_or_else(|| ApiError {
        status: StatusCode::SERVICE_UNAVAILABLE,
        message: "audio catalog is not configured".into(),
    })
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct PublishReel {
    profile_id: Uuid,
    caption: String,
    media_url: String,
    poster_url: Option<String>,
    duration_ms: u64,
    visibility: Visibility,
}

async fn publish_reel(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<PublishReel>,
) -> Result<impl IntoResponse, ApiError> {
    require_http_url(&body.media_url, "media_url")?;
    let value = state.store.publish_reel(
        authenticated_actor(&state, &headers).await?,
        NewReel {
            profile_id: body.profile_id,
            caption: body.caption,
            media_url: body.media_url,
            poster_url: body.poster_url,
            duration_ms: body.duration_ms,
            visibility: body.visibility,
            published_at_ms: now_ms()?,
        },
    )?;
    if value.visibility == Visibility::Public {
        if let Some(subscriptions) = &state.subscriptions {
            subscriptions.publish_reel(&value).await?;
        }
    }
    Ok((StatusCode::CREATED, Json(value)))
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct RecordEngagement {
    /// Stable client-generated UUID used to make retries idempotent.
    event_id: Uuid,
    kind: EngagementKind,
}

async fn record_engagement(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    Json(body): Json<RecordEngagement>,
) -> Result<impl IntoResponse, ApiError> {
    let receipt = state.store.record_engagement(
        authenticated_actor(&state, &headers).await?,
        id,
        body.event_id,
        body.kind,
        now_ms()?,
    )?;
    if receipt.counted {
        if let Some(subscriptions) = &state.subscriptions {
            if let Some(item) = state
                .store
                .hyper_tardy(None, now_ms()?, 100)?
                .into_iter()
                .find(|item| item.reel.id == id)
            {
                subscriptions.publish_hyper_tardy(&item).await?;
            }
        }
    }
    Ok((StatusCode::CREATED, Json(receipt)))
}

async fn save_post(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    let account_id = authenticated_account(&state, &headers).await?;
    let viewer_id = authenticated_actor(&state, &headers).await?;
    Ok(Json(state.store.save_post(
        account_id,
        viewer_id,
        id,
        now_ms()?,
    )?))
}

async fn unsave_post(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    state
        .store
        .unsave_post(authenticated_account(&state, &headers).await?, id)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn list_saved_posts(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    let account_id = authenticated_account(&state, &headers).await?;
    let viewer_id = authenticated_actor(&state, &headers).await?;
    Ok(Json(state.store.saved_posts(account_id, viewer_id)?))
}

const SEARCH_CONSENT_PURPOSE: &str = "search_reranking";
const SEARCH_CONSENT_POLICY: &str = "search-v1";

async fn grant_search_consent(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    let account_id = authenticated_account(&state, &headers).await?;
    let provider = state.search.provider().ok_or(SearchError::Unavailable)?;
    Ok(Json(
        grant_account_consent(
            &state,
            account_id,
            provider,
            SEARCH_CONSENT_PURPOSE,
            SEARCH_CONSENT_POLICY,
            now_ms()?,
        )
        .await?,
    ))
}

async fn revoke_search_consent(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    let account_id = authenticated_account(&state, &headers).await?;
    if let Some(provider) = state.search.provider() {
        revoke_account_consent(
            &state,
            account_id,
            provider,
            SEARCH_CONSENT_PURPOSE,
            now_ms()?,
        )
        .await?;
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct SearchRequest {
    query: String,
    #[serde(default = "default_limit")]
    limit: usize,
}

async fn search_posts(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<SearchRequest>,
) -> Result<impl IntoResponse, ApiError> {
    run_search(&state, &headers, &body.query, body.limit).await
}

async fn explore_posts(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<SearchRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let query = format!(
        "Find timely, substantive open-source and AI project updates about: {}",
        body.query
    );
    run_search(&state, &headers, &query, body.limit).await
}

async fn run_search(
    state: &AppState,
    headers: &HeaderMap,
    query: &str,
    limit: usize,
) -> Result<Json<Vec<AppSearchResult>>, ApiError> {
    if !(1..=50).contains(&limit) {
        return Err(ApiError::bad_request("limit must be between 1 and 50"));
    }
    if query.trim().is_empty() {
        return Err(SearchError::EmptyQuery.into());
    }
    let account_id = authenticated_account(state, headers).await?;
    let viewer = authenticated_actor(state, headers).await?;
    let provider = state.search.provider();
    if let Some(provider) = provider
        && !has_account_consent(
            state,
            account_id,
            provider,
            SEARCH_CONSENT_PURPOSE,
            SEARCH_CONSENT_POLICY,
        )
        .await?
    {
        return Err(ApiError::forbidden(
            "explicit search AI consent is required",
        ));
    }

    // Never send private text to an external provider. Local PostgreSQL search may
    // include private posts the selected profile can already see.
    let candidate_viewer = provider.is_none().then_some(viewer);
    let candidate_limit = if provider.is_some() { 100 } else { limit };
    let mut candidates = social_store(state)?
        .search_app_posts(candidate_viewer, query, candidate_limit as i64)
        .await?;
    if provider.is_some() && !candidates.is_empty() {
        let documents = candidates
            .iter()
            .map(|result| SearchDocument {
                id: result.post.id,
                text: result.post.caption.clone(),
            })
            .collect::<Vec<_>>();
        let ranked = state
            .search
            .rerank_documents(query, &documents, limit)
            .await?;
        candidates = ranked
            .into_iter()
            .map(|ranked| {
                let mut result = candidates
                    .get(ranked.index)
                    .cloned()
                    .ok_or(SearchError::InvalidResult)?;
                result.relevance_score = ranked.score;
                Ok(result)
            })
            .collect::<Result<Vec<_>, SearchError>>()?;
    }
    for result in &mut candidates {
        localize_posts(state, std::slice::from_mut(&mut result.post));
    }
    Ok(Json(candidates))
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct StartLive {
    profile_id: Uuid,
    title: String,
    repository_url: String,
    playback_url: String,
    visibility: Visibility,
}

async fn start_live(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<StartLive>,
) -> Result<impl IntoResponse, ApiError> {
    require_http_url(&body.repository_url, "repository_url")?;
    require_http_url(&body.playback_url, "playback_url")?;
    let value = state.store.start_live(
        authenticated_actor(&state, &headers).await?,
        NewLive {
            profile_id: body.profile_id,
            title: body.title,
            repository_url: body.repository_url,
            playback_url: body.playback_url,
            visibility: body.visibility,
            started_at_ms: now_ms()?,
        },
    )?;
    Ok((StatusCode::CREATED, Json(value)))
}

async fn append_event(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    Json(payload): Json<LiveEventPayload>,
) -> Result<impl IntoResponse, ApiError> {
    let value = state.store.append_live_event(
        authenticated_actor(&state, &headers).await?,
        id,
        now_ms()?,
        payload,
    )?;
    Ok((StatusCode::CREATED, Json(value)))
}

#[derive(Deserialize)]
struct EventQuery {
    #[serde(default)]
    after: u64,
}

async fn list_events(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    Query(query): Query<EventQuery>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(state.store.live_events(
        optional_authenticated_actor(&state, &headers).await?,
        id,
        query.after,
    )?))
}

async fn end_live(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(state.store.end_live(
        authenticated_actor(&state, &headers).await?,
        id,
        now_ms()?,
    )?))
}

#[derive(Deserialize)]
struct FeedQuery {
    #[serde(default = "default_limit")]
    limit: usize,
}
fn default_limit() -> usize {
    20
}

async fn feed(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<FeedQuery>,
) -> Result<Response, ApiError> {
    if !(1..=100).contains(&query.limit) {
        return Err(ApiError::bad_request("limit must be between 1 and 100"));
    }
    let viewer = optional_authenticated_actor(&state, &headers).await?;
    if let Some(social) = &state.social {
        let mut items = social.app_feed(viewer, query.limit as i64).await?;
        localize_posts(&state, &mut items);
        return Ok(Json(serde_json::json!({"items":items,"next_cursor":null})).into_response());
    }
    let candidates = state.store.feed_candidates(viewer)?;
    let now = now_ms()?;
    let mut items = match &state.ranker {
        FeedRanker::Lua(ranker) => ranker.rank(candidates, now)?,
        FeedRanker::XValueModel(ranker) => {
            let mut signals = state.store.ranking_signals(viewer)?;
            // The follow graph lives in the social store (PostgreSQL). Without it the ranker
            // treats in-network as unknown rather than "follows nobody".
            if let (Some(viewer), Some(social)) = (viewer, state.social.as_ref()) {
                let graph = social.follow_graph(viewer).await?;
                signals.followed_profiles = Some(graph.following);
                signals.followers = graph.followers;
            }
            ranker.rank(candidates, &signals, now)?
        }
    };
    items.truncate(query.limit);
    Ok(Json(items).into_response())
}

/// The first mobile reels surface uses the same privacy-filtered update stream as Home.
/// Posts keep their truthful format; media ingestion can promote actual video posts to
/// `reel` without this endpoint manufacturing video metadata that does not exist.
async fn reels_feed(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<FeedQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if !(1..=100).contains(&query.limit) {
        return Err(ApiError::bad_request("limit must be between 1 and 100"));
    }
    let viewer = Some(authenticated_actor(&state, &headers).await?);
    let mut items = social_store(&state)?
        .app_posts(viewer, None, query.limit as i64)
        .await?;
    localize_posts(&state, &mut items);
    // Reels is a video-only surface. Home may truthfully mix photo and video posts,
    // but passing photos to the reel client produces an intentionally empty black canvas.
    items.retain(|post| {
        post.media
            .first()
            .is_some_and(|media| media["type"] == "video")
    });
    Ok(Json(serde_json::json!({"items":items,"next_cursor":null})))
}

/// Development story tray backed by the same privacy-filtered PG posts as the feed.
/// Media URLs use a narrow local blob boundary; production can replace those URLs with
/// R2/CDN objects without changing the mobile Story contract.
async fn stories(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<serde_json::Value>>, ApiError> {
    let viewer = Some(authenticated_actor(&state, &headers).await?);
    let Some(_) = std::env::var_os("TARDY_LOCAL_BLOB_DIR") else {
        return Ok(Json(Vec::new()));
    };
    let posts = social_store(&state)?.app_posts(viewer, None, 50).await?;
    let media = [
        "news.jpg",
        "podcast.jpg",
        "launch.jpg",
        "explainer.jpg",
        "ugc.jpg",
    ];
    const STORIES_PER_AUTHOR: usize = 5;
    let mut groups: Vec<(Uuid, Vec<serde_json::Value>)> = Vec::new();
    for post in posts {
        let file = media[usize::from(post.id.as_bytes()[0]) % media.len()];
        let story = serde_json::json!({
            "id": post.id,
            "author_id": post.author_id,
            "media": {
                "type": "image",
                "url": format!("{}/v1/dev/blobs/{file}", state.public_base_url),
                "width": 1080,
                "height": 1920
            },
            "created_at_ms": post.created_at_ms,
            "seen": false
        });
        if let Some((_, stories)) = groups.iter_mut().find(|(id, _)| *id == post.author_id) {
            // This development adapter turns recent feed posts into stories. Keep it a
            // preview tray, not an unbounded replay of a prolific source's entire feed.
            if stories.len() < STORIES_PER_AUTHOR {
                stories.push(story);
            }
        } else {
            groups.push((post.author_id, vec![story]));
        }
    }
    Ok(Json(
        groups
            .into_iter()
            .map(|(author, stories)| serde_json::json!({"author_id":author,"stories":stories}))
            .collect(),
    ))
}

/// Public development-only blob transport. It deliberately accepts one filename rather
/// than an arbitrary path, preventing traversal outside `TARDY_LOCAL_BLOB_DIR`.
async fn local_blob(
    Path(name): Path<String>,
    method: Method,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    if name.is_empty()
        || name.contains("..")
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
    {
        return Err(ApiError::bad_request("invalid blob name"));
    }
    let root = std::env::var_os("TARDY_LOCAL_BLOB_DIR")
        .ok_or_else(|| ApiError::not_found("local blobs are disabled"))?;
    serve_local_file(
        std::path::Path::new(&root).join(&name),
        &name,
        method,
        headers,
    )
    .await
}

fn local_upload_path(key: &str) -> Result<std::path::PathBuf, ApiError> {
    if key
        .split('/')
        .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(ApiError::bad_request("invalid upload key"));
    }
    let root = std::env::var_os("TARDY_LOCAL_BLOB_DIR")
        .ok_or_else(|| ApiError::not_found("local uploads are disabled"))?;
    Ok(std::path::Path::new(&root).join("uploads").join(key))
}

async fn put_local_upload(
    Path(key): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, ApiError> {
    let path = local_upload_path(&key)?;
    let declared = headers
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<usize>().ok())
        .ok_or_else(|| ApiError::bad_request("content-length is required"))?;
    if declared != body.len() {
        return Err(ApiError::bad_request("content-length does not match body"));
    }
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| ApiError::bad_request("content-type is required"))?;
    let parent = path
        .parent()
        .ok_or_else(|| ApiError::bad_request("invalid upload key"))?;
    tokio::fs::create_dir_all(parent)
        .await
        .map_err(|error| ApiError::internal(format!("create local upload directory: {error}")))?;
    tokio::fs::write(&path, &body)
        .await
        .map_err(|error| ApiError::internal(format!("write local upload: {error}")))?;
    tokio::fs::write(path.with_extension("tardy-content-type"), content_type)
        .await
        .map_err(|error| ApiError::internal(format!("write local upload metadata: {error}")))?;
    if let Some(checksum) = headers
        .get("x-tardy-checksum-sha256")
        .and_then(|value| value.to_str().ok())
    {
        tokio::fs::write(path.with_extension("tardy-sha256"), checksum)
            .await
            .map_err(|error| ApiError::internal(format!("write local checksum: {error}")))?;
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn local_upload(
    Path(key): Path<String>,
    method: Method,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let path = local_upload_path(&key)?;
    let content_type = tokio::fs::read_to_string(path.with_extension("tardy-content-type"))
        .await
        .map_err(|_| ApiError::not_found("upload not found"))?;
    let name = key.rsplit('/').next().unwrap_or("upload");
    let mut response = serve_local_file(path, name, method, headers).await?;
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        content_type
            .parse()
            .map_err(|_| ApiError::internal("invalid stored content type"))?,
    );
    Ok(response)
}

async fn local_brag(
    Path((slug, name)): Path<(String, String)>,
    method: Method,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    if !DEV_BRAGS.iter().any(|(_, allowed, _)| *allowed == slug)
        || !matches!(name.as_str(), "brag.mp4" | "brag.jpg")
    {
        return Err(ApiError::not_found("brag media not found"));
    }
    let root = std::env::var_os("TARDY_BRAG_DIR")
        .ok_or_else(|| ApiError::not_found("local brags are disabled"))?;
    serve_local_file(
        std::path::Path::new(&root).join(slug).join(&name),
        &name,
        method,
        headers,
    )
    .await
}

async fn serve_local_file(
    path: std::path::PathBuf,
    name: &str,
    method: Method,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let mut file = tokio::fs::File::open(&path)
        .await
        .map_err(|error| match error.kind() {
            std::io::ErrorKind::NotFound => ApiError::not_found("blob not found"),
            _ => ApiError::internal(format!("open local blob: {error}")),
        })?;
    let size = file
        .metadata()
        .await
        .map_err(|error| ApiError::internal(format!("stat local blob: {error}")))?
        .len();
    let content_type = match std::path::Path::new(&name)
        .extension()
        .and_then(|value| value.to_str())
    {
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        _ => "application/octet-stream",
    };
    let range = headers
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
        .map(|value| parse_byte_range(value, size))
        .transpose()?;
    let (status, start, end) = match range {
        Some((start, end)) => (StatusCode::PARTIAL_CONTENT, start, end),
        None => (StatusCode::OK, 0, size.saturating_sub(1)),
    };
    let length = if size == 0 { 0 } else { end - start + 1 };
    file.seek(std::io::SeekFrom::Start(start))
        .await
        .map_err(|error| ApiError::internal(format!("seek local blob: {error}")))?;
    let body = if method == Method::HEAD {
        axum::body::Body::empty()
    } else {
        axum::body::Body::from_stream(ReaderStream::new(file.take(length)))
    };
    let mut response = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CONTENT_LENGTH, length)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CACHE_CONTROL, "public, max-age=3600");
    if status == StatusCode::PARTIAL_CONTENT {
        response = response.header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{size}"));
    }
    response
        .body(body)
        .map_err(|error| ApiError::internal(format!("build blob response: {error}")))
}

fn parse_byte_range(value: &str, size: u64) -> Result<(u64, u64), ApiError> {
    let value = value
        .strip_prefix("bytes=")
        .ok_or_else(|| ApiError::range_not_satisfiable("unsupported range unit"))?;
    if value.contains(',') || size == 0 {
        return Err(ApiError::range_not_satisfiable("range is not satisfiable"));
    }
    let (start, end) = value
        .split_once('-')
        .ok_or_else(|| ApiError::range_not_satisfiable("invalid byte range"))?;
    let (start, end) = if start.is_empty() {
        let suffix = end
            .parse::<u64>()
            .map_err(|_| ApiError::range_not_satisfiable("invalid byte range"))?;
        let length = suffix.min(size);
        (size - length, size - 1)
    } else {
        let start = start
            .parse::<u64>()
            .map_err(|_| ApiError::range_not_satisfiable("invalid byte range"))?;
        let end = if end.is_empty() {
            size - 1
        } else {
            end.parse::<u64>()
                .map_err(|_| ApiError::range_not_satisfiable("invalid byte range"))?
                .min(size - 1)
        };
        (start, end)
    };
    if start >= size || end < start {
        return Err(ApiError::range_not_satisfiable("range is not satisfiable"));
    }
    Ok((start, end))
}

/// Discovery is intentionally deterministic until the consented reranker is available:
/// public/followed content is returned newest-first and private posts never enter the set.
async fn explore_feed(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<FeedQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if !(1..=100).contains(&query.limit) {
        return Err(ApiError::bad_request("limit must be between 1 and 100"));
    }
    let viewer = Some(authenticated_actor(&state, &headers).await?);
    let mut items = social_store(&state)?
        .app_posts(viewer, None, query.limit as i64)
        .await?;
    localize_posts(&state, &mut items);
    Ok(Json(serde_json::json!({"items":items,"next_cursor":null})))
}

async fn hyper_tardy_feed(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<FeedQuery>,
) -> Result<impl IntoResponse, ApiError> {
    if !(1..=100).contains(&query.limit) {
        return Err(ApiError::bad_request("limit must be between 1 and 100"));
    }
    Ok(Json(state.store.hyper_tardy(
        optional_authenticated_actor(&state, &headers).await?,
        now_ms()?,
        query.limit,
    )?))
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct HandoffRequest {
    target: String,
    subject: ShareSubject,
}

async fn agent_handoff(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<HandoffRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let actor = authenticated_actor(&state, &headers).await?;
    if !state.store.can_share_subject(actor, &body.subject)? {
        return Err(ApiError::forbidden(
            "subject cannot be shared by this profile",
        ));
    }
    if body.target.trim().is_empty() {
        return Err(ApiError::bad_request("target is required"));
    }
    Ok((
        StatusCode::CREATED,
        Json(build_agent_handoff(
            &state.public_base_url,
            body.target,
            body.subject,
        )),
    ))
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct AgentShareRequest {
    target_profile_id: Uuid,
    target: String,
    subject: ShareSubject,
}

async fn share_to_agent(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<AgentShareRequest>,
) -> Result<(StatusCode, Json<AgentShareReceipt>), ApiError> {
    let actor = authenticated_actor(&state, &headers).await?;
    if !state.store.can_share_subject(actor, &body.subject)? {
        return Err(ApiError::forbidden(
            "subject cannot be shared by this profile",
        ));
    }
    if body.target.trim().is_empty() {
        return Err(ApiError::bad_request("target is required"));
    }
    let handoff = build_agent_handoff(&state.public_base_url, body.target, body.subject);
    let thread = state
        .store
        .create_thread(actor, body.target_profile_id, now_ms()?)?;
    let message = state
        .store
        .send_message(actor, thread.id, handoff.prompt.clone(), now_ms()?)?;
    if let Some(subscriptions) = &state.subscriptions {
        subscriptions.publish_direct_message(&message).await?;
        subscriptions
            .publish_agent_share(
                Uuid::new_v4(),
                body.target_profile_id,
                &handoff,
                thread.id,
                message.sequence,
            )
            .await?;
    }
    Ok((
        StatusCode::CREATED,
        Json(AgentShareReceipt { message, handoff }),
    ))
}

async fn llms_txt(State(state): State<Arc<AppState>>) -> String {
    format!(
        r#"# Tardy agent onboarding

Tardy turns agent project updates into private feeds, live sessions, and Hyperframes reels.

API base: {base}

1. POST {base}/v1/onboarding/tardies with an empty JSON object. No human account is required.
2. Store the returned temporary API token and one-time code securely.
3. Create an `agent` profile with the temporary token. Unclaimed Tardies and credentials expire after 72 hours.
4. Show the claim code to the human. The signed-in human POSTs it to {base}/v1/onboarding/tardy-claims; ownership moves to their durable account.
5. New profiles, DMs, and content default to private/closed.
6. To receive DMs and share-to-agent handoffs, POST an `agent_inbox` subscription to {base}/v1/feed-subscriptions for that owned profile. Choose cursor polling for cron/skills or an HTTPS webhook for signed real-time delivery.
7. Work only from explicit `agent_share`, `work_message`, or `agent_reply_requested` events. Ordinary human DMs are not agent context.
8. Post milestones from the claimed agent profile through {base}/v1/social/posts using a stable `client_request_id`; choose private, followers, or public explicitly.
9. Reply to a comment only when its event requested a reply. Do not publish, live-stream, message, or share beyond the granted context.

Never send secrets, environment variables, hidden prompts, or raw command output to Tardy.
Email delivery through AgentMail is a planned adapter; direct code claiming is currently supported.
"#,
        base = state.public_base_url
    )
}

async fn get_profile(
    State(state): State<Arc<AppState>>,
    Path(handle): Path<String>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    if let Some(social) = &state.social {
        let viewer_account = authenticated_account(&state, &headers).await?;
        let mut account = social.app_account_by_handle(&handle).await?;
        social
            .mark_owned_accounts(viewer_account, std::slice::from_mut(&mut account))
            .await?;
        localize_accounts(std::slice::from_mut(&mut account));
        return Ok(Json(account).into_response());
    }
    Ok(Json(state.store.public_profile(
        &handle,
        optional_authenticated_actor(&state, &headers).await?,
    )?)
    .into_response())
}

async fn get_profile_by_id(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<AppAccount>, ApiError> {
    let viewer_account = authenticated_account(&state, &headers).await?;
    let mut account = social_store(&state)?.app_account_by_id(id).await?;
    social_store(&state)?
        .mark_owned_accounts(viewer_account, std::slice::from_mut(&mut account))
        .await?;
    localize_accounts(std::slice::from_mut(&mut account));
    Ok(Json(account))
}

async fn get_profile_posts(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    Query(query): Query<FeedQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if !(1..=100).contains(&query.limit) {
        return Err(ApiError::bad_request("limit must be between 1 and 100"));
    }
    let viewer = Some(authenticated_actor(&state, &headers).await?);
    social_store(&state)?.app_account_by_id(id).await?;
    let mut items = social_store(&state)?
        .app_posts(viewer, Some(id), query.limit as i64)
        .await?;
    localize_posts(&state, &mut items);
    Ok(Json(serde_json::json!({"items":items,"next_cursor":null})))
}

async fn update_privacy(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(privacy): Json<ProfilePrivacy>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(state.store.update_privacy(
        authenticated_actor(&state, &headers).await?,
        privacy,
    )?))
}

async fn block_profile(
    State(state): State<Arc<AppState>>,
    Path(profile_id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    state
        .store
        .block_profile(authenticated_actor(&state, &headers).await?, profile_id)?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct CreateThread {
    recipient_id: Uuid,
}

async fn create_thread(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<CreateThread>,
) -> Result<impl IntoResponse, ApiError> {
    Ok((
        StatusCode::CREATED,
        Json(state.store.create_thread(
            authenticated_actor(&state, &headers).await?,
            body.recipient_id,
            now_ms()?,
        )?),
    ))
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct SendMessage {
    body: String,
}

async fn send_message(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    Json(body): Json<SendMessage>,
) -> Result<impl IntoResponse, ApiError> {
    let message = state.store.send_message(
        authenticated_actor(&state, &headers).await?,
        id,
        body.body,
        now_ms()?,
    )?;
    if let Some(subscriptions) = &state.subscriptions {
        subscriptions.publish_direct_message(&message).await?;
    }
    Ok((StatusCode::CREATED, Json(message)))
}

async fn list_messages(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    Query(query): Query<EventQuery>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(state.store.messages(
        authenticated_actor(&state, &headers).await?,
        id,
        query.after,
    )?))
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct CreateShare {
    subject: ShareSubject,
    expires_at_ms: Option<u64>,
}

async fn create_share(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<CreateShare>,
) -> Result<impl IntoResponse, ApiError> {
    Ok((
        StatusCode::CREATED,
        Json(state.store.create_share(
            authenticated_actor(&state, &headers).await?,
            body.subject,
            now_ms()?,
            body.expires_at_ms,
        )?),
    ))
}

async fn resolve_share(
    State(state): State<Arc<AppState>>,
    Path(token): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(state.store.resolve_share(token, now_ms()?)?))
}

async fn revoke_share(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(state.store.revoke_share(
        authenticated_actor(&state, &headers).await?,
        id,
        now_ms()?,
    )?))
}

async fn issue_agent_code(
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, ApiError> {
    let claim = issue_human_claim(&state, now_ms()?).await?;
    state.metrics.note_claim_issued();
    Ok((StatusCode::CREATED, Json(claim)))
}

async fn register_tardy_account(
    State(state): State<Arc<AppState>>,
) -> Result<(StatusCode, Json<TemporaryTardyAccount>), ApiError> {
    purge_expired_tardies(&state).await?;
    Ok((
        StatusCode::CREATED,
        Json(register_tardy(&state, now_ms()?).await?),
    ))
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct ConnectTardyAccount {
    code: String,
    handle: String,
    display_name: String,
    #[serde(default)]
    bio: String,
}

#[derive(Serialize, ToSchema)]
pub(crate) struct ConnectedTardyAccount {
    account_id: Uuid,
    api_token: String,
    profile_id: Uuid,
    handle: String,
    expires_at_ms: u64,
}

async fn connect_tardy_account(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ConnectTardyAccount>,
) -> Result<(StatusCode, Json<ConnectedTardyAccount>), ApiError> {
    purge_expired_tardies(&state).await?;
    validate_handle(&body.handle)?;
    let temporary = connect_registered_tardy(&state, &body.code, now_ms()?).await?;
    let profile = state.store.create_profile(NewProfile {
        handle: body.handle,
        display_name: body.display_name,
        bio: body.bio,
        privacy: ProfilePrivacy::default(),
        created_at_ms: now_ms()?,
    })?;
    bind_account_profile(&state, temporary.account_id, profile.id).await?;
    if let Some(social) = &state.social {
        social
            .register_identity(
                temporary.account_id,
                profile.id,
                &profile.handle,
                IdentityKind::Agent,
                &profile.display_name,
                &profile.bio,
            )
            .await?;
    }
    Ok((
        StatusCode::CREATED,
        Json(ConnectedTardyAccount {
            account_id: temporary.account_id,
            api_token: temporary.api_token,
            profile_id: profile.id,
            handle: profile.handle,
            expires_at_ms: temporary.expires_at_ms,
        }),
    ))
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct ClaimTardyAccount {
    code: String,
}

async fn claim_tardy_account(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<ClaimTardyAccount>,
) -> Result<StatusCode, ApiError> {
    purge_expired_tardies(&state).await?;
    let account = authenticated_account(&state, &headers).await?;
    let profiles = claim_registered_tardy(&state, account, &body.code, now_ms()?).await?;
    let social = social_store(&state)?;
    for profile in profiles {
        social.transfer_identity(profile, account).await?;
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn purge_expired_tardies(state: &AppState) -> Result<(), ApiError> {
    state.purge_expired_unclaimed_tardies().await?;
    Ok(())
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct ClaimAgentCode {
    code: String,
    email: String,
}

async fn claim_agent_code(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ClaimAgentCode>,
) -> Result<impl IntoResponse, ApiError> {
    let account = claim_human_account(&state, &body.code, &body.email, now_ms()?).await?;
    state.metrics.note_account_claimed();
    Ok((StatusCode::CREATED, Json(account)))
}

async fn authorize_upload(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(intent): Json<UploadIntent>,
) -> Result<impl IntoResponse, ApiError> {
    let actor = authenticated_actor(&state, &headers).await?;
    Ok((
        StatusCode::CREATED,
        Json(state.media.authorize(actor, intent, now_ms()?).await?),
    ))
}

async fn complete_upload(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    let actor = authenticated_actor(&state, &headers).await?;
    let asset = state.media.complete(actor, id, now_ms()?).await?;
    let url = state.media.delivery_url(asset.id).await?;
    let mut view = serde_json::to_value(asset)
        .map_err(|error| ApiError::internal(format!("serialize completed upload: {error}")))?;
    view.as_object_mut()
        .ok_or_else(|| ApiError::internal("completed upload did not serialize as an object"))?
        .insert("url".into(), serde_json::Value::String(url));
    Ok((StatusCode::ACCEPTED, Json(view)))
}

pub(crate) fn selected_profile(headers: &HeaderMap) -> Result<Option<Uuid>, ApiError> {
    headers
        .get("x-tardy-profile-id")
        .map(|value| {
            value
                .to_str()
                .map_err(|_| ApiError::bad_request("invalid x-tardy-profile-id header"))
                .and_then(|value| {
                    Uuid::parse_str(value)
                        .map_err(|_| ApiError::bad_request("invalid x-tardy-profile-id header"))
                })
        })
        .transpose()
}

fn bearer_token(headers: &HeaderMap) -> Result<Option<&str>, ApiError> {
    headers
        .get("authorization")
        .map(|value| {
            value
                .to_str()
                .map_err(|_| ApiError::unauthorized("invalid authorization header"))
                .and_then(|value| {
                    value
                        .strip_prefix("Bearer ")
                        .filter(|token| !token.is_empty())
                        .ok_or_else(|| ApiError::unauthorized("bearer token is required"))
                })
        })
        .transpose()
}

pub(crate) async fn authenticated_account(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<Uuid, ApiError> {
    let token =
        bearer_token(headers)?.ok_or_else(|| ApiError::unauthorized("bearer token is required"))?;
    if let Some(accounts) = &state.pg_accounts {
        return accounts
            .authenticate(token, now_ms()?)
            .await
            .map_err(|_| ApiError::unauthorized("invalid bearer token"));
    }
    state
        .accounts
        .authenticate(token)
        .map_err(|_| ApiError::unauthorized("invalid bearer token"))
}

pub(crate) async fn authenticated_actor(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<Uuid, ApiError> {
    let account = authenticated_account(state, headers).await?;
    let profile = selected_profile(headers)?
        .ok_or_else(|| ApiError::unauthorized("x-tardy-profile-id is required"))?;
    if !account_can_act(state, account, profile).await? {
        return Err(ApiError::forbidden(
            "account cannot act as selected profile",
        ));
    }
    Ok(profile)
}

async fn optional_authenticated_actor(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<Option<Uuid>, ApiError> {
    match (bearer_token(headers)?, selected_profile(headers)?) {
        (None, None) => Ok(None),
        (Some(_), Some(_)) => authenticated_actor(state, headers).await.map(Some),
        _ => Err(ApiError::unauthorized(
            "both bearer token and x-tardy-profile-id are required",
        )),
    }
}

async fn issue_human_claim(
    state: &AppState,
    at: u64,
) -> Result<crate::onboarding::ClaimCode, ApiError> {
    match &state.pg_accounts {
        Some(store) => Ok(store.issue_human_claim(at).await?),
        None => Ok(state.accounts.issue_claim(at)?),
    }
}
async fn claim_human_account(
    state: &AppState,
    code: &str,
    email: &str,
    at: u64,
) -> Result<crate::onboarding::ClaimedAccount, ApiError> {
    match &state.pg_accounts {
        Some(store) => Ok(store.claim_human(code, email, at).await?),
        None => Ok(state.accounts.claim(code, email, at)?),
    }
}
async fn register_tardy(state: &AppState, at: u64) -> Result<TemporaryTardyAccount, ApiError> {
    match &state.pg_accounts {
        Some(store) => Ok(store.register_tardy(at).await?),
        None => Ok(state.accounts.register_tardy(at)?),
    }
}
async fn connect_registered_tardy(
    state: &AppState,
    code: &str,
    at: u64,
) -> Result<TemporaryTardyAccount, ApiError> {
    match &state.pg_accounts {
        Some(store) => Ok(store.connect_tardy(code, at).await?),
        None => Ok(state.accounts.connect_tardy(code, at)?),
    }
}
async fn claim_registered_tardy(
    state: &AppState,
    human: Uuid,
    code: &str,
    at: u64,
) -> Result<Vec<Uuid>, ApiError> {
    match &state.pg_accounts {
        Some(store) => Ok(store.claim_tardy(human, code, at).await?),
        None => Ok(state.accounts.claim_tardy(human, code, at)?),
    }
}
async fn purge_accounts(state: &AppState, at: u64) -> Result<Vec<Uuid>, ApiError> {
    match &state.pg_accounts {
        Some(store) => Ok(store.purge_expired(at).await?),
        None => Ok(state.accounts.purge_expired_tardies(at)?),
    }
}
async fn bind_account_profile(
    state: &AppState,
    account: Uuid,
    profile: Uuid,
) -> Result<(), ApiError> {
    match &state.pg_accounts {
        Some(store) => Ok(store.bind_profile(account, profile).await?),
        None => Ok(state.accounts.bind_profile(account, profile)?),
    }
}
async fn account_owns_profile(
    state: &AppState,
    account: Uuid,
    profile: Uuid,
) -> Result<bool, ApiError> {
    match &state.pg_accounts {
        Some(store) => Ok(store.owns_profile(account, profile).await?),
        None => Ok(state.accounts.owns_profile(account, profile)?),
    }
}
async fn account_can_act(state: &AppState, account: Uuid, profile: Uuid) -> Result<bool, ApiError> {
    match &state.pg_accounts {
        Some(store) => Ok(store.can_act(account, profile).await?),
        None => Ok(state.accounts.owns_profile(account, profile)?),
    }
}
async fn account_is_temporary(state: &AppState, account: Uuid) -> Result<bool, ApiError> {
    match &state.pg_accounts {
        Some(store) => Ok(store.is_temporary(account).await?),
        None => Ok(state.accounts.is_temporary(account)?),
    }
}
async fn grant_account_consent(
    state: &AppState,
    account: Uuid,
    provider: &str,
    purpose: &str,
    policy: &str,
    at: u64,
) -> Result<crate::onboarding::AiConsent, ApiError> {
    match &state.pg_accounts {
        Some(store) => Ok(store
            .grant_consent(account, provider, purpose, policy, at)
            .await?),
        None => Ok(state
            .accounts
            .grant_ai_consent(account, provider, purpose, policy, at)?),
    }
}
async fn revoke_account_consent(
    state: &AppState,
    account: Uuid,
    provider: &str,
    purpose: &str,
    at: u64,
) -> Result<(), ApiError> {
    match &state.pg_accounts {
        Some(store) => Ok(store.revoke_consent(account, provider, purpose, at).await?),
        None => Ok(state
            .accounts
            .revoke_ai_consent(account, provider, purpose, at)?),
    }
}
async fn has_account_consent(
    state: &AppState,
    account: Uuid,
    provider: &str,
    purpose: &str,
    policy: &str,
) -> Result<bool, ApiError> {
    match &state.pg_accounts {
        Some(store) => Ok(store
            .has_consent(account, provider, purpose, policy)
            .await?),
        None => Ok(state
            .accounts
            .has_ai_consent(account, provider, purpose, policy)?),
    }
}

fn build_handoff_prompt(
    target: &str,
    subject: &ShareSubject,
    capabilities: &AgentCapabilities,
) -> String {
    format!(
        r#"Integrate this project with Tardy using the {target} agent system.

Shared subject: {subject:?}

Goals:
1. Add this project to the agent's known projects without changing its existing build workflow.
2. Create one `agent_inbox` subscription at {subscriptions}. Use cursor polling at {poll_inbox} from a cron/skill, or configure an HTTPS webhook and verify every HMAC signature.
3. When a coding session begins, POST metadata to {start_live} and retain the returned live id.
4. Publish concise status, tool, and commit events to {events}. Never send secrets, environment values, full prompts, or raw command output.
5. When the session finishes or fails, POST to {end_live}.
6. When Hyperframes produces a final vertical video, POST its immutable media URL and metadata to {reels}.
7. Use {dm_threads} and {send_dm} for human-visible replies. Use {agent_share} when forwarding a project or post to another agent.

Requirements:
- Ask for a Tardy API credential through the agent system's secret store; credentials are intentionally absent here.
- Treat HTTP non-2xx responses as visible failures. Retry only idempotent reads; buffer writes with stable local ordering.
- Keep orchestration deterministic. Use AI only to summarize an already-observed event.
- Do not begin publishing until the user confirms the target profile and visibility.

First report the files and hooks you intend to change, then implement the smallest adapter that calls these APIs."#,
        start_live = capabilities.start_live_url,
        events = capabilities.append_live_event_url_template,
        end_live = capabilities.end_live_url_template,
        reels = capabilities.publish_reel_url,
        subscriptions = capabilities.agent_inbox_subscription_url,
        poll_inbox = capabilities.poll_agent_inbox_url_template,
        dm_threads = capabilities.create_dm_thread_url,
        send_dm = capabilities.send_dm_url_template,
        agent_share = capabilities.share_to_agent_url,
    )
}

fn build_agent_handoff(base: &str, target: String, subject: ShareSubject) -> AgentHandoff {
    let capabilities = AgentCapabilities {
        publish_reel_url: format!("{base}/v1/reels"),
        start_live_url: format!("{base}/v1/lives"),
        append_live_event_url_template: format!("{base}/v1/lives/{{live_id}}/events"),
        end_live_url_template: format!("{base}/v1/lives/{{live_id}}/end"),
        create_dm_thread_url: format!("{base}/v1/dm-threads"),
        send_dm_url_template: format!("{base}/v1/dm-threads/{{thread_id}}/messages"),
        agent_inbox_subscription_url: format!("{base}/v1/feed-subscriptions"),
        poll_agent_inbox_url_template: format!(
            "{base}/v1/feed-subscriptions/{{subscription_id}}/events?after={{cursor}}"
        ),
        share_to_agent_url: format!("{base}/v1/agent-shares"),
    };
    let prompt = build_handoff_prompt(&target, &subject, &capabilities);
    AgentHandoff {
        schema_version: "tardy.agent-handoff.v1".into(),
        target,
        subject,
        prompt,
        capabilities,
    }
}

fn validate_handle(value: &str) -> Result<(), ApiError> {
    let valid = (3..=32).contains(&value.len())
        && value.bytes().all(|b| {
            b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'_' | b'-' | b'.')
        });
    valid.then_some(()).ok_or_else(|| {
        ApiError::bad_request(
            "handle must be 3-32 lowercase letters, digits, dots, hyphens, or underscores",
        )
    })
}

fn require_http_url(value: &str, field: &str) -> Result<(), ApiError> {
    (value.starts_with("https://") || value.starts_with("http://"))
        .then_some(())
        .ok_or_else(|| ApiError::bad_request(format!("{field} must be an http(s) URL")))
}

fn now_ms() -> Result<u64, ApiError> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| ApiError::internal("system clock is before Unix epoch"))?
        .as_millis()
        .try_into()
        .map_err(|_| ApiError::internal("timestamp overflow"))?)
}

#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    message: String,
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl ApiError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
        }
    }
    fn unprocessable(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::UNPROCESSABLE_ENTITY,
            message: message.into(),
        }
    }
    fn range_not_satisfiable(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::RANGE_NOT_SATISFIABLE,
            message: message.into(),
        }
    }
    fn not_found(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: message.into(),
        }
    }
    pub(crate) fn unauthorized(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::UNAUTHORIZED,
            message: message.into(),
        }
    }
    pub(crate) fn forbidden(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            message: message.into(),
        }
    }
    pub(crate) fn internal(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: message.into(),
        }
    }
}

#[derive(Serialize, ToSchema)]
pub(crate) struct ErrorBody {
    error: String,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(ErrorBody {
                error: self.message,
            }),
        )
            .into_response()
    }
}

impl From<StoreError> for ApiError {
    fn from(value: StoreError) -> Self {
        match value {
            StoreError::ProfileNotFound
            | StoreError::ReelNotFound
            | StoreError::LiveNotFound
            | StoreError::ThreadNotFound
            | StoreError::ShareNotFound => Self::not_found(value.to_string()),
            StoreError::Forbidden | StoreError::DirectMessagesClosed => {
                Self::forbidden(value.to_string())
            }
            StoreError::EmptyMessage => Self::bad_request(value.to_string()),
            StoreError::IdempotencyConflict => Self {
                status: StatusCode::CONFLICT,
                message: value.to_string(),
            },
            StoreError::LiveEnded | StoreError::HandleConflict => Self {
                status: StatusCode::CONFLICT,
                message: value.to_string(),
            },
            StoreError::Poisoned => Self::internal(value.to_string()),
        }
    }
}

impl From<OnboardingError> for ApiError {
    fn from(value: OnboardingError) -> Self {
        match value {
            OnboardingError::InvalidClaim => Self::not_found(value.to_string()),
            OnboardingError::EmailConflict => Self {
                status: StatusCode::CONFLICT,
                message: value.to_string(),
            },
            OnboardingError::InvalidEmail => Self::bad_request(value.to_string()),
            OnboardingError::Database(_)
            | OnboardingError::Poisoned
            | OnboardingError::TimestampOverflow => Self::internal(value.to_string()),
        }
    }
}

impl From<PgAccountError> for ApiError {
    fn from(value: PgAccountError) -> Self {
        match value {
            PgAccountError::InvalidClaim => Self::not_found(value.to_string()),
            PgAccountError::EmailConflict => Self {
                status: StatusCode::CONFLICT,
                message: value.to_string(),
            },
            PgAccountError::InvalidEmail => Self::bad_request(value.to_string()),
            PgAccountError::AssertionReplayed => Self::unauthorized(value.to_string()),
            PgAccountError::InvalidHandle => Self::bad_request(value.to_string()),
            PgAccountError::HandleConflict => Self {
                status: StatusCode::CONFLICT,
                message: value.to_string(),
            },
            PgAccountError::InvalidDisplayName | PgAccountError::InvalidBio => {
                Self::bad_request(value.to_string())
            }
            PgAccountError::Database(_) | PgAccountError::Timestamp => {
                Self::internal(value.to_string())
            }
        }
    }
}

impl From<AppleAuthError> for ApiError {
    fn from(value: AppleAuthError) -> Self {
        match value {
            AppleAuthError::InvalidToken | AppleAuthError::InvalidNonce => {
                Self::unauthorized(value.to_string())
            }
            AppleAuthError::Unavailable(_) => Self {
                status: StatusCode::BAD_GATEWAY,
                message: value.to_string(),
            },
        }
    }
}

impl From<MediaError> for ApiError {
    fn from(value: MediaError) -> Self {
        match value {
            MediaError::Unconfigured => Self {
                status: StatusCode::SERVICE_UNAVAILABLE,
                message: value.to_string(),
            },
            MediaError::UnsupportedType
            | MediaError::InvalidSize(_)
            | MediaError::MetadataMismatch => Self::bad_request(value.to_string()),
            MediaError::NotFound => Self::not_found(value.to_string()),
            MediaError::Forbidden => Self::forbidden(value.to_string()),
            MediaError::ObjectStore(_) | MediaError::Poisoned | MediaError::TimestampOverflow => {
                Self::internal(value.to_string())
            }
        }
    }
}

impl From<crate::ranking::RankingError> for ApiError {
    fn from(value: crate::ranking::RankingError) -> Self {
        Self::internal(value.to_string())
    }
}

impl From<SearchError> for ApiError {
    fn from(value: SearchError) -> Self {
        match value {
            SearchError::Unavailable => Self {
                status: StatusCode::SERVICE_UNAVAILABLE,
                message: value.to_string(),
            },
            SearchError::EmptyQuery => Self::bad_request(value.to_string()),
            SearchError::Provider(_) | SearchError::InvalidResult => Self {
                status: StatusCode::BAD_GATEWAY,
                message: value.to_string(),
            },
        }
    }
}

impl From<PushError> for ApiError {
    fn from(value: PushError) -> Self {
        match value {
            PushError::DeviceToken | PushError::InvalidName => Self::bad_request(value.to_string()),
            PushError::LeaseLost => Self::not_found(value.to_string()),
            PushError::Database(_)
            | PushError::Key(_)
            | PushError::PayloadTooLarge
            | PushError::Transport(_)
            | PushError::Rejected { .. }
            | PushError::TokenCache => Self::internal(value.to_string()),
        }
    }
}

impl From<AdsError> for ApiError {
    fn from(value: AdsError) -> Self {
        match value {
            AdsError::Validation(_) => Self::bad_request(value.to_string()),
            AdsError::Conflict(_) => Self {
                status: StatusCode::CONFLICT,
                message: value.to_string(),
            },
            AdsError::Payment(_) => Self {
                status: StatusCode::PAYMENT_REQUIRED,
                message: value.to_string(),
            },
            AdsError::Database(sqlx::Error::RowNotFound) => {
                Self::not_found("ads resource not found")
            }
            AdsError::Database(_) => Self::internal(value.to_string()),
        }
    }
}

impl From<BillingError> for ApiError {
    fn from(value: BillingError) -> Self {
        match value {
            BillingError::InvalidHandoff | BillingError::InvalidSession => {
                Self::unauthorized(value.to_string())
            }
            BillingError::Unconfigured => Self {
                status: StatusCode::SERVICE_UNAVAILABLE,
                message: value.to_string(),
            },
            BillingError::SuperTardySoldOut => Self {
                status: StatusCode::CONFLICT,
                message: value.to_string(),
            },
            BillingError::Invalid(_) => Self::bad_request(value.to_string()),
            BillingError::Provider(_) => Self {
                status: StatusCode::BAD_GATEWAY,
                message: value.to_string(),
            },
            BillingError::Database(_) | BillingError::Verification(_) => {
                Self::internal(value.to_string())
            }
        }
    }
}

impl From<SubscriptionError> for ApiError {
    fn from(value: SubscriptionError) -> Self {
        match value {
            SubscriptionError::Invalid => Self::bad_request(value.to_string()),
            SubscriptionError::NotFound => Self::not_found(value.to_string()),
            SubscriptionError::SigningUnavailable => Self {
                status: StatusCode::SERVICE_UNAVAILABLE,
                message: value.to_string(),
            },
            SubscriptionError::Database(sqlx::Error::RowNotFound) => {
                Self::not_found("subscription not found")
            }
            SubscriptionError::Database(_) => Self::internal(value.to_string()),
        }
    }
}

impl From<SocialError> for ApiError {
    fn from(value: SocialError) -> Self {
        match value {
            SocialError::Invalid(_) => Self::bad_request(value.to_string()),
            SocialError::NotFound => Self::not_found(value.to_string()),
            SocialError::Forbidden => Self::forbidden(value.to_string()),
            SocialError::Database(sqlx::Error::RowNotFound) => {
                Self::not_found("social resource not found")
            }
            SocialError::Database(_) | SocialError::Notification(_) => {
                Self::internal(value.to_string())
            }
        }
    }
}

impl From<AudioError> for ApiError {
    fn from(value: AudioError) -> Self {
        match value {
            AudioError::Invalid(_) => Self::bad_request(value.to_string()),
            AudioError::NotFound => Self::not_found(value.to_string()),
            AudioError::Forbidden | AudioError::RightsNotCleared => {
                Self::forbidden(value.to_string())
            }
            AudioError::Database(sqlx::Error::RowNotFound) => {
                Self::not_found("audio resource not found")
            }
            AudioError::RecognitionPolicy(_) => Self::internal(value.to_string()),
            AudioError::Database(_) => Self::internal(value.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn profile_avatar_defaults_are_kind_specific_and_never_reel_media() {
        let human = super::dicebear_avatar_url(IdentityKind::Human, "avery fpl");
        let agent = super::dicebear_avatar_url(IdentityKind::Agent, "builder");
        let project = super::dicebear_avatar_url(IdentityKind::Project, "tardy");
        let channel = super::dicebear_avatar_url(IdentityKind::Channel, "hacker-news");
        assert!(
            human.contains("/notionists/png?seed=avery+fpl&size=160"),
            "{human}"
        );
        assert!(agent.contains("/bottts-neutral/png?seed=builder&size=160"));
        assert!(project.contains("/shapes/png?seed=tardy&size=160"));
        assert!(channel.contains("/glass/png?seed=hacker-news&size=160"));
        for avatar in [human, agent, project, channel] {
            assert!(!avatar.contains("/v1/dev/blobs/"));
            assert!(!avatar.ends_with(".jpg"));
            assert!(!avatar.ends_with(".mp4"));
        }
    }

    use super::*;
    use crate::search::{RankedDocument, Reranker, SearchDocument};
    use axum::body::{Body, to_bytes};
    use axum::http::{Request, header::CONTENT_TYPE};
    use serde_json::{Value, json};
    use tower::ServiceExt;

    #[test]
    fn local_blob_ranges_support_video_clients() {
        assert_eq!(parse_byte_range("bytes=0-99", 1_000).unwrap(), (0, 99));
        assert_eq!(parse_byte_range("bytes=900-", 1_000).unwrap(), (900, 999));
        assert_eq!(parse_byte_range("bytes=-100", 1_000).unwrap(), (900, 999));
        assert!(parse_byte_range("bytes=1000-", 1_000).is_err());
        assert!(parse_byte_range("items=0-10", 1_000).is_err());
        assert!(parse_byte_range("bytes=0-1,4-5", 1_000).is_err());
    }

    struct TestReranker;

    #[async_trait::async_trait]
    impl Reranker for TestReranker {
        fn provider(&self) -> &'static str {
            "test-provider"
        }

        async fn rerank(
            &self,
            _query: &str,
            documents: &[SearchDocument],
            limit: usize,
        ) -> Result<Vec<RankedDocument>, SearchError> {
            Ok((0..documents.len().min(limit))
                .map(|index| RankedDocument {
                    index,
                    score: 1.0 - index as f64 / 100.0,
                })
                .collect())
        }
    }

    async fn request(
        app: &Router,
        method: &str,
        uri: &str,
        body: Value,
        actor: Option<&str>,
        token: Option<&str>,
    ) -> (StatusCode, Value) {
        let mut request = Request::builder()
            .method(method)
            .uri(uri)
            .header(CONTENT_TYPE, "application/json");
        if let Some(actor) = actor {
            request = request.header("x-tardy-profile-id", actor);
        }
        if let Some(token) = token {
            request = request.header("authorization", format!("Bearer {token}"));
        }
        let response = app
            .clone()
            .oneshot(request.body(Body::from(body.to_string())).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let value = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).unwrap()
        };
        (status, value)
    }

    #[tokio::test]
    async fn serves_the_generated_openapi_contract() {
        let app = router(Arc::new(AppState::in_memory("https://tardy.test").unwrap()));
        let (status, document) =
            request(&app, "GET", "/openapi.json", Value::Null, None, None).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(document["openapi"], "3.1.0");
        assert_eq!(
            document["paths"]["/v1/uploads"]["post"]["operationId"],
            "authorizeUpload"
        );
    }

    #[tokio::test]
    async fn saved_posts_are_private_and_search_requires_revocable_consent() {
        let mut state = AppState::in_memory("https://tardy.test").unwrap();
        state.search = Arc::new(SearchService::with_reranker(Arc::new(TestReranker)));
        let state = Arc::new(state);
        let ticket = state.accounts.issue_claim(1).unwrap();
        let claimed = state
            .accounts
            .claim(&ticket.code, "reader@example.com", 2)
            .unwrap();
        let token = claimed.api_token;
        let profile = state
            .store
            .create_profile(NewProfile {
                handle: "reader".into(),
                display_name: "Reader".into(),
                bio: String::new(),
                privacy: ProfilePrivacy::default(),
                created_at_ms: 3,
            })
            .unwrap();
        state
            .accounts
            .bind_profile(claimed.account.id, profile.id)
            .unwrap();
        let reel = state
            .store
            .publish_reel(
                profile.id,
                NewReel {
                    profile_id: profile.id,
                    caption: "Rust search".into(),
                    media_url: "https://media.test/reel.mp4".into(),
                    poster_url: None,
                    duration_ms: 10,
                    visibility: Visibility::Public,
                    published_at_ms: 4,
                },
            )
            .unwrap();
        let app = router(state);
        let profile_id = profile.id.to_string();

        let (status, saved) = request(
            &app,
            "PUT",
            &format!("/v1/saved-posts/{}", reel.id),
            Value::Null,
            Some(&profile_id),
            Some(&token),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(saved["reel"]["id"], reel.id.to_string());

        let (status, _) = request(
            &app,
            "POST",
            "/v1/search",
            json!({"query":"Rust", "limit":10}),
            Some(&profile_id),
            Some(&token),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);

        let (status, _) = request(
            &app,
            "POST",
            "/v1/ai-consents/search",
            Value::Null,
            Some(&profile_id),
            Some(&token),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let (status, _) = request(
            &app,
            "POST",
            "/v1/search",
            json!({"query":"Rust", "limit":10}),
            Some(&profile_id),
            Some(&token),
        )
        .await;
        // Consent now lets the request reach the durable social-search boundary. This
        // unit state intentionally has no PgSocialStore; PostgreSQL integration tests
        // cover successful candidate retrieval.
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);

        let (status, _) = request(
            &app,
            "DELETE",
            "/v1/ai-consents/search",
            Value::Null,
            Some(&profile_id),
            Some(&token),
        )
        .await;
        assert_eq!(status, StatusCode::NO_CONTENT);
        let (status, _) = request(
            &app,
            "POST",
            "/v1/search",
            json!({"query":"Rust", "limit":10}),
            Some(&profile_id),
            Some(&token),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn feed_ranker_switch_changes_for_you_order() {
        let mut state = AppState::in_memory("https://tardy.test").unwrap();
        let store = state.store.clone();
        let new_profile = |handle: &str| {
            store
                .create_profile(NewProfile {
                    handle: handle.into(),
                    display_name: handle.into(),
                    bio: String::new(),
                    privacy: ProfilePrivacy::default(),
                    created_at_ms: 1,
                })
                .unwrap()
        };
        let now = now_ms().unwrap();
        let publish = |author: &crate::domain::Profile, published_at_ms| {
            store
                .publish_reel(
                    author.id,
                    NewReel {
                        profile_id: author.id,
                        caption: "update".into(),
                        media_url: "https://media.test/reel.mp4".into(),
                        poster_url: None,
                        duration_ms: 15_000,
                        visibility: Visibility::Public,
                        published_at_ms,
                    },
                )
                .unwrap()
        };
        let (popular_author, quiet_author) = (new_profile("popular"), new_profile("quiet"));
        let popular = publish(&popular_author, now - 2 * 3_600_000);
        let newer = publish(&quiet_author, now - 3_600_000);
        for index in 0..8 {
            let fan = new_profile(&format!("fan{index}"));
            for kind in [
                EngagementKind::View,
                EngagementKind::CompletedView,
                EngagementKind::Like,
                EngagementKind::Share,
            ] {
                store
                    .record_engagement(fan.id, popular.id, Uuid::new_v4(), kind, now)
                    .unwrap();
            }
        }
        let feed_ids = |state: AppState| async move {
            let (status, items) = request(
                &router(Arc::new(state)),
                "GET",
                "/v1/feed",
                Value::Null,
                None,
                None,
            )
            .await;
            assert_eq!(status, StatusCode::OK);
            items
                .as_array()
                .unwrap()
                .iter()
                .map(|item| item["id"].as_str().unwrap().to_owned())
                .collect::<Vec<_>>()
        };

        // Default Lua policy: pure recency.
        let mut lua = AppState::in_memory("https://tardy.test").unwrap();
        lua.store = store.clone();
        let lua_order = feed_ids(lua).await;
        assert_eq!(lua_order, [newer.id.to_string(), popular.id.to_string()]);

        state.ranker = FeedRanker::from_name(Some("x-value-model")).unwrap();
        assert_eq!(
            feed_ids(state).await,
            [popular.id.to_string(), newer.id.to_string()]
        );
    }

    #[tokio::test]
    async fn creates_a_hermes_handoff_with_a_complete_prompt() {
        let state = Arc::new(AppState::in_memory("https://tardy.test").unwrap());
        let ticket = state.accounts.issue_claim(1).unwrap();
        let claimed = state
            .accounts
            .claim(&ticket.code, "agent@example.com", 2)
            .unwrap();
        let token = claimed.api_token;
        let app = router(state);
        let (_, profile) = request(
            &app,
            "POST",
            "/v1/profiles",
            json!({"handle":"build_agent","display_name":"Build Agent"}),
            None,
            Some(&token),
        )
        .await;
        let profile_id = profile["id"].as_str().unwrap();
        let (status, handoff) = request(
            &app,
            "POST",
            "/v1/agent-handoffs",
            json!({"target":"hermes","subject":{"kind":"profile","id":profile["id"]}}),
            Some(profile_id),
            Some(&token),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(handoff["schema_version"], "tardy.agent-handoff.v1");
        assert!(
            handoff["prompt"]
                .as_str()
                .unwrap()
                .contains("Never send secrets")
        );
        assert_eq!(
            handoff["capabilities"]["start_live_url"],
            "https://tardy.test/v1/lives"
        );
    }

    #[tokio::test]
    async fn share_to_agent_creates_a_real_dm_with_the_complete_handoff() {
        let state = Arc::new(AppState::in_memory("https://tardy.test").unwrap());
        let sender_claim = state
            .accounts
            .claim(
                &state.accounts.issue_claim(1).unwrap().code,
                "sender@example.com",
                2,
            )
            .unwrap();
        let agent_claim = state
            .accounts
            .claim(
                &state.accounts.issue_claim(3).unwrap().code,
                "agent@example.com",
                4,
            )
            .unwrap();
        let sender = state
            .store
            .create_profile(NewProfile {
                handle: "sender".into(),
                display_name: "Sender".into(),
                bio: String::new(),
                privacy: ProfilePrivacy::default(),
                created_at_ms: 5,
            })
            .unwrap();
        let agent = state
            .store
            .create_profile(NewProfile {
                handle: "hermes_bot".into(),
                display_name: "Hermes".into(),
                bio: String::new(),
                privacy: ProfilePrivacy {
                    direct_messages: crate::domain::DirectMessagePolicy::Everyone,
                    ..ProfilePrivacy::default()
                },
                created_at_ms: 6,
            })
            .unwrap();
        state
            .accounts
            .bind_profile(sender_claim.account.id, sender.id)
            .unwrap();
        state
            .accounts
            .bind_profile(agent_claim.account.id, agent.id)
            .unwrap();
        let app = router(state);
        let (status, receipt) = request(
            &app,
            "POST",
            "/v1/agent-shares",
            json!({
                "target_profile_id": agent.id,
                "target": "openclaw/hermes",
                "subject": {"kind": "profile", "id": sender.id}
            }),
            Some(&sender.id.to_string()),
            Some(&sender_claim.api_token),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(receipt["message"]["recipient_id"], agent.id.to_string());
        assert_eq!(
            receipt["handoff"]["schema_version"],
            "tardy.agent-handoff.v1"
        );
        assert!(
            receipt["message"]["body"]
                .as_str()
                .unwrap()
                .contains("openclaw/hermes")
        );
    }

    #[tokio::test]
    async fn llms_txt_explains_private_agent_claim_flow() {
        let app = router(Arc::new(AppState::in_memory("https://tardy.test").unwrap()));
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/llms.txt")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let text = String::from_utf8(
            to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap()
                .to_vec(),
        )
        .unwrap();
        assert!(text.contains("one-time code"));
        assert!(text.contains("default to private"));
        assert!(text.contains("https://tardy.test/v1/onboarding/tardy-claims"));
    }

    #[tokio::test]
    async fn one_account_cannot_act_as_another_accounts_profile() {
        let state = Arc::new(AppState::in_memory("https://tardy.test").unwrap());
        let first_ticket = state.accounts.issue_claim(1).unwrap();
        let first = state
            .accounts
            .claim(&first_ticket.code, "first@example.com", 2)
            .unwrap();
        let second_ticket = state.accounts.issue_claim(3).unwrap();
        let second = state
            .accounts
            .claim(&second_ticket.code, "second@example.com", 4)
            .unwrap();
        let app = router(state);
        let (_, profile) = request(
            &app,
            "POST",
            "/v1/profiles",
            json!({"handle":"first_agent","display_name":"First"}),
            None,
            Some(&first.api_token),
        )
        .await;
        let profile_id = profile["id"].as_str().unwrap();
        let (status, _) = request(
            &app,
            "POST",
            "/v1/agent-handoffs",
            json!({"target":"hermes","subject":{"kind":"profile","id":profile["id"]}}),
            Some(profile_id),
            Some(&second.api_token),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn metrics_use_bounded_route_templates() {
        let app = router(Arc::new(AppState::in_memory("https://tardy.test").unwrap()));
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/v1/profiles/not-a-real-profile")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/metrics")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let text = String::from_utf8(
            to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap()
                .to_vec(),
        )
        .unwrap();
        assert!(text.contains("route=\"/v1/profiles/{handle}\""));
        assert!(!text.contains("not-a-real-profile"));
    }
}
