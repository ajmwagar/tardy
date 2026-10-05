use tardy::mcp_bridges::PgMcpBridgeStore;
use tardy::social::{IdentityKind, PgSocialStore, SocialError};
use uuid::Uuid;

#[tokio::test]
async fn bridge_grants_enforce_ownership_and_revocation() {
    let url = std::env::var("TEST_DATABASE_URL").expect("isolated TEST_DATABASE_URL required");
    let pool = sqlx::PgPool::connect(&url).await.unwrap();
    sqlx::migrate!().run(&pool).await.unwrap();
    let owner = Uuid::new_v4();
    let stranger = Uuid::new_v4();
    let agent = Uuid::new_v4();
    for account in [owner, stranger] {
        sqlx::query(
            "INSERT INTO durable_accounts (id,email,kind,temporary) VALUES ($1,$2,'human',false)",
        )
        .bind(account)
        .bind(format!("{account}@example.test"))
        .execute(&pool)
        .await
        .unwrap();
    }
    PgSocialStore::new(pool.clone())
        .register_identity(
            owner,
            agent,
            &format!("a{}", &agent.simple().to_string()[..16]),
            IdentityKind::Agent,
            "Agent",
            "",
        )
        .await
        .unwrap();
    sqlx::query("INSERT INTO profile_ownership (owner_account_id,profile_id) VALUES ($1,$2)")
        .bind(owner)
        .bind(agent)
        .execute(&pool)
        .await
        .unwrap();
    let store = PgMcpBridgeStore::new(pool);
    let bridge = store
        .register_connection(
            owner,
            "composio",
            "My connectors",
            "binding://mcp/tardy/test/composio",
            &["drive.search".into()],
        )
        .await
        .unwrap();
    assert!(store.list_connections(stranger).await.unwrap().is_empty());
    assert!(matches!(
        store.list_grants(stranger, bridge.id).await,
        Err(SocialError::NotFound)
    ));
    assert!(matches!(
        store
            .grant_agent(stranger, bridge.id, agent, &["*".into()], "ask")
            .await,
        Err(SocialError::Forbidden)
    ));
    assert!(matches!(
        store
            .grant_agent(owner, bridge.id, Uuid::new_v4(), &["*".into()], "ask")
            .await,
        Err(SocialError::Forbidden)
    ));
    store
        .grant_agent(
            owner,
            bridge.id,
            agent,
            &["drive.search".into()],
            "read_auto",
        )
        .await
        .unwrap();
    assert_eq!(store.list_grants(owner, bridge.id).await.unwrap().len(), 1);
    store.revoke_connection(owner, bridge.id).await.unwrap();
    assert!(store.list_connections(owner).await.unwrap().is_empty());
    assert!(matches!(
        store
            .grant_agent(owner, bridge.id, agent, &["*".into()], "ask")
            .await,
        Err(SocialError::Forbidden)
    ));
    let reconnected = store
        .register_connection(
            owner,
            "composio",
            "Reconnected",
            "binding://mcp/tardy/test/composio",
            &[],
        )
        .await
        .unwrap();
    assert_eq!(bridge.id, reconnected.id);
    assert!(
        store
            .list_grants(owner, bridge.id)
            .await
            .unwrap()
            .is_empty()
    );
}
