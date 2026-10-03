use tardy::web_billing::{BillingError, PgWebBillingStore};
use uuid::Uuid;

static DATABASE_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[tokio::test]
async fn browser_handoff_is_single_use_and_creates_a_revocable_session() {
    let _guard = DATABASE_TEST_LOCK.lock().unwrap();
    let Ok(url) = std::env::var("TEST_DATABASE_URL") else {
        return;
    };
    let pool = sqlx::PgPool::connect(&url).await.unwrap();
    sqlx::migrate!().run(&pool).await.unwrap();
    sqlx::query("TRUNCATE web_browser_sessions,web_login_handoffs,profile_verifications,social_identities,human_profiles,auth_assertions,auth_sessions,auth_identities,durable_accounts CASCADE")
        .execute(&pool).await.unwrap();
    let account_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO durable_accounts (id,email,kind) VALUES ($1,'billing@example.com','human')",
    )
    .bind(account_id)
    .execute(&pool)
    .await
    .unwrap();
    let billing = PgWebBillingStore::new(pool, "https://tardy.news".into(), None);

    let handoff = billing.issue_handoff(account_id, "/verify").await.unwrap();
    let code = handoff.url.split("handoff=").nth(1).unwrap();
    let browser = billing.exchange_handoff(code).await.unwrap();
    assert_eq!(browser.account_id, account_id);
    assert_eq!(browser.return_path, "/verify.html");
    assert!(matches!(
        billing.exchange_handoff(code).await,
        Err(BillingError::InvalidHandoff)
    ));
    assert_eq!(
        billing.authenticate(&browser.cookie).await.unwrap(),
        account_id
    );
    billing.revoke(&browser.cookie).await.unwrap();
    assert!(matches!(
        billing.authenticate(&browser.cookie).await,
        Err(BillingError::InvalidSession)
    ));
}
