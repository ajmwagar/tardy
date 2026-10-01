use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use std::sync::Arc;
use tardy::{
    AppState,
    pg_accounts::PgAccountStore,
    router,
    social::{PgSocialStore, PostVisibility},
};
use tower::ServiceExt;
use uuid::Uuid;

#[tokio::test]
async fn engagement_batch_is_authenticated_validated_and_persisted() {
    let Ok(url) = std::env::var("TEST_DATABASE_URL") else {
        return;
    };
    let pool = sqlx::PgPool::connect(&url).await.unwrap();
    sqlx::migrate!().run(&pool).await.unwrap();
    let social = PgSocialStore::new(pool.clone());
    let app = router(Arc::new(
        AppState::postgres("https://tardy.test")
            .unwrap()
            .with_pg_accounts(PgAccountStore::new(pool.clone()))
            .with_social_store(social.clone()),
    ));
    let (token, viewer) = register_agent(&app, "engagement_viewer").await;
    let (_, author) = register_agent(&app, "engagement_author").await;
    let post = social
        .publish_post(
            author,
            Uuid::new_v4(),
            "Watch this",
            None,
            PostVisibility::Public,
        )
        .await
        .unwrap();

    let response = send(
        &app,
        json!({"actions":[
            {"type":"video_open","post_id":post.id},
            {"type":"vqv","post_id":post.id,"watched_ms":12000},
            {"type":"follow_author","author_id":author}
        ]}),
        Some(&token),
        Some(viewer),
    )
    .await;
    assert_eq!(response.0, StatusCode::ACCEPTED);
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM engagement_events WHERE viewer_profile_id=$1")
            .bind(viewer)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, 3);

    let invalid = send(
        &app,
        json!({"actions":[{"type":"vqv","post_id":post.id}]}),
        Some(&token),
        Some(viewer),
    )
    .await;
    assert_eq!(invalid.0, StatusCode::UNPROCESSABLE_ENTITY);

    let unauthenticated = send(&app, json!({"actions":[]}), None, None).await;
    assert_eq!(unauthenticated.0, StatusCode::UNAUTHORIZED);
}

async fn register_agent(app: &axum::Router, handle: &str) -> (String, Uuid) {
    let registration = request(app, "/v1/onboarding/tardies", json!({}), None, None).await;
    let token = registration["api_token"].as_str().unwrap().to_owned();
    let profile = request(
        app,
        "/v1/profiles",
        json!({"handle":handle,"display_name":handle,"kind":"agent"}),
        Some(&token),
        None,
    )
    .await;
    (
        token,
        Uuid::parse_str(profile["id"].as_str().unwrap()).unwrap(),
    )
}

async fn request(
    app: &axum::Router,
    uri: &str,
    body: Value,
    token: Option<&str>,
    profile: Option<Uuid>,
) -> Value {
    let (status, value) = send_to(app, uri, body, token, profile).await;
    assert!(status.is_success(), "{uri}: {status} {value}");
    value
}

async fn send(
    app: &axum::Router,
    body: Value,
    token: Option<&str>,
    profile: Option<Uuid>,
) -> (StatusCode, Value) {
    send_to(app, "/v1/engagements", body, token, profile).await
}

async fn send_to(
    app: &axum::Router,
    uri: &str,
    body: Value,
    token: Option<&str>,
    profile: Option<Uuid>,
) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method("POST")
        .uri(uri)
        .header("content-type", "application/json");
    if let Some(token) = token {
        request = request.header("authorization", format!("Bearer {token}"));
    }
    if let Some(profile) = profile {
        request = request.header("x-tardy-profile-id", profile.to_string());
    }
    let response = app
        .clone()
        .oneshot(request.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, value)
}
