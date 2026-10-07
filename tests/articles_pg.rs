use tardy::social::{Article, IdentityKind, PgSocialStore, PostVisibility, SocialError};
use uuid::Uuid;

#[tokio::test]
async fn articles_are_idempotent_searchable_and_obey_existing_visibility() {
    let url = std::env::var("TEST_DATABASE_URL")
        .expect("article integration test requires an isolated PG17 database");
    let pool = sqlx::PgPool::connect(&url).await.unwrap();
    sqlx::migrate!().run(&pool).await.unwrap();
    let store = PgSocialStore::new(pool.clone());
    let owner = Uuid::new_v4();
    let actor = Uuid::new_v4();
    let stranger = Uuid::new_v4();
    let suffix = Uuid::new_v4().simple().to_string();
    store
        .register_identity(
            owner,
            actor,
            &format!("writer{}", &suffix[..8]),
            IdentityKind::Human,
            "Writer",
            "",
        )
        .await
        .unwrap();
    store
        .register_identity(
            Uuid::new_v4(),
            stranger,
            &format!("reader{}", &suffix[..8]),
            IdentityKind::Human,
            "Reader",
            "",
        )
        .await
        .unwrap();
    let request = Uuid::new_v4();
    let article = Article {
        title: "An experiment".into(),
        markdown: "# Evidence\n\nPhotosynthesis was tested.\n\n```mermaid\ngraph TD; A-->B\n```"
            .into(),
        html: "must not persist".into(),
    };
    let post = store
        .publish_post_with_article(
            actor,
            request,
            "Read our findings",
            None,
            PostVisibility::Private,
            &[],
            Some(&article),
        )
        .await
        .unwrap();
    let retry = store
        .publish_post_with_article(
            actor,
            request,
            "Read our findings",
            None,
            PostVisibility::Private,
            &[],
            Some(&article),
        )
        .await
        .unwrap();
    assert_eq!(post.id, retry.id);
    let owned = store.app_post(Some(actor), post.id).await.unwrap();
    assert_eq!(owned.format, "article");
    assert_eq!(owned.article.as_ref().unwrap().markdown, article.markdown);
    assert!(owned.article.unwrap().html.contains("<h1>Evidence</h1>"));
    assert!(matches!(
        store.app_post(None, post.id).await,
        Err(SocialError::NotFound)
    ));
    assert!(matches!(
        store.app_post(Some(stranger), post.id).await,
        Err(SocialError::NotFound)
    ));
    assert!(
        !store
            .app_feed(None, 100)
            .await
            .unwrap()
            .iter()
            .any(|p| p.id == post.id)
    );
    assert!(
        store
            .search_app_posts(Some(stranger), "photosynthesis", 20)
            .await
            .unwrap()
            .iter()
            .all(|p| p.post.id != post.id)
    );
    let stored: serde_json::Value =
        sqlx::query_scalar("SELECT article FROM tardy_posts WHERE id=$1")
            .bind(post.id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(
        stored.get("html").is_none(),
        "derived HTML has one source of truth"
    );
    assert!(matches!(
        store
            .set_post_visibility(stranger, post.id, PostVisibility::Public)
            .await,
        Err(SocialError::NotFound)
    ));
    store
        .set_post_visibility(actor, post.id, PostVisibility::Public)
        .await
        .unwrap();
    assert!(
        store
            .app_post(None, post.id)
            .await
            .unwrap()
            .article
            .is_some()
    );
    assert!(
        store
            .app_posts(None, Some(actor), 100)
            .await
            .unwrap()
            .iter()
            .any(|p| p.id == post.id)
    );
    assert!(
        store
            .search_app_posts(None, "photosynthesis", 20)
            .await
            .unwrap()
            .iter()
            .any(|p| p.post.id == post.id)
    );
    store
        .set_post_visibility(actor, post.id, PostVisibility::Private)
        .await
        .unwrap();
    assert!(matches!(
        store.app_post(None, post.id).await,
        Err(SocialError::NotFound)
    ));
}
