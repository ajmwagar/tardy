//! Opt-in development gateway. No automatic local fallback or mutation replay.
use axum::{
    Json, Router,
    body::{Body, to_bytes},
    extract::{DefaultBodyLimit, Request, State},
    http::{HeaderMap, Method, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use serde_json::{Value, json};
use sqlx::PgPool;
use std::sync::Arc;
use uuid::Uuid;

const PRODUCTION: &str = "https://api.tardy.news";
const MAX_UPLOAD: usize = 250 << 20;
const MAX_CACHE: usize = 2 << 20;

pub struct DevOverlay {
    pool: PgPool,
    client: reqwest::Client,
    upstream: String,
}
impl DevOverlay {
    pub fn production(pool: PgPool) -> Result<Self, reqwest::Error> {
        Ok(Self {
            pool,
            upstream: PRODUCTION.to_owned(),
            client: reqwest::Client::builder()
                .connect_timeout(std::time::Duration::from_secs(10))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
        })
    }
}

pub fn router(state: Arc<DevOverlay>) -> Router {
    Router::new()
        .route("/v1/dev-overlay/status", get(|| async { Json(json!({"mode":"production-backed-dev", "upstream":PRODUCTION, "normal_writes":"production", "drafts":"local", "replay":false})) }))
        .route("/v1/dev-overlay/drafts", get(list_drafts).post(create_draft).layer(DefaultBodyLimit::max(1 << 20)))
        .fallback(forward)
        .layer(DefaultBodyLimit::max(MAX_UPLOAD))
        .layer(axum::middleware::map_response(|mut response: Response| async move {
            // Private responses/drafts must never enter a browser or URLSession cache.
            response.headers_mut().insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
            response
        }))
        .with_state(state)
}

fn cacheable(method: &Method, path: &str, headers: &HeaderMap) -> bool {
    method == Method::GET
        && !headers.contains_key(header::AUTHORIZATION)
        && !headers.contains_key(header::COOKIE)
        && !headers.contains_key("x-tardy-profile-id")
        && path
            .strip_prefix("/v1/public/posts/")
            .is_some_and(|id| Uuid::parse_str(id).is_ok())
}

fn forward_header(name: &str) -> bool {
    matches!(
        name,
        "authorization"
            | "content-type"
            | "accept"
            | "x-tardy-profile-id"
            | "last-event-id"
            | "range"
            | "if-none-match"
            | "if-modified-since"
            | "payment-signature"
            | "x-payment"
            | "idempotency-key"
    )
}

fn failure(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({"error":message}))).into_response()
}

