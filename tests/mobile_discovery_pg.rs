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
    sqlx::query("TRUNCATE social_identities, durable_accounts CASCADE")
        .execute(&pool)
        .await
        .unwrap();
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
    assert!(profile["display_name"].is_string());
    assert!(profile["avatar_url"].is_string());
    assert!(profile["post_count"].is_number());
    assert!(profile.get("displayName").is_none());

    let by_handle = get(
        &app,
        "/v1/profiles/discovery_author",
        &viewer_token,
        viewer_id,
    )
    .await;
    assert_eq!(by_handle["id"], author_id.to_string());

    for route in [
        "/v1/feed",
        "/v1/explore",
        &format!("/v1/profiles/by-id/{author_id}/posts"),
    ] {
        let page = get(&app, route, &viewer_token, viewer_id).await;
        assert_eq!(page["next_cursor"], Value::Null);
        let items = page["items"].as_array().unwrap();
        assert!(
            items.iter().any(|post| post["id"] == public.id.to_string()),
            "{route} did not contain the public post: {page}"
        );
        let item = items
            .iter()
            .find(|post| post["id"] == public.id.to_string())
            .unwrap();
        assert_eq!(item["author_id"], author_id.to_string());
        assert!(item["created_at_ms"].is_number());
        assert!(item["viewer_has_saved"].is_boolean());
        assert!(item.get("authorId").is_none());
        assert!(
            !items
                .iter()
                .any(|post| post["caption"] == "Private work log")
        );
    }
    let reels = get(&app, "/v1/feed/reels", &viewer_token, viewer_id).await;
    assert!(reels["items"].is_array());
    assert_eq!(reels["next_cursor"], Value::Null);

    send(
        &app,
        "PUT",
        &format!("/v1/posts/{}/like", public.id),
        None,
        Some(&viewer_token),
        Some(viewer_id),
    )
    .await;
    let liked = get(&app, "/v1/feed", &viewer_token, viewer_id).await;
    let liked_post = liked["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|post| post["id"] == public.id.to_string())
        .unwrap();
    assert_eq!(liked_post["like_count"], 1);
    assert_eq!(liked_post["viewer_has_liked"], true);

    send(
        &app,
        "DELETE",
        &format!("/v1/posts/{}/like", public.id),
        None,
        Some(&viewer_token),
        Some(viewer_id),
    )
    .await;
    let unliked = get(&app, "/v1/feed", &viewer_token, viewer_id).await;
    let unliked_post = unliked["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|post| post["id"] == public.id.to_string())
        .unwrap();
    assert_eq!(unliked_post["like_count"], 0);
    assert_eq!(unliked_post["viewer_has_liked"], false);

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
