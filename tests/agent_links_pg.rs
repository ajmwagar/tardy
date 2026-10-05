use sqlx::PgPool;
use tardy::{pg_accounts::PgAccountStore, social::{PgSocialStore, IdentityKind}};
use uuid::Uuid;

async fn setup() -> (PgPool, PgAccountStore, Uuid, Uuid, Uuid, Uuid, String) {
    let pool = PgPool::connect(&std::env::var("TEST_DATABASE_URL").expect("dedicated TEST_DATABASE_URL required")).await.unwrap();
    sqlx::migrate!().run(&pool).await.unwrap();
    let store = PgAccountStore::new(pool.clone());
    let social = PgSocialStore::new(pool.clone());
    let code = store.issue_human_claim(1000).await.unwrap();
    let human = store.claim_human(&code.code, &format!("{}@example.test", Uuid::new_v4()), 1001).await.unwrap();
    let human_profile = Uuid::new_v4();
    store.bind_profile(human.account.id, human_profile).await.unwrap();
    social.register_identity(human.account.id, human_profile, &format!("h{}", &human_profile.simple().to_string()[..20]), IdentityKind::Human, "Human", "").await.unwrap();
    let agent = store.register_tardy(1002).await.unwrap();
    let profile = Uuid::new_v4();
    store.bind_profile(agent.account_id, profile).await.unwrap();
    social.register_identity(agent.account_id, profile, &format!("a{}", &profile.simple().to_string()[..20]), IdentityKind::Agent, "Agent", "").await.unwrap();
    (pool, store, human.account.id, human_profile, agent.account_id, profile, agent.claim_code)
}

#[tokio::test]
async fn accept_is_owner_only_atomic_and_retry_safe() {
    let (pool, store, human, human_profile, agent, profile, _) = setup().await;
    let request = store.request_agent_link(agent, profile, human_profile, 1003).await.unwrap();
    assert_eq!(request.status, "pending");
    assert_eq!(store.request_agent_link(agent, profile, human_profile, 1004).await.unwrap().id, request.id);
    let notification_count: i64 = sqlx::query_scalar("SELECT count(*) FROM push_notifications WHERE source_event_id=$1")
        .bind(request.id).fetch_one(&pool).await.unwrap();
    assert_eq!(notification_count, 1);
    assert_eq!(store.agent_link_requests(human, 1004).await.unwrap().len(), 1);
    assert!(store.decide_agent_link(Uuid::new_v4(), request.id, true, 1005).await.is_err());
    assert!(store.owns_profile(agent, profile).await.unwrap());
    store.decide_agent_link(human, request.id, true, 1006).await.unwrap();
    store.decide_agent_link(human, request.id, true, 1007).await.unwrap();
    assert!(store.owns_profile(human, profile).await.unwrap());
    assert!(store.can_act(agent, profile).await.unwrap());
    assert!(!store.is_temporary(agent).await.unwrap());
    let social_owner: Uuid = sqlx::query_scalar("SELECT account_id FROM social_identities WHERE profile_id=$1").bind(profile).fetch_one(&pool).await.unwrap();
    assert_eq!(social_owner, human);
    assert!(store.agent_link_requests(human, 1008).await.unwrap().is_empty());
    let notification = tardy::push::PgPushStore::new(pool.clone()).notifications(human, 10).await.unwrap();
    assert_eq!(notification[0].agent_link_request_id, Some(request.id));
    assert!(notification[0].read);
    assert!(store.decide_agent_link(human, request.id, false, 1009).await.is_err());
}

#[tokio::test]
async fn decline_does_not_grant_access_or_rearm_on_retry() {
    let (_, store, human, human_profile, agent, profile, _) = setup().await;
    let request = store.request_agent_link(agent, profile, human_profile, 1003).await.unwrap();
    store.decide_agent_link(human, request.id, false, 1004).await.unwrap();
    store.decide_agent_link(human, request.id, false, 1005).await.unwrap();
    assert!(store.is_temporary(agent).await.unwrap());
    assert!(!store.owns_profile(human, profile).await.unwrap());
    assert!(store.agent_link_requests(human, 1006).await.unwrap().is_empty());
    assert_eq!(store.request_agent_link(agent, profile, human_profile, 1007).await.unwrap().status, "declined");
    assert!(store.decide_agent_link(human, request.id, true, 1008).await.is_err());
}

#[tokio::test]
async fn expiry_and_wrong_actor_are_rejected() {
    let (_, store, human, human_profile, agent, profile, _) = setup().await;
    assert!(store.request_agent_link(agent, Uuid::new_v4(), human_profile, 1003).await.is_err());
    assert!(store.request_agent_link(agent, profile, profile, 1003).await.is_err());
    let request = store.request_agent_link(agent, profile, human_profile, 1004).await.unwrap();
    assert!(store.decide_agent_link(human, request.id, true, request.expires_at_ms).await.is_err());
    assert!(store.agent_link_requests(human, request.expires_at_ms).await.unwrap().is_empty());
}

#[tokio::test]
async fn concurrent_code_and_request_cannot_transfer_twice() {
    let (_, store, human, human_profile, agent, profile, code) = setup().await;
    let other_code = store.issue_human_claim(1003).await.unwrap();
    let other = store.claim_human(&other_code.code, &format!("{}@example.test", Uuid::new_v4()), 1004).await.unwrap();
    let request = store.request_agent_link(agent, profile, human_profile, 1005).await.unwrap();
    let (accepted, claimed) = tokio::join!(store.decide_agent_link(human, request.id, true, 1006), store.claim_tardy(other.account.id, &code, 1006));
    assert_ne!(accepted.is_ok(), claimed.is_ok());
    assert_ne!(store.owns_profile(human, profile).await.unwrap(), store.owns_profile(other.account.id, profile).await.unwrap());
}

#[tokio::test]
async fn requests_are_bounded_to_three_recipients() {
    let (pool, store, _, human_profile, agent, profile, _) = setup().await;
    store.request_agent_link(agent, profile, human_profile, 1003).await.unwrap();
    let social = PgSocialStore::new(pool);
    for index in 0..3 {
        let code = store.issue_human_claim(1004).await.unwrap();
        let human = store.claim_human(&code.code, &format!("{}@example.test", Uuid::new_v4()), 1005).await.unwrap();
        let recipient = Uuid::new_v4();
        store.bind_profile(human.account.id, recipient).await.unwrap();
        social.register_identity(human.account.id, recipient, &format!("h{}", &recipient.simple().to_string()[..20]), IdentityKind::Human, "Owner", "").await.unwrap();
        let result = store.request_agent_link(agent, profile, recipient, 1006).await;
        assert_eq!(result.is_ok(), index < 2);
    }
}