async fn forward(State(state): State<Arc<DevOverlay>>, request: Request) -> Response {
    let (parts, body) = request.into_parts();
    let path = parts
        .uri
        .path_and_query()
        .map(|p| p.as_str())
        .unwrap_or("/");
    if !parts.uri.path().starts_with("/v1/")
        && !matches!(parts.uri.path(), "/healthz" | "/readyz" | "/openapi.json")
    {
        return failure(StatusCode::NOT_FOUND, "Unknown dev gateway route");
    }
    // Unknown overlay endpoints never fall through into production.
    if parts.uri.path().starts_with("/v1/dev-overlay/") || parts.uri.path().starts_with("/v1/dev/")
    {
        return failure(
            StatusCode::NOT_FOUND,
            "Local test features require explicit overlay routes; no fallback",
        );
    }
    let cached = cacheable(&parts.method, path, &parts.headers);
    if cached {
        match sqlx::query_as::<_, (Vec<u8>, String)>(
            "SELECT body, content_type FROM dev_public_cache WHERE path=$1 AND expires_at>now()",
        )
        .bind(path)
        .fetch_optional(&state.pool)
        .await
        {
            Ok(Some((bytes, mime))) => {
                return (
                    [
                        (header::CONTENT_TYPE, mime),
                        (
                            header::HeaderName::from_static("x-tardy-dev-overlay"),
                            "public-cache".into(),
                        ),
                    ],
                    bytes,
                )
                    .into_response();
            }
            Ok(None) => {}
            Err(_) => {
                return failure(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "Local public cache database unavailable",
                );
            }
        }
    }
    let bytes = match to_bytes(body, MAX_UPLOAD).await {
        Ok(bytes) => bytes,
        Err(_) => {
            return failure(
                StatusCode::PAYLOAD_TOO_LARGE,
                "Upload exceeds dev gateway limit",
            );
        }
    };
    let mut upstream = state
        .client
        .request(parts.method, format!("{}{path}", state.upstream));
    for (name, value) in &parts.headers {
        if forward_header(name.as_str()) {
            upstream = upstream.header(name, value);
        }
    }
    let response = match upstream.body(bytes).send().await {
        Ok(response) => response,
        Err(_) => {
            return failure(
                StatusCode::BAD_GATEWAY,
                "Production unavailable; no local fallback or queued write",
            );
        }
    };
    let status = response.status();
    let headers = response.headers().clone();
    let mime = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_owned();
    let cache_response = cached
        && status == StatusCode::OK
        && mime.starts_with("application/json")
        && !headers.contains_key(header::SET_COOKIE)
        && !headers
            .get(header::CACHE_CONTROL)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.contains("no-store") || v.contains("private"));
    let body = if cache_response {
        // Bound cacheable responses; streams and private responses are never buffered/cached.
        let mut stream = response.bytes_stream();
        use tokio_stream::StreamExt;
        let mut bytes = Vec::new();
        while let Some(chunk) = stream.next().await {
            match chunk {
                Ok(chunk) if bytes.len() + chunk.len() <= MAX_CACHE => {
                    bytes.extend_from_slice(&chunk)
                }
                _ => {
                    return failure(
                        StatusCode::BAD_GATEWAY,
                        "Public response exceeded cache limit or was interrupted",
                    );
                }
            }
        }
        if sqlx::query("INSERT INTO dev_public_cache(path,body,content_type,expires_at) VALUES($1,$2,$3,now()+interval '15 seconds') ON CONFLICT(path) DO UPDATE SET body=EXCLUDED.body,content_type=EXCLUDED.content_type,expires_at=EXCLUDED.expires_at")
            .bind(path).bind(&bytes).bind(&mime).execute(&state.pool).await.is_err() {
            return failure(StatusCode::SERVICE_UNAVAILABLE, "Could not persist public cache");
        }
        Body::from(bytes)
    } else {
        Body::from_stream(response.bytes_stream())
    };
    let mut result = Response::new(body);
    *result.status_mut() = status;
    for name in [
        header::CONTENT_TYPE,
        header::CACHE_CONTROL,
        header::ETAG,
        header::CONTENT_RANGE,
        header::ACCEPT_RANGES,
        header::RETRY_AFTER,
        header::WWW_AUTHENTICATE,
        header::LOCATION,
        header::HeaderName::from_static("payment-required"),
        header::HeaderName::from_static("payment-response"),
    ] {
        if let Some(value) = headers.get(&name) {
            result.headers_mut().insert(name, value.clone());
        }
    }
    result
        .headers_mut()
        .insert("x-tardy-dev-overlay", "production".parse().unwrap());
    result
}

async fn owner(state: &DevOverlay, headers: &HeaderMap) -> Result<Uuid, Response> {
    let token = headers
        .get(header::AUTHORIZATION)
        .ok_or_else(|| failure(StatusCode::UNAUTHORIZED, "Production sign-in required"))?;
    let response = state
        .client
        .get(format!("{}/v1/session", state.upstream))
        .header(header::AUTHORIZATION, token)
        .send()
        .await
        .map_err(|_| {
            failure(
                StatusCode::BAD_GATEWAY,
                "Production identity verification unavailable",
            )
        })?;
    if !response.status().is_success() {
        return Err(failure(response.status(), "Production session rejected"));
    }
    let session: Value = response
        .json()
        .await
        .map_err(|_| failure(StatusCode::BAD_GATEWAY, "Invalid production session"))?;
    session
        .pointer("/account/id")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
        .ok_or_else(|| {
            failure(
                StatusCode::BAD_GATEWAY,
                "Production session missing profile identity",
            )
        })
}

async fn list_drafts(
    State(state): State<Arc<DevOverlay>>,
    headers: HeaderMap,
) -> Result<Json<Value>, Response> {
    let owner = owner(&state, &headers).await?;
    let rows = sqlx::query_as::<_, (Uuid, Value)>("SELECT id, document FROM dev_overlay_drafts WHERE owner_profile_id=$1 ORDER BY created_at DESC LIMIT 100")
        .bind(owner).fetch_all(&state.pool).await.map_err(|_| failure(StatusCode::SERVICE_UNAVAILABLE, "Local drafts unavailable"))?;
    Ok(Json(
        json!({"scope":"local", "items":rows.into_iter().map(|(id,document)| json!({"id":id,"document":document})).collect::<Vec<_>>()}),
    ))
}

