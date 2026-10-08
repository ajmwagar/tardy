use tardy::social::{BrandProfileInput, IdentityKind, PgSocialStore, SocialError};
use uuid::Uuid;

#[tokio::test]
async fn brands_are_durable_owned_retry_safe_and_have_real_affiliation_logos() {
    let Ok(database) = std::env::var("TEST_DATABASE_URL") else {
        return;
    };
    let pool = sqlx::PgPool::connect(&database).await.unwrap();
    sqlx::migrate!().run(&pool).await.unwrap();
    let store = PgSocialStore::new(pool.clone());
    let owner = Uuid::new_v4();
    let outsider = Uuid::new_v4();
    let agent_account = Uuid::new_v4();
    for (id, kind) in [
        (owner, "human"),
        (outsider, "human"),
        (agent_account, "agent"),
    ] {
        sqlx::query("INSERT INTO durable_accounts(id,email,kind,temporary) VALUES($1,$2,$3,false)")
            .bind(id)
            .bind(format!("brand-{id}@example.test"))
            .bind(kind)
            .execute(&pool)
            .await
            .unwrap();
    }
    let input = BrandProfileInput {
        handle: format!("brand_{}", &Uuid::new_v4().simple().to_string()[..16]),
        display_name: "Future Present Labs".into(),
        bio: "Research and tools.".into(),
        avatar_url: "https://tardy.news/brands/fpl.png".into(),
    };
    assert!(matches!(
        store.create_brand_profile(agent_account, &input).await,
        Err(SocialError::Forbidden)
    ));
    let brand = store.create_brand_profile(owner, &input).await.unwrap();
    assert_eq!(brand.kind, IdentityKind::Project);
    assert!(
        !brand.verified,
        "creating a brand must not mint a paid entitlement"
    );
    assert_eq!(
        store.create_brand_profile(owner, &input).await.unwrap().id,
        brand.id
    );
    assert!(matches!(
        store.create_brand_profile(outsider, &input).await,
        Err(SocialError::Conflict(_))
    ));
    let acting: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM profile_actors WHERE profile_id=$1 AND actor_account_id=$2)",
    )
    .bind(brand.id)
    .bind(owner)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(acting);
    assert!(matches!(
        store.update_brand_profile(outsider, brand.id, &input).await,
        Err(SocialError::Forbidden)
    ));
    let mut changed = input.clone();
    changed.display_name = "FPL".into();
    changed.avatar_url = "https://tardy.news/brands/fpl-new.png".into();
    assert_eq!(
        store
            .update_brand_profile(owner, brand.id, &changed)
            .await
            .unwrap()
            .id,
        brand.id
    );
    let affiliate = Uuid::new_v4();
    store
        .register_identity(
            agent_account,
            affiliate,
            &format!("agent_{}", &affiliate.simple().to_string()[..16]),
            IdentityKind::Agent,
            "Builder",
            "",
        )
        .await
        .unwrap();
    let linked = store
        .set_brand_affiliate(owner, brand.id, affiliate, Some("FPL"))
        .await
        .unwrap();
    assert_eq!(
        linked.brand_affiliate.unwrap().avatar_url,
        changed.avatar_url
    );
    let mut invalid = changed.clone();
    let mut logoless = changed.clone();
    logoless.handle = format!("holodeck_{}", &Uuid::new_v4().simple().to_string()[..16]);
    logoless.avatar_url.clear();
    assert_eq!(
        store
            .create_brand_profile(owner, &logoless)
            .await
            .unwrap()
            .avatar_url,
        ""
    );
    invalid.avatar_url = "https://tardy.news/logo.png?token=secret".into();
    assert!(matches!(
        store.update_brand_profile(owner, brand.id, &invalid).await,
        Err(SocialError::Invalid(_))
    ));
}
