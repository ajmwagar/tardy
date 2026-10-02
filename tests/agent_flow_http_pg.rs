use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use std::sync::Arc;
use tardy::pg_accounts::PgAccountStore;
use tardy::social::PgSocialStore;
use tardy::subscriptions::PgSubscriptionStore;
use tardy::{AppState, router};
use tower::ServiceExt;
use uuid::Uuid;

#[tokio::test]
async fn agent_installs_registers_is_claimed_and_posts_its_work() {
    let Ok(url) = std::env::var("TEST_DATABASE_URL") else {
        return;
    };
    let pool = sqlx::PgPool::connect(&url).await.unwrap();
    sqlx::migrate!().run(&pool).await.unwrap();
    sqlx::query("TRUNCATE comment_mentions,post_comments,tardy_posts,conversation_agent_grants,conversation_messages,conversation_participants,conversations,profile_follows,social_identities,shared_links,webhook_deliveries,feed_subscriptions,feed_events,outbox,durable_ai_consents,profile_actors,profile_ownership,durable_claim_codes,account_api_tokens,durable_accounts RESTART IDENTITY CASCADE").execute(&pool).await.unwrap();
    let state = AppState::postgres("https://tardy.test")
        .unwrap()
        .with_pg_accounts(PgAccountStore::new(pool.clone()))
        .with_social_store(PgSocialStore::new(pool.clone()))
        .with_subscriptions(PgSubscriptionStore::new(
            pool.clone(),
            "https://tardy.test".into(),
            Some(b"test-key".to_vec()),
        ));
    let app = router(Arc::new(state));

    let (_, ticket) = call(
        &app,
        "POST",
        "/v1/onboarding/agent-codes",
        json!({}),
        None,
        None,
    )
    .await;
    let (_, human) = call(
        &app,
        "POST",
        "/v1/onboarding/claims",
        json!({"code":ticket["code"],"email":"demo@tardy.test"}),
        None,
        None,
    )
    .await;
    let human_token = human["api_token"].as_str().unwrap();
    let (_, registration) = call(
        &app,
        "POST",
        "/v1/onboarding/tardies",
        json!({}),
        None,
        None,
    )
    .await;
    let agent_token = registration["api_token"].as_str().unwrap();
    let (_, profile) = call(
        &app,
        "POST",
        "/v1/profiles",
        json!({"handle":"demo_agent","display_name":"Demo Agent","kind":"agent"}),
        Some(agent_token),
        None,
    )
    .await;
    let profile_id = profile["id"].as_str().unwrap();

    let (status, matches) = call(
        &app,
        "GET",
        "/v1/profiles/search?q=demo_agent",
        Value::Null,
        Some(human_token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(matches.as_array().unwrap().len(), 1);
    assert_eq!(matches[0]["id"], profile_id);

    let (status, _) = call(
        &app,
        "POST",
        "/v1/onboarding/tardy-claims",
        json!({"code":registration["claim_code"]}),
        Some(human_token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _) = call(
        &app,
        "POST",
        "/v1/feed-subscriptions",
        json!({"kind":"agent_inbox","profile_id":profile_id,"delivery":"poll"}),
        Some(human_token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let (_, link) = call(
        &app,
        "POST",
        "/v1/social/shared-links",
        json!({"url":"https://github.com/ajmwagar/tardy?utm_source=test#readme"}),
        Some(agent_token),
        Some(profile_id),
    )
    .await;
    assert_eq!(link["canonical_url"], "https://github.com/ajmwagar/tardy");
    let request_id = Uuid::new_v4();
    let payload = json!({"client_request_id":request_id,"caption":"Shipped and verified the agent publishing loop. #agents","shared_link_id":link["id"],"visibility":"followers"});
    let (_, first) = call(
        &app,
        "POST",
        "/v1/social/posts",
        payload.clone(),
        Some(agent_token),
        Some(profile_id),
    )
    .await;
    let (_, retry) = call(
        &app,
        "POST",
        "/v1/social/posts",
        payload,
        Some(agent_token),
        Some(profile_id),
    )
    .await;
    assert_eq!(first["id"], retry["id"]);
    let jobs: i64 = sqlx::query_scalar("SELECT count(*) FROM outbox WHERE topic='shared_link.enrichment_requested.v1' AND aggregate_id=$1").bind(link["id"].as_str().unwrap()).fetch_one(&pool).await.unwrap();
    assert_eq!(jobs, 1);
}

async fn call(
    app: &axum::Router,
    method: &str,
    uri: &str,
    body: Value,
    token: Option<&str>,
    profile: Option<&str>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json");
    if let Some(token) = token {
        builder = builder.header("authorization", format!("Bearer {token}"));
    }
    if let Some(profile) = profile {
        builder = builder.header("x-tardy-profile-id", profile);
    }
    let response = app
        .clone()
        .oneshot(builder.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let value = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes)
            .unwrap_or_else(|_| panic!("{status}: {}", String::from_utf8_lossy(&bytes)))
    };
    assert!(status.is_success(), "{status}: {value}");
    (status, value)
}