async fn create_draft(
    State(state): State<Arc<DevOverlay>>,
    headers: HeaderMap,
    Json(document): Json<Value>,
) -> Result<(StatusCode, Json<Value>), Response> {
    let owner = owner(&state, &headers).await?;
    if serde_json::to_vec(&document).map_or(true, |b| b.len() > 1 << 20) {
        return Err(failure(
            StatusCode::PAYLOAD_TOO_LARGE,
            "Draft limit is 1 MiB",
        ));
    }
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO dev_overlay_drafts(id,owner_profile_id,document) VALUES($1,$2,$3)")
        .bind(id)
        .bind(owner)
        .bind(document)
        .execute(&state.pool)
        .await
        .map_err(|_| {
            failure(
                StatusCode::SERVICE_UNAVAILABLE,
                "Could not save local draft",
            )
        })?;
    Ok((
        StatusCode::CREATED,
        Json(json!({"id":id,"scope":"local","published":false})),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tower::ServiceExt;

    async fn fixture(upstream: Router, pool: PgPool) -> (Router, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            axum::serve(listener, upstream).await.unwrap();
        });
        let mut state = DevOverlay::production(pool).unwrap();
        state.upstream = format!("http://{address}");
        (router(Arc::new(state)), task)
    }

    fn unused_pool() -> PgPool {
        sqlx::postgres::PgPoolOptions::new()
            .connect_lazy("postgresql://localhost/never_connect")
            .unwrap()
    }

    #[tokio::test]
    #[ignore = "requires a dedicated local PG17 database in TARDY_DEV_OVERLAY_TEST_DATABASE_URL"]
    async fn pg_public_cache_hits_expire_and_never_cache_authenticated_reads() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let pool = PgPool::connect(&std::env::var("TARDY_DEV_OVERLAY_TEST_DATABASE_URL").unwrap())
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let count = Arc::new(AtomicUsize::new(0));
        let upstream_count = count.clone();
        let id = Uuid::new_v4();
        let path = format!("/v1/public/posts/{id}");
        let upstream = Router::new().route(
            &path,
            get(move || {
                let count = upstream_count.clone();
                async move {
                    count.fetch_add(1, Ordering::SeqCst);
                    Json(json!({"id":id,"visibility":"public"}))
                }
            }),
        );
        let (app, task) = fixture(upstream, pool.clone()).await;
        for expected in ["production", "public-cache"] {
            let response = app
                .clone()
                .oneshot(Request::builder().uri(&path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(response.headers()["x-tardy-dev-overlay"], expected);
        }
        assert_eq!(count.load(Ordering::SeqCst), 1);
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(&path)
                    .header("authorization", "Bearer test")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.headers()["x-tardy-dev-overlay"], "production");
        assert_eq!(count.load(Ordering::SeqCst), 2);
        sqlx::query(
            "UPDATE dev_public_cache SET expires_at=now()-interval '1 second' WHERE path=$1",
        )
        .bind(&path)
        .execute(&pool)
        .await
        .unwrap();
        let response = app
            .oneshot(Request::builder().uri(&path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.headers()["x-tardy-dev-overlay"], "production");
        assert_eq!(count.load(Ordering::SeqCst), 3);
        sqlx::query("DELETE FROM dev_public_cache WHERE path=$1")
            .bind(&path)
            .execute(&pool)
            .await
            .unwrap();
        task.abort();
    }

    #[tokio::test]
    async fn forwards_mutations_and_preserves_auth_failure_without_local_database() {
        let upstream = Router::new()
            .route(
                "/v1/test-write",
                axum::routing::patch(|headers: HeaderMap, Json(body): Json<Value>| async move {
                    assert_eq!(headers.get(header::AUTHORIZATION).unwrap(), "Bearer test");
                    assert!(headers.get("x-api-key").is_none());
                    assert_eq!(body["caption"], "test caption");
                    (StatusCode::ACCEPTED, Json(json!({"accepted":true})))
                }),
            )
            .route(
                "/v1/session",
                get(|| async { failure(StatusCode::UNAUTHORIZED, "expired") }),
            );
        let (app, task) = fixture(upstream, unused_pool()).await;
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::PATCH)
                    .uri("/v1/test-write")
                    .header("authorization", "Bearer test")
                    .header("x-api-key", "must-not-forward")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"caption":"test caption"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::ACCEPTED);
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/v1/session")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        task.abort();
    }

    #[tokio::test]
    async fn unavailable_production_does_not_turn_a_write_into_a_draft() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        let mut state = DevOverlay::production(unused_pool()).unwrap();
        state.upstream = format!("http://{address}");
        let response = router(Arc::new(state))
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/v1/posts")
                    .body(Body::from("draft must not be created"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    }

    #[tokio::test]
    async fn streams_conversation_events_without_private_cache() {
        let upstream = Router::new().route(
            "/v1/social/conversations/test/events",
            get(|| async {
                (
                    [(header::CONTENT_TYPE, "text/event-stream")],
                    Body::from_stream(tokio_stream::iter([
                        Ok::<_, std::io::Error>("event: draft\ndata: first\n\n"),
                        Ok("event: draft\ndata: second\n\n"),
                    ])),
                )
            }),
        );
        let (app, task) = fixture(upstream, unused_pool()).await;
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/v1/social/conversations/test/events")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            response.headers()[header::CONTENT_TYPE],
            "text/event-stream"
        );
        let bytes = to_bytes(response.into_body(), 1024).await.unwrap();
        assert_eq!(
            bytes.as_ref(),
            b"event: draft\ndata: first\n\nevent: draft\ndata: second\n\n"
        );
        task.abort();
    }

    #[tokio::test]
    #[ignore = "requires a dedicated local PG17 database in TARDY_DEV_OVERLAY_TEST_DATABASE_URL"]
    async fn pg_drafts_are_scoped_to_verified_owner_not_caller_profile_header() {
        let database = std::env::var("TARDY_DEV_OVERLAY_TEST_DATABASE_URL").unwrap();
        let pool = PgPool::connect(&database).await.unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let first = Uuid::new_v4();
        let second = Uuid::new_v4();
        let upstream = Router::new().route(
            "/v1/session",
            get(move |headers: HeaderMap| async move {
                let owner = match headers
                    .get(header::AUTHORIZATION)
                    .and_then(|v| v.to_str().ok())
                {
                    Some("Bearer first") => first,
                    Some("Bearer second") => second,
                    _ => return failure(StatusCode::UNAUTHORIZED, "invalid"),
                };
                Json(json!({"account":{"id":owner}})).into_response()
            }),
        );
        let (app, task) = fixture(upstream, pool.clone()).await;
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/v1/dev-overlay/drafts")
                    .header("authorization", "Bearer first")
                    .header("x-tardy-profile-id", second.to_string())
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"caption":"local only"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
        for (token, count) in [("Bearer first", 1), ("Bearer second", 0)] {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .uri("/v1/dev-overlay/drafts")
                        .header("authorization", token)
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            let bytes = to_bytes(response.into_body(), 4096).await.unwrap();
            let body: Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(body["items"].as_array().unwrap().len(), count);
        }
        sqlx::query("DELETE FROM dev_overlay_drafts WHERE owner_profile_id=$1")
            .bind(first)
            .execute(&pool)
            .await
            .unwrap();
        task.abort();
    }
    #[test]
    fn caches_only_exact_anonymous_public_reads() {
        let path = format!("/v1/public/posts/{}", Uuid::new_v4());
        let mut headers = HeaderMap::new();
        assert!(cacheable(&Method::GET, &path, &headers));
        for path in [
            "/v1/session",
            "/v1/feed",
            "/v1/social/conversations",
            "/v1/public/posts/not-an-id",
        ] {
            assert!(!cacheable(&Method::GET, path, &headers));
        }
        assert!(!cacheable(&Method::POST, &path, &headers));
        for name in ["authorization", "cookie", "x-tardy-profile-id"] {
            headers.insert(
                header::HeaderName::from_bytes(name.as_bytes()).unwrap(),
                "secret".parse().unwrap(),
            );
            assert!(!cacheable(&Method::GET, &path, &headers));
            headers.clear();
        }
    }
    #[test]
    fn never_forwards_origin_or_arbitrary_credentials() {
        for name in [
            "host",
            "cookie",
            "connection",
            "x-api-key",
            "proxy-authorization",
        ] {
            assert!(!forward_header(name));
        }
        assert!(forward_header("authorization"));
        assert!(forward_header("range"));
    }
    #[tokio::test]
    async fn rejects_dev_auth_and_unauthenticated_drafts_without_database_access() {
        use tower::ServiceExt;
        let pool = sqlx::postgres::PgPoolOptions::new()
            .connect_lazy("postgresql://localhost/never_connect")
            .unwrap();
        let app = router(Arc::new(DevOverlay::production(pool).unwrap()));
        for (method, path, status) in [
            (Method::POST, "/v1/dev/session", StatusCode::NOT_FOUND),
            (
                Method::GET,
                "/v1/dev-overlay/unknown",
                StatusCode::NOT_FOUND,
            ),
            (
                Method::GET,
                "/v1/dev-overlay/drafts",
                StatusCode::UNAUTHORIZED,
            ),
            (Method::GET, "/v1/dev-overlay/status", StatusCode::OK),
        ] {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method(method)
                        .uri(path)
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), status, "{path}");
        }
    }
}
