use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use std::sync::Arc;
use tardy::{AppState, pg_accounts::PgAccountStore, router, social::PgSocialStore};
use tower::ServiceExt;
use uuid::Uuid;

#[tokio::test]
async fn authenticated_mcp_posts_one_idempotent_agent_update() {
    let Ok(url) = std::env::var("TEST_DATABASE_URL") else {
        return;
    };
    let pool = sqlx::PgPool::connect(&url).await.unwrap();
    sqlx::migrate!().run(&pool).await.unwrap();
    sqlx::query("TRUNCATE comment_mentions,post_comments,tardy_posts,conversation_agent_grants,conversation_messages,conversation_participants,conversations,profile_follows,social_identities,shared_links,webhook_deliveries,feed_subscriptions,feed_events,outbox,durable_ai_consents,profile_actors,profile_ownership,durable_claim_codes,account_api_tokens,durable_accounts RESTART IDENTITY CASCADE").execute(&pool).await.unwrap();
    let app = router(Arc::new(
        AppState::postgres("https://tardy.test")
            .unwrap()
            .with_pg_accounts(PgAccountStore::new(pool.clone()))
            .with_social_store(PgSocialStore::new(pool.clone())),
    ));

    let registration = rest(&app, "/v1/onboarding/tardies", json!({}), None, None).await;
    let token = registration["api_token"].as_str().unwrap();
    let profile = rest(
        &app,
        "/v1/profiles",
        json!({"handle":"mcp_agent","display_name":"MCP Agent","kind":"agent"}),
        Some(token),
        None,
    )
    .await;
    let profile_id = profile["id"].as_str().unwrap();

    let listed = mcp(
        &app,
        json!({"jsonrpc":"2.0","id":1,"method":"tools/list"}),
        None,
        None,
    )
    .await;
    assert_eq!(listed["result"]["tools"].as_array().unwrap().len(), 2);

    let unauthorized = mcp(
        &app,
        json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"tardy_status","arguments":{}}}),
        None,
        None,
    ).await;
    assert_eq!(unauthorized["error"]["code"], -32001);

    let malformed = mcp(
        &app,
        json!({"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"tardy_post_update","arguments":{"caption":"no request id"}}}),
        Some(token),
        None,
    )
    .await;
    assert_eq!(malformed["result"]["isError"], true);
    assert!(
        malformed["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("client_request_id")
    );

    let request_id = Uuid::new_v4();
    let call = json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"tardy_post_update","arguments":{
        "client_request_id":request_id,
        "caption":"Shipped the authenticated MCP posting loop. #agents",
        "visibility":"public"
    }}});
    let first = mcp(&app, call.clone(), Some(token), None).await;
    let retry = mcp(&app, call, Some(token), None).await;
    assert_eq!(
        first["result"]["structuredContent"]["id"],
        retry["result"]["structuredContent"]["id"]
    );
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM tardy_posts WHERE author_profile_id=$1")
            .bind(Uuid::parse_str(profile_id).unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, 1);

    let feed = get(&app, "/v1/feed", Some(token), Some(profile_id)).await;
    assert_eq!(
        feed["items"][0]["id"],
        first["result"]["structuredContent"]["id"]
    );
    assert_eq!(
        feed["items"][0]["caption"],
        "Shipped the authenticated MCP posting loop. #agents"
    );
    let accounts = get(
        &app,
        &format!("/v1/profiles?ids={profile_id}"),
        Some(token),
        None,
    )
    .await;
    assert_eq!(accounts[0]["handle"], "mcp_agent");
}

async fn rest(
    app: &axum::Router,
    uri: &str,
    body: Value,
    token: Option<&str>,
    profile: Option<&str>,
) -> Value {
    send(app, uri, body, token, profile).await.1
}

async fn mcp(app: &axum::Router, body: Value, token: Option<&str>, profile: Option<&str>) -> Value {
    send(app, "/mcp", body, token, profile).await.1
}

async fn get(app: &axum::Router, uri: &str, token: Option<&str>, profile: Option<&str>) -> Value {
    let mut request = Request::builder().method("GET").uri(uri);
    if let Some(token) = token {
        request = request.header("authorization", format!("Bearer {token}"));
    }
    if let Some(profile) = profile {
        request = request.header("x-tardy-profile-id", profile);
    }
    let response = app
        .clone()
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let value = serde_json::from_slice(&bytes).unwrap();
    assert!(status.is_success(), "{status}: {value}");
    value
}

async fn send(
    app: &axum::Router,
    uri: &str,
    body: Value,
    token: Option<&str>,
    profile: Option<&str>,
) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method("POST")
        .uri(uri)
        .header("content-type", "application/json");
    if let Some(token) = token {
        request = request.header("authorization", format!("Bearer {token}"));
    }
    if let Some(profile) = profile {
        request = request.header("x-tardy-profile-id", profile);
    }
    let response = app
        .clone()
        .oneshot(request.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let value = serde_json::from_slice(&bytes).unwrap();
    assert!(status.is_success(), "{status}: {value}");
    (status, value)
}
