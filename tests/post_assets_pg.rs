use async_trait::async_trait;
use axum::{
    body::{Body, to_bytes},
    http::Request,
};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};
use tardy::{
    AppState,
    media::{MediaError, MediaService, ObjectMetadata, ObjectStore},
    pg_accounts::PgAccountStore,
    router,
    social::PgSocialStore,
};
use tower::ServiceExt;
use uuid::Uuid;

struct SigningStore(AtomicU64);
#[async_trait]
impl ObjectStore for SigningStore {
    async fn presign_put(
        &self,
        _: &str,
        _: &str,
        _: u64,
        _: Option<&str>,
        _: Duration,
    ) -> Result<(String, String, BTreeMap<String, String>), MediaError> {
        Ok((
            "PUT".into(),
            "https://media.test/upload".into(),
            BTreeMap::new(),
        ))
    }
    async fn head(&self, _: &str) -> Result<ObjectMetadata, MediaError> {
        unreachable!()
    }
    async fn presign_get(&self, key: &str, _: Duration) -> Result<String, MediaError> {
        Ok(format!(
            "https://media.test/{key}?generation={}",
            self.0.fetch_add(1, Ordering::SeqCst)
        ))
    }
}

async fn request(
    app: &axum::Router,
    method: &str,
    path: &str,
    body: Value,
    token: Option<&str>,
    profile: Option<&str>,
) -> (u16, Value) {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
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
    let status = response.status().as_u16();
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}

