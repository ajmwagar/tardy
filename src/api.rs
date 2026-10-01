use crate::ads::{
    AdPaymentProcessor, AdsError, CampaignReport, FundingIntent, NewCampaign, PaymentRequired,
    PaymentRequirements, PgAdsStore, ResourceInfo, X402_VERSION,
};
use crate::domain::{
    AgentCapabilities, AgentHandoff, AgentShareReceipt, EngagementKind, LiveEventPayload,
    ProfilePrivacy, ShareSubject, Visibility,
};
use crate::media::{MediaError, MediaService, UploadIntent};
use crate::metrics::Metrics;
use crate::onboarding::{AccountRegistry, OnboardingError, TemporaryTardyAccount};
use crate::pg_accounts::{PgAccountError, PgAccountStore};
use crate::push::{NotificationPreference, PgPushStore, PushDevice, PushError, RegisterPushDevice};
use crate::ranking::LuaRanker;
use crate::search::{SearchError, SearchService};
use crate::social::{
    Comment, Conversation, ConversationMessage, IdentityKind, PgSocialStore, PostVisibility,
    SharedLink, SocialError, TardyPost,
};
use crate::store::{MemoryStore, NewLive, NewProfile, NewReel, Store, StoreError};
use crate::subscriptions::{
    FeedEvent, NewSubscription, PgSubscriptionStore, Subscription, SubscriptionError,
};
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::{Json, Router, middleware};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use utoipa::ToSchema;
use uuid::Uuid;

pub struct AppState {
    pub store: Arc<dyn Store>,
    pub ranker: LuaRanker,
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
            ranker: LuaRanker::default_policy()?,
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
        })
    }

    pub fn with_account_db(
        public_base_url: impl Into<String>,
        path: impl AsRef<std::path::Path>,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        Ok(Self {
            store: Arc::new(MemoryStore::default()),
            ranker: LuaRanker::default_policy()?,
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
        })
    }

    pub fn postgres(
        public_base_url: impl Into<String>,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        Ok(Self {
            store: Arc::new(MemoryStore::default()),
            ranker: LuaRanker::default_policy()?,
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
        })
    }

    pub fn with_push_store(mut self, push: PgPushStore) -> Self {
        self.push = Some(Arc::new(push));
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
    Router::new()
        .route("/healthz", get(|| async { StatusCode::NO_CONTENT }))
        .route("/metrics", get(metrics_endpoint))
        .route("/openapi.json", get(openapi_endpoint))
        .route("/llms.txt", get(llms_txt))
        .route("/v1/profiles", post(create_profile))
        .route("/v1/profiles/{handle}", get(get_profile))
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
        .route("/v1/onboarding/tardy-claims", post(claim_tardy_account))
        .route("/v1/uploads", post(authorize_upload))
        .route("/v1/uploads/{id}/complete", post(complete_upload))
        .route("/v1/reels", post(publish_reel))
        .route("/v1/reels/{id}/engagements", post(record_engagement))
        .route("/v1/saved-posts", get(list_saved_posts))
        .route("/v1/saved-posts/{id}", put(save_post).delete(unsave_post))
        .route(
            "/v1/ai-consents/search",
            post(grant_search_consent).delete(revoke_search_consent),
        )
        .route("/v1/search", post(search_posts))
        .route("/v1/explore", post(explore_posts))
        .route("/v1/lives", post(start_live))
        .route("/v1/lives/{id}/events", post(append_event).get(list_events))
        .route("/v1/lives/{id}/end", post(end_live))
        .route("/v1/feed", get(feed))
        .route("/v1/feed/hyper-tardy", get(hyper_tardy_feed))
        .route("/v1/agent-handoffs", post(agent_handoff))
        .route("/v1/agent-shares", post(share_to_agent))
        .route("/v1/social/shared-links", post(create_shared_link))
        .route(
            "/v1/social/conversations",
            post(create_social_conversation).get(list_social_conversations),
        )
        .route(
            "/v1/social/conversations/{id}/messages",
            post(send_social_message).get(list_social_messages),
        )
        .route(
            "/v1/social/conversations/{id}/agents",
            post(summon_social_agent),
        )
        .route("/v1/social/posts", post(publish_social_post))
        .route("/v1/social/posts/{id}/comments", post(create_post_comment))
        .route("/v1/push/devices", post(register_push_device))
        .route(
            "/v1/push/devices/{id}",
            axum::routing::delete(unregister_push_device),
        )
        .route("/v1/push/preferences", put(set_notification_preference))
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
        .layer(middleware::from_fn(move |request, next| {
            crate::metrics::track(metrics.clone(), request, next)
        }))
}

