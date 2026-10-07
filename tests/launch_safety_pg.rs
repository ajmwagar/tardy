use tardy::{
    pg_accounts::PgAccountStore,
    social::{IdentityKind, PgSocialStore, PostVisibility},
};
use uuid::Uuid;

#[tokio::test]
async fn deletion_revokes_owner_and_agent_and_reports_obey_visibility() {
    let url = std::env::var("TEST_DATABASE_URL").expect("isolated test database required");
    assert!(
        url.ends_with("/tardy_launch_safety_20261007"),
        "never run against application data"
    );
    let pool = sqlx::PgPool::connect(&url).await.unwrap();
    sqlx::migrate!().run(&pool).await.unwrap();
    let accounts = PgAccountStore::new(pool.clone());
    let social = PgSocialStore::new(pool.clone());
    let code = accounts.issue_human_claim(1000).await.unwrap();
    let owner = accounts
        .claim_human(
            &code.code,
            &format!("{}@example.test", Uuid::new_v4()),
            2000,
        )
        .await
        .unwrap();
    let agent = accounts.register_tardy(3000).await.unwrap();
    let profile = Uuid::new_v4();
    accounts
        .bind_profile(agent.account_id, profile)
        .await
        .unwrap();
    social
        .register_identity(
            agent.account_id,
            profile,
            &format!("a{}", &Uuid::new_v4().simple().to_string()[..16]),
            IdentityKind::Agent,
            "Agent",
            "",
        )
        .await
        .unwrap();
    accounts
        .claim_tardy(owner.account.id, &agent.claim_code, 4000)
        .await
        .unwrap();
    let receipt = accounts.request_deletion(owner.account.id).await.unwrap();
    assert_eq!(receipt.status, "requested");
    assert_eq!(
        accounts
            .request_deletion(owner.account.id)
            .await
            .unwrap()
            .id,
        receipt.id
    );
    assert!(accounts.authenticate(&owner.api_token, 5000).await.is_err());
    assert!(accounts.authenticate(&agent.api_token, 5000).await.is_err());
    assert!(accounts.request_deletion(agent.account_id).await.is_err());

    let viewer = Uuid::new_v4();
    social
        .register_identity(
            Uuid::new_v4(),
            viewer,
            &format!("v{}", &Uuid::new_v4().simple().to_string()[..16]),
            IdentityKind::Human,
            "Viewer",
            "",
        )
        .await
        .unwrap();
    let private = social
        .publish_post(
            profile,
            Uuid::new_v4(),
            "private",
            None,
            PostVisibility::Private,
        )
        .await
        .unwrap();
    assert!(
        social
            .report_post(viewer, private.id, "spam", "")
            .await
            .is_err()
    );
    let public = social
        .publish_post(
            profile,
            Uuid::new_v4(),
            "public",
            None,
            PostVisibility::Public,
        )
        .await
        .unwrap();
    social
        .report_post(viewer, public.id, "spam", "")
        .await
        .unwrap();
    social
        .report_post(viewer, public.id, "spam", "")
        .await
        .unwrap();
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM abuse_reports WHERE post_id=$1")
        .bind(public.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
}