#[tokio::test]
async fn posts_store_identity_refresh_urls_and_reject_foreign_assets() {
    let url = std::env::var("TEST_DATABASE_URL").expect("isolated PG17 TEST_DATABASE_URL required");
    let pool = sqlx::PgPool::connect(&url).await.unwrap();
    sqlx::migrate!().run(&pool).await.unwrap();
    let state = AppState::postgres("https://tardy.test")
        .unwrap()
        .with_pg_accounts(PgAccountStore::new(pool.clone()))
        .with_social_store(PgSocialStore::new(pool.clone()))
        .with_media_service(MediaService::with_pool(
            Some(Arc::new(SigningStore(AtomicU64::new(0)))),
            pool.clone(),
        ));
    let app = router(Arc::new(state));
    let (status, registration) = request(
        &app,
        "POST",
        "/v1/onboarding/tardies",
        json!({}),
        None,
        None,
    )
    .await;
    assert_eq!(status, 201);
    let token = registration["api_token"].as_str().unwrap();
    let (_, profile) = request(&app, "POST", "/v1/profiles", json!({"handle":format!("asset_{}", &Uuid::new_v4().simple().to_string()[..12]),"kind":"agent","display_name":"Asset test"}), Some(token), None).await;
    let author = profile["id"].as_str().unwrap();
    let asset_id = Uuid::new_v4();
    let key = format!("quarantine/{author}/video/{asset_id}");
    sqlx::query("INSERT INTO media_assets (id,profile_id,kind,object_key,content_type,byte_length,status) VALUES ($1,$2,'video_original',$3,'video/mp4',42,'ready')")
        .bind(asset_id).bind(Uuid::parse_str(author).unwrap()).bind(&key).execute(&pool).await.unwrap();
    let body = json!({"client_request_id":Uuid::new_v4(),"caption":"Asset identity test","visibility":"private","shared_link_id":null,"media":[{"type":"video","asset_id":asset_id,"width":1080,"height":1920,"duration_ms":20000}]});
    let (status, created) = request(
        &app,
        "POST",
        "/v1/social/posts",
        body.clone(),
        Some(token),
        Some(author),
    )
    .await;
    assert_eq!(status, 201, "{created}");
    assert!(
        created["media"][0]["url"]
            .as_str()
            .unwrap()
            .starts_with("https://media.test/")
    );
    let post_id = created["id"].as_str().unwrap();
    let stored: Value = sqlx::query_scalar("SELECT media FROM tardy_posts WHERE id=$1")
        .bind(Uuid::parse_str(post_id).unwrap())
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(stored[0]["url"], format!("tardy-asset://{asset_id}"));
    assert_eq!(stored[0]["asset_id"], asset_id.to_string());
    let (status, retry) = request(
        &app,
        "POST",
        "/v1/social/posts",
        body.clone(),
        Some(token),
        Some(author),
    )
    .await;
    assert_eq!(status, 201);
    assert_eq!(retry["id"], created["id"]);
    let (_, first) = request(
        &app,
        "GET",
        &format!("/v1/posts/{post_id}"),
        Value::Null,
        Some(token),
        Some(author),
    )
    .await;
    let (_, second) = request(
        &app,
        "GET",
        &format!("/v1/posts/{post_id}"),
        Value::Null,
        Some(token),
        Some(author),
    )
    .await;
    assert_ne!(first["media"][0]["url"], second["media"][0]["url"]);
    assert_eq!(second["media"][0]["poster_url"], second["media"][0]["url"]);
    let (_, stranger) = request(
        &app,
        "POST",
        "/v1/onboarding/tardies",
        json!({}),
        None,
        None,
    )
    .await;
    let stranger_token = stranger["api_token"].as_str().unwrap();
    let (_, stranger_profile) = request(&app, "POST", "/v1/profiles", json!({"handle":format!("other_{}", &Uuid::new_v4().simple().to_string()[..12]),"kind":"agent","display_name":"Other"}), Some(stranger_token), None).await;
    let (status, _) = request(
        &app,
        "POST",
        "/v1/social/posts",
        body,
        Some(stranger_token),
        stranger_profile["id"].as_str(),
    )
    .await;
    assert_eq!(status, 403);
    let (status, _) = request(
        &app,
        "GET",
        &format!("/v1/posts/{post_id}"),
        Value::Null,
        Some(stranger_token),
        stranger_profile["id"].as_str(),
    )
    .await;
    assert!(status == 403 || status == 404);
    // Old presigned URL rows recover through author-owned object metadata only.
    let legacy_url =
        format!("https://account.r2.cloudflarestorage.com/media/{key}?X-Amz-Signature=expired");
    sqlx::query("UPDATE tardy_posts SET media=$2 WHERE id=$1").bind(Uuid::parse_str(post_id).unwrap()).bind(json!([{"type":"video","url":legacy_url,"poster_url":null,"width":1080,"height":1920,"duration_ms":20000}])).execute(&pool).await.unwrap();
    let (status, recovered) = request(
        &app,
        "GET",
        &format!("/v1/posts/{post_id}"),
        Value::Null,
        Some(token),
        Some(author),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(recovered["media"][0]["asset_id"], asset_id.to_string());
    assert!(
        recovered["media"][0]["url"]
            .as_str()
            .unwrap()
            .starts_with("https://media.test/")
    );
    let pending_id = Uuid::new_v4();
    let pending_key = format!("quarantine/{author}/video/{pending_id}");
    sqlx::query("INSERT INTO media_assets (id,profile_id,kind,object_key,content_type,byte_length,status) VALUES ($1,$2,'video_original',$3,'video/mp4',42,'quarantined')")
        .bind(pending_id).bind(Uuid::parse_str(author).unwrap()).bind(&pending_key).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO media_upload_sessions (id,profile_id,kind,object_key,content_type,byte_length,expires_at,completed_asset_id) VALUES ($1,$2,'video_original',$3,'video/mp4',42,now()+interval '15 minutes',$1)")
        .bind(pending_id).bind(Uuid::parse_str(author).unwrap()).bind(&pending_key).execute(&pool).await.unwrap();
    let (status, pending) = request(
        &app,
        "POST",
        &format!("/v1/uploads/{pending_id}/complete"),
        json!({}),
        Some(token),
        Some(author),
    )
    .await;
    assert_eq!(status, 202);
    assert_eq!(pending["status"], "quarantined");
    assert!(pending["url"].is_null());
}
