use tardy::pg_accounts::{PgAccountError, PgAccountStore};
use uuid::Uuid;

static DATABASE_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[tokio::test]
async fn claimed_tardy_keeps_agent_credential_and_gains_human_owner() {
    let _guard = DATABASE_TEST_LOCK.lock().unwrap();
    let Ok(url) = std::env::var("TEST_DATABASE_URL") else {
        return;
    };
    let pool = sqlx::PgPool::connect(&url).await.unwrap();
    sqlx::migrate!().run(&pool).await.unwrap();
    sqlx::query("TRUNCATE durable_ai_consents,profile_actors,profile_ownership,durable_claim_codes,account_api_tokens,durable_accounts CASCADE").execute(&pool).await.unwrap();
    let store = PgAccountStore::new(pool);
    let human_code = store.issue_human_claim(1_000).await.unwrap();
    let human = store
        .claim_human(&human_code.code, "owner@example.com", 2_000)
        .await
        .unwrap();
    let tardy = store.register_tardy(3_000).await.unwrap();
    let profile = Uuid::new_v4();
    store.bind_profile(tardy.account_id, profile).await.unwrap();
    assert_eq!(
        store.authenticate(&tardy.api_token, 4_000).await.unwrap(),
        tardy.account_id
    );
    assert_eq!(
        store
            .claim_tardy(human.account.id, &tardy.claim_code, 5_000)
            .await
            .unwrap(),
        vec![profile]
    );
    assert!(store.owns_profile(human.account.id, profile).await.unwrap());
    assert!(!store.owns_profile(tardy.account_id, profile).await.unwrap());
    assert!(store.can_act(tardy.account_id, profile).await.unwrap());
    assert_eq!(
        store
            .authenticate(&tardy.api_token, tardy.expires_at_ms + 1)
            .await
            .unwrap(),
        tardy.account_id
    );
}

#[tokio::test]
async fn unclaimed_tardy_token_and_profile_expire_together() {
    let _guard = DATABASE_TEST_LOCK.lock().unwrap();
    let Ok(url) = std::env::var("TEST_DATABASE_URL") else {
        return;
    };
    let pool = sqlx::PgPool::connect(&url).await.unwrap();
    sqlx::migrate!().run(&pool).await.unwrap();
    sqlx::query("TRUNCATE durable_ai_consents,profile_actors,profile_ownership,durable_claim_codes,account_api_tokens,durable_accounts CASCADE").execute(&pool).await.unwrap();
    let store = PgAccountStore::new(pool);
    let tardy = store.register_tardy(10).await.unwrap();
    let profile = Uuid::new_v4();
    store.bind_profile(tardy.account_id, profile).await.unwrap();
    assert_eq!(
        store.purge_expired(tardy.expires_at_ms).await.unwrap(),
        vec![profile]
    );
    assert!(matches!(
        store
            .authenticate(&tardy.api_token, tardy.expires_at_ms)
            .await,
        Err(PgAccountError::InvalidClaim)
    ));
}