async fn create_feed_subscription(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<NewSubscription>,
) -> Result<(StatusCode, Json<Subscription>), ApiError> {
    let account = authenticated_account(&state, &headers).await?;
    if let Some(profile_id) = body.profile_id
        && !account_owns_profile(&state, account, profile_id).await?
    {
        return Err(ApiError::forbidden(
            "account does not own agent inbox profile",
        ));
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

async fn set_notification_preference(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<NotificationPreference>,
) -> Result<Json<NotificationPreference>, ApiError> {
    let account_id = authenticated_account(&state, &headers).await?;
    Ok(Json(
        push_store(&state)?.set_preference(account_id, body).await?,
    ))
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
            .register_identity(account_id, value.id, &value.handle, body.kind)
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

#[derive(Deserialize, ToSchema)]
pub(crate) struct CreateSocialConversation {
    recipient_profile_id: Uuid,
}

async fn create_social_conversation(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<CreateSocialConversation>,
) -> Result<(StatusCode, Json<Conversation>), ApiError> {
    Ok((
        StatusCode::CREATED,
        Json(
            social_store(&state)?
                .create_conversation(
                    authenticated_actor(&state, &headers).await?,
                    body.recipient_profile_id,
                )
                .await?,
        ),
    ))
}

async fn list_social_conversations(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<Conversation>>, ApiError> {
    Ok(Json(
        social_store(&state)?
            .conversations(authenticated_actor(&state, &headers).await?)
            .await?,
    ))
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct SendSocialMessage {
    body: String,
    shared_link_id: Option<Uuid>,
}

async fn send_social_message(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    Json(body): Json<SendSocialMessage>,
) -> Result<(StatusCode, Json<ConversationMessage>), ApiError> {
    Ok((
        StatusCode::CREATED,
        Json(
            social_store(&state)?
                .send_message(
                    authenticated_actor(&state, &headers).await?,
                    id,
                    &body.body,
                    body.shared_link_id,
                )
                .await?,
        ),
    ))
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
    Ok(Json(
        social_store(&state)?
            .messages(
                authenticated_actor(&state, &headers).await?,
                id,
                query.after,
                query.limit,
            )
            .await?,
    ))
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
                .publish_post(
                    authenticated_actor(&state, &headers).await?,
                    body.client_request_id,
                    &body.caption,
                    body.shared_link_id,
                    body.visibility,
                )
                .await?,
        ),
    ))
}

#[derive(Deserialize, ToSchema)]
pub(crate) struct CreatePostComment {
    body: String,
    #[serde(default)]
    mentioned_profile_ids: Vec<Uuid>,
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

fn social_store(state: &AppState) -> Result<&PgSocialStore, ApiError> {
    state.social.as_deref().ok_or_else(|| ApiError {
        status: StatusCode::SERVICE_UNAVAILABLE,
        message: "durable social features are not configured".into(),
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
) -> Result<Json<Vec<crate::search::SearchResult>>, ApiError> {
    if !(1..=50).contains(&limit) {
        return Err(ApiError::bad_request("limit must be between 1 and 50"));
    }
    let account_id = authenticated_account(state, headers).await?;
    let provider = state.search.provider().ok_or(SearchError::Unavailable)?;
    if !has_account_consent(
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
    let candidates = state.store.feed_candidates(None)?;
    Ok(Json(state.search.search(query, candidates, limit).await?))
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
) -> Result<impl IntoResponse, ApiError> {
    if !(1..=100).contains(&query.limit) {
        return Err(ApiError::bad_request("limit must be between 1 and 100"));
    }
    let mut items = state.ranker.rank(
        state
            .store
            .feed_candidates(optional_authenticated_actor(&state, &headers).await?)?,
        now_ms()?,
    )?;
    items.truncate(query.limit);
    Ok(Json(items))
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
            .publish_agent_share(Uuid::new_v4(), body.target_profile_id, &handoff)
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
    Ok(Json(state.store.public_profile(
        &handle,
        optional_authenticated_actor(&state, &headers).await?,
    )?))
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
    Ok((
        StatusCode::ACCEPTED,
        Json(state.media.complete(actor, id, now_ms()?).await?),
    ))
}

fn selected_profile(headers: &HeaderMap) -> Result<Option<Uuid>, ApiError> {
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

async fn authenticated_account(state: &AppState, headers: &HeaderMap) -> Result<Uuid, ApiError> {
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

async fn authenticated_actor(state: &AppState, headers: &HeaderMap) -> Result<Uuid, ApiError> {
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
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_');
    valid.then_some(()).ok_or_else(|| {
        ApiError::bad_request("handle must be 3-32 lowercase letters, digits, or underscores")
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

impl ApiError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
        }
    }
    fn not_found(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: message.into(),
        }
    }
    fn unauthorized(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::UNAUTHORIZED,
            message: message.into(),
        }
    }
    fn forbidden(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            message: message.into(),
        }
    }
    fn internal(message: impl Into<String>) -> Self {
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
            PgAccountError::Database(_) | PgAccountError::Timestamp => {
                Self::internal(value.to_string())
            }
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
            SocialError::Database(_) => Self::internal(value.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::{RankedDocument, Reranker, SearchDocument};
    use axum::body::{Body, to_bytes};
    use axum::http::{Request, header::CONTENT_TYPE};
    use serde_json::{Value, json};
    use tower::ServiceExt;

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
            None,
            Some(&token),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);

        let (status, _) = request(
            &app,
            "POST",
            "/v1/ai-consents/search",
            Value::Null,
            None,
            Some(&token),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let (status, results) = request(
            &app,
            "POST",
            "/v1/search",
            json!({"query":"Rust", "limit":10}),
            None,
            Some(&token),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(results[0]["item"]["id"], reel.id.to_string());

        let (status, _) = request(
            &app,
            "DELETE",
            "/v1/ai-consents/search",
            Value::Null,
            None,
            Some(&token),
        )
        .await;
        assert_eq!(status, StatusCode::NO_CONTENT);
        let (status, _) = request(
            &app,
            "POST",
            "/v1/search",
            json!({"query":"Rust", "limit":10}),
            None,
            Some(&token),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
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
