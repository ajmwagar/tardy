use tardy::social::{IdentityKind, PgSocialStore, SocialError};
use uuid::Uuid;

#[tokio::test]
async fn peer_questions_require_owner_grants_are_idempotent_and_replies_do_not_loop() {
    let Some(database) = std::env::var("TEST_DATABASE_URL").ok() else {
        return;
    };
    let pool = sqlx::PgPool::connect(&database).await.unwrap();
    sqlx::migrate!().run(&pool).await.unwrap();
    let store = PgSocialStore::new(pool.clone());
    let first_owner = Uuid::new_v4();
    let second_owner = Uuid::new_v4();
    let new_owner = Uuid::new_v4();
    for owner in [first_owner, second_owner, new_owner] {
        sqlx::query(
            "INSERT INTO durable_accounts(id,email,kind,temporary) VALUES ($1,$2,'human',false)",
        )
        .bind(owner)
        .bind(format!("peer-{owner}@example.test"))
        .execute(&pool)
        .await
        .unwrap();
    }
    let first = Uuid::new_v4();
    let second = Uuid::new_v4();
    let same_owner = Uuid::new_v4();
    for (agent, owner) in [
        (first, first_owner),
        (second, second_owner),
        (same_owner, first_owner),
    ] {
        store
            .register_identity(
                owner,
                agent,
                &format!("peer_{}", &agent.simple().to_string()[..16]),
                IdentityKind::Agent,
                "Peer",
                "",
            )
            .await
            .unwrap();
        sqlx::query("INSERT INTO profile_ownership(profile_id,owner_account_id) VALUES ($1,$2)")
            .bind(agent)
            .bind(owner)
            .execute(&pool)
            .await
            .unwrap();
    }
    let request_id = Uuid::new_v4();
    assert!(matches!(
        store
            .ask_agent_peer(first, second, "question", request_id)
            .await,
        Err(SocialError::Forbidden)
    ));
    assert!(matches!(
        store
            .set_agent_peer_permission(first_owner, second, first, true)
            .await,
        Err(SocialError::Forbidden)
    ));
    store
        .set_agent_peer_permission(second_owner, second, first, true)
        .await
        .unwrap();
    let question = store
        .ask_agent_peer(first, second, "question", request_id)
        .await
        .unwrap();
    let retry = store
        .ask_agent_peer(first, second, "question", request_id)
        .await
        .unwrap();
    assert_eq!(question.id, retry.id);
    assert!(matches!(
        store
            .ask_agent_peer(first, second, "changed", request_id)
            .await,
        Err(SocialError::Conflict(_))
    ));
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM feed_events WHERE recipient_profile_id=$1 AND payload->>'message_id'=$2")
        .bind(second).bind(question.id.to_string()).fetch_one(&pool).await.unwrap();
    assert_eq!(count, 1);
    let answer = store
        .send_message(second, question.conversation_id, "answer", None, &[])
        .await
        .unwrap();
    let events: i64 =
        sqlx::query_scalar("SELECT count(*) FROM feed_events WHERE payload->>'message_id'=$1")
            .bind(answer.id.to_string())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(events, 0, "an agent reply must not activate another agent");
    let received = store
        .messages(first, question.conversation_id, question.sequence, 20)
        .await
        .unwrap();
    assert_eq!(received.len(), 1);
    assert_eq!(received[0].body, "answer");
    assert!(matches!(
        store
            .messages(same_owner, question.conversation_id, 0, 20)
            .await,
        Err(SocialError::Forbidden)
    ));
    store
        .set_agent_peer_permission(second_owner, second, first, false)
        .await
        .unwrap();
    assert!(matches!(
        store
            .ask_agent_peer(first, second, "revoked", Uuid::new_v4())
            .await,
        Err(SocialError::Forbidden)
    ));
    store
        .set_agent_peer_permission(second_owner, second, first, true)
        .await
        .unwrap();
    sqlx::query("UPDATE profile_ownership SET owner_account_id=$1 WHERE profile_id=$2")
        .bind(new_owner)
        .bind(second)
        .execute(&pool)
        .await
        .unwrap();
    assert!(matches!(
        store
            .ask_agent_peer(first, second, "transferred", Uuid::new_v4())
            .await,
        Err(SocialError::Forbidden)
    ));
    assert!(
        store
            .ask_agent_peer(first, same_owner, "same owner", Uuid::new_v4())
            .await
            .is_ok()
    );
    assert!(
        store
            .ask_agent_peer(same_owner, first, "reverse direction", Uuid::new_v4())
            .await
            .is_ok()
    );
    for _ in 1..20 {
        store
            .ask_agent_peer(first, same_owner, "bounded", Uuid::new_v4())
            .await
            .unwrap();
    }
    assert!(matches!(
        store
            .ask_agent_peer(first, same_owner, "over limit", Uuid::new_v4())
            .await,
        Err(SocialError::Conflict(_))
    ));
    assert!(matches!(
        store
            .ask_agent_peer(first, first, "self", Uuid::new_v4())
            .await,
        Err(SocialError::Invalid(_))
    ));
}
