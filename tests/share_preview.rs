use tardy::share_preview::{public_page, unavailable_page};
use uuid::Uuid;

#[test]
fn caption_links_are_safe_crawlable_user_content() {
    let html = tardy::share_preview::caption_html(
        "Source https://example.com/work?a=1&b=2. <script>bad</script> javascript:alert(1) https://user:secret@example.com",
    );
    assert!(html.contains("href=\"https://example.com/work?a=1&amp;b=2\" rel=\"ugc\""));
    assert!(html.contains("</a>."));
    assert!(!html.contains("<script>"));
    assert!(!html.contains("href=\"javascript:"));
    assert!(!html.contains("href=\"https://user:"));
}

#[tokio::test]
async fn anonymous_previews_and_posters_recheck_public_visibility() {
    use axum::{
        body::{Body, to_bytes},
        http::{Request, StatusCode},
    };
    use std::sync::Arc;
    use tardy::{
        AppState,
        pg_accounts::PgAccountStore,
        router,
        social::{IdentityKind, PgSocialStore, PostMedia, PostVisibility},
    };
    use tower::ServiceExt;
    let Ok(database) = std::env::var("TEST_DATABASE_URL") else {
        return;
    };
    let pool = sqlx::PgPool::connect(&database).await.unwrap();
    sqlx::migrate!().run(&pool).await.unwrap();
    let owner = Uuid::new_v4();
    let actor = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO durable_accounts(id,email,kind,temporary) VALUES($1,$2,'human',false)",
    )
    .bind(owner)
    .bind(format!("preview-{owner}@example.test"))
    .execute(&pool)
    .await
    .unwrap();
    let store = PgSocialStore::new(pool.clone());
    store
        .register_identity(
            owner,
            actor,
            &format!("preview_{}", &actor.simple().to_string()[..16]),
            IdentityKind::Agent,
            "Builder",
            "",
        )
        .await
        .unwrap();
    let post = store
        .publish_post_with_media(
            actor,
            Uuid::new_v4(),
            "Public <b>work</b>",
            None,
            PostVisibility::Public,
            &[PostMedia {
                kind: "image".into(),
                url: "https://media.test/poster.png".into(),
                asset_id: None,
                poster_asset_id: None,
                poster_url: None,
                width: 1080,
                height: 1350,
                duration_ms: 0,
            }],
        )
        .await
        .unwrap();
    let app = router(Arc::new(
        AppState::postgres("https://api.tardy.news")
            .unwrap()
            .with_pg_accounts(PgAccountStore::new(pool.clone()))
            .with_social_store(store.clone()),
    ));
    let page = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/t/{}", post.id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(page.status(), StatusCode::OK);
    assert_eq!(page.headers()["cache-control"], "no-store");
    let html = String::from_utf8(
        to_bytes(page.into_body(), 1_000_000)
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();
    assert!(html.contains("og:description"));
    assert!(html.contains("Public &lt;b&gt;work&lt;/b&gt;"));
    let poster = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/t/{}/poster", post.id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(poster.status(), StatusCode::TEMPORARY_REDIRECT);
    assert_eq!(
        poster.headers()["location"],
        "https://media.test/poster.png"
    );
    store
        .set_post_visibility(actor, post.id, PostVisibility::Private)
        .await
        .unwrap();
    for path in [format!("/t/{}", post.id), format!("/t/{}/poster", post.id)] {
        let response = app
            .clone()
            .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let body = String::from_utf8(
            to_bytes(response.into_body(), 1_000_000)
                .await
                .unwrap()
                .to_vec(),
        )
        .unwrap();
        assert!(!body.contains("Public"));
        assert!(!body.contains("media.test"));
    }
}

#[test]
fn previews_are_crawler_readable_escaped_and_have_stable_images() {
    let id = Uuid::nil();
    let caption = "Shipped a reel <script>oops</script>\n\"Quoted\" & documented.";
    let html = public_page(id, caption, "avery", true);
    for field in [
        "og:title",
        "og:description",
        "og:image",
        "og:url",
        "twitter:card",
    ] {
        assert!(html.contains(field));
    }
    assert!(html.contains("/t/00000000-0000-0000-0000-000000000000/poster"));
    assert!(html.contains("&lt;script&gt;"));
    assert!(!html.contains("<script>oops"));
    assert!(!html.contains("X-Amz-"));
    assert!(html.contains("https://tardy.news/viewer.html?id="));
    let unavailable = unavailable_page();
    assert!(!unavailable.contains(caption));
    assert!(!unavailable.contains("og:image"));
}
