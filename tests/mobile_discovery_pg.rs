use axum::{
    body::{Body, to_bytes},
    http::Request,
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
async fn mobile_profile_and_discovery_routes_match_the_wire_contract() {
    let Ok(url) = std::env::var("TEST_DATABASE_URL") else {
        return;
    };
    let pool = sqlx::PgPool::connect(&url).await.unwrap();
    sqlx::migrate!().run(&pool).await.unwrap();
    let social = PgSocialStore::new(pool.clone());
    let app = router(Arc::new(
        AppState::postgres("https://tardy.test")
            .unwrap()
            .with_pg_accounts(PgAccountStore::new(pool))
            .with_social_store(social.clone()),
    ));

    let (author_token, author_id) = register_agent(&app, "discovery_author").await;
    let (viewer_token, viewer_id) = register_agent(&app, "discovery_viewer").await;
    let public = social
        .publish_post(
            author_id,
            Uuid::new_v4(),
            "Public launch update",
            None,
            PostVisibility::Public,
        )
        .await
        .unwrap();
    social
        .publish_post(
            author_id,
            Uuid::new_v4(),
            "Private work log",
            None,
            PostVisibility::Private,
        )
        .await
        .unwrap();

    let profile = get(
        &app,
        &format!("/v1/profiles/by-id/{author_id}"),
        &viewer_token,
        viewer_id,
    )
    .await;
    assert_eq!(profile["id"], author_id.to_string());
    assert_eq!(profile["handle"], "discovery_author");

    let by_handle = get(
        &app,
        "/v1/profiles/discovery_author",
        &viewer_token,
        viewer_id,
    )
    .await;
    assert_eq!(by_handle["id"], author_id.to_string());

    for route in [
        "/v1/feed/reels",
        "/v1/explore",
        &format!("/v1/profiles/by-id/{author_id}/posts"),
    ] {
        let page = get(&app, route, &viewer_token, viewer_id).await;
        assert_eq!(page["nextCursor"], Value::Null);
        let items = page["items"].as_array().unwrap();
        assert!(items.iter().any(|post| post["id"] == public.id.to_string()));
        assert!(
            !items
                .iter()
                .any(|post| post["caption"] == "Private work log")
        );
    }

    let own = get(
        &app,
        &format!("/v1/profiles/by-id/{author_id}/posts"),
        &author_token,
        author_id,
    )
    .await;
    assert!(
        own["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|post| post["caption"] == "Private work log")
    );
}

async fn register_agent(app: &axum::Router, handle: &str) -> (String, Uuid) {
    let registration = post(app, "/v1/onboarding/tardies", json!({}), None, None).await;
    let token = registration["api_token"].as_str().unwrap().to_owned();
    let profile = post(
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

async fn get(app: &axum::Router, uri: &str, token: &str, profile: Uuid) -> Value {
    send(app, "GET", uri, None, Some(token), Some(profile)).await
}

async fn post(
    app: &axum::Router,
    uri: &str,
    body: Value,
    token: Option<&str>,
    profile: Option<Uuid>,
) -> Value {
    send(app, "POST", uri, Some(body), token, profile).await
}

async fn send(
    app: &axum::Router,
    method: &str,
    uri: &str,
    body: Option<Value>,
    token: Option<&str>,
    profile: Option<Uuid>,
) -> Value {
    let mut request = Request::builder().method(method).uri(uri);
    if body.is_some() {
        request = request.header("content-type", "application/json");
    }
    if let Some(token) = token {
        request = request.header("authorization", format!("Bearer {token}"));
    }
    if let Some(profile) = profile {
        request = request.header("x-tardy-profile-id", profile.to_string());
    }
    let response = app
        .clone()
        .oneshot(
            request
                .body(Body::from(
                    body.map(|value| value.to_string()).unwrap_or_default(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let value: Value = serde_json::from_slice(&bytes).unwrap_or_else(|_| json!({}));
    assert!(status.is_success(), "{method} {uri}: {status} {value}");
    value
}
