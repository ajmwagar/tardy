use tardy::social::{IdentityKind, PgSocialStore, PostMedia, PostVisibility};
use tardy::subscriptions::{DeliveryMode, NewSubscription, PgSubscriptionStore, SubscriptionKind};
use uuid::Uuid;

static DATABASE_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[tokio::test]
async fn dm_stays_quiet_until_an_owned_agent_is_summoned() {
    let _guard = DATABASE_TEST_LOCK.lock().unwrap();
    let Some((pool, store)) = setup().await else {
        return;
    };
    let owner = Uuid::new_v4();
    let friend_owner = Uuid::new_v4();
    let human = Uuid::new_v4();
    let friend = Uuid::new_v4();
    let agent = Uuid::new_v4();
    store
        .register_identity(owner, human, "avery", IdentityKind::Human)
        .await
        .unwrap();
    store
        .register_identity(friend_owner, friend, "james", IdentityKind::Human)
        .await
        .unwrap();
    store
        .register_identity(owner, agent, "builder", IdentityKind::Agent)
        .await
        .unwrap();

    let subscriptions = PgSubscriptionStore::new(
        pool.clone(),
        "https://tardy.test".into(),
        Some(b"test-key".to_vec()),
    );
    let inbox = subscriptions
        .create(
            owner,
            NewSubscription {
                kind: SubscriptionKind::AgentInbox,
                hashtag: None,
                profile_id: Some(agent),
                delivery: DeliveryMode::Poll,
                webhook_url: None,
            },
        )
        .await
        .unwrap();
    let conversation = store.create_conversation(human, friend).await.unwrap();
    assert_eq!(conversation.mode, tardy::social::ConversationMode::Dm);
    store
        .set_typing(friend, conversation.id, true)
        .await
        .unwrap();
    assert_eq!(
        store.typing(human, conversation.id).await.unwrap(),
        vec![friend]
    );
    assert!(
        store
            .typing(friend, conversation.id)
            .await
            .unwrap()
            .is_empty()
    );
    store
        .set_typing(friend, conversation.id, false)
        .await
        .unwrap();
    assert!(
        store
            .typing(human, conversation.id)
            .await
            .unwrap()
            .is_empty()
    );
    store
        .send_message(human, conversation.id, "look at this", None)
        .await
        .unwrap();
    assert!(
        subscriptions
            .poll(owner, inbox.id, 0, 50)
            .await
            .unwrap()
            .is_empty()
    );

    let promoted = store
        .summon_agent(owner, human, conversation.id, agent, true)
        .await
        .unwrap();
    assert_eq!(promoted.mode, tardy::social::ConversationMode::Work);
    let events = subscriptions.poll(owner, inbox.id, 0, 50).await.unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].kind, "agent_share");
    assert_eq!(events[0].payload["context_from_sequence"], 2);

    store
        .send_message(
            friend,
            conversation.id,
            "@builder can you prototype it?",
            None,
        )
        .await
        .unwrap();
    let listed = store.conversations(friend).await.unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].mode, tardy::social::ConversationMode::Work);
    assert_eq!(listed[0].unread_count, 1);
    assert_eq!(listed[0].last_message.as_ref().unwrap().sequence, 2);
    let messages = store
        .messages(friend, conversation.id, 0, 50)
        .await
        .unwrap();
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[1].sequence, 2);
    let acknowledged = store
        .react_to_message(agent, conversation.id, messages[1].id, "seen")
        .await
        .unwrap();
    assert_eq!(acknowledged.reactions.len(), 1);
    assert_eq!(acknowledged.reactions[0].kind, "seen");
    assert_eq!(acknowledged.reactions[0].account_ids, vec![agent]);
    let reloaded = store
        .messages(friend, conversation.id, 0, 50)
        .await
        .unwrap();
    assert_eq!(reloaded[1].reactions, acknowledged.reactions);
    store
        .mark_read(friend, conversation.id, messages[1].id)
        .await
        .unwrap();
    assert_eq!(
        store.conversations(friend).await.unwrap()[0].unread_count,
        0
    );
    let events = subscriptions
        .poll(owner, inbox.id, events[0].id, 50)
        .await
        .unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].kind, "work_message");
}

#[tokio::test]
async fn links_posts_and_agent_mentions_are_idempotent_and_deliverable() {
    let _guard = DATABASE_TEST_LOCK.lock().unwrap();
    let Some((pool, store)) = setup().await else {
        return;
    };
    let account = Uuid::new_v4();
    let human = Uuid::new_v4();
    let agent = Uuid::new_v4();
    store
        .register_identity(account, human, "avery", IdentityKind::Human)
        .await
        .unwrap();
    store
        .register_identity(account, agent, "shipper", IdentityKind::Agent)
        .await
        .unwrap();
    let first = store
        .add_shared_link("https://www.youtube.com/watch?v=abc&utm_source=x#fragment")
        .await
        .unwrap();
    let second = store
        .add_shared_link("https://youtube.com/watch?v=abc")
        .await
        .unwrap();
    assert_eq!(first.id, second.id);
    let outbox_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM outbox WHERE topic='shared_link.enrichment_requested.v1'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(outbox_count, 1);

    let request_id = Uuid::new_v4();
    let post = store
        .publish_post(
            agent,
            request_id,
            "Shipped the first pass #buildinpublic",
            Some(first.id),
            PostVisibility::Public,
        )
        .await
        .unwrap();
    let retry = store
        .publish_post(
            agent,
            request_id,
            "ignored retry body",
            Some(first.id),
            PostVisibility::Private,
        )
        .await
        .unwrap();
    assert_eq!(post.id, retry.id);
    assert_eq!(retry.caption, post.caption);

    let subscriptions = PgSubscriptionStore::new(pool, "https://tardy.test".into(), None);
    let inbox = subscriptions
        .create(
            account,
            NewSubscription {
                kind: SubscriptionKind::AgentInbox,
                hashtag: None,
                profile_id: Some(agent),
                delivery: DeliveryMode::Poll,
                webhook_url: None,
            },
        )
        .await
        .unwrap();
    store
        .comment(human, post.id, "@shipper what should we do next?", &[agent])
        .await
        .unwrap();
    let events = subscriptions.poll(account, inbox.id, 0, 50).await.unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].kind, "agent_reply_requested");
}

#[tokio::test]
async fn private_reel_keeps_media_when_the_owner_promotes_it() {
    let _guard = DATABASE_TEST_LOCK.lock().unwrap();
    let Some((_pool, store)) = setup().await else {
        return;
    };
    let account = Uuid::new_v4();
    let human = Uuid::new_v4();
    let agent = Uuid::new_v4();
    store
        .register_identity(account, human, "owner", IdentityKind::Human)
        .await
        .unwrap();
    store
        .register_identity(account, agent, "reelbot", IdentityKind::Agent)
        .await
        .unwrap();
    let media = PostMedia {
        kind: "video".into(),
        url: "https://media.test/reel.mp4".into(),
        poster_url: Some("https://media.test/reel.jpg".into()),
        width: 1080,
        height: 1920,
        duration_ms: 18_400,
    };
    let post = store
        .publish_post_with_media(
            agent,
            Uuid::new_v4(),
            "A verified private reel",
            None,
            PostVisibility::Private,
            std::slice::from_ref(&media),
        )
        .await
        .unwrap();
    assert_eq!(post.media, vec![media]);
    assert!(store.app_feed(None, 10).await.unwrap().is_empty());
    assert_eq!(
        store.app_feed(Some(human), 10).await.unwrap()[0].format,
        "reel"
    );

    let promoted = store
        .set_post_visibility(agent, post.id, PostVisibility::Public)
        .await
        .unwrap();
    assert_eq!(promoted.id, post.id);
    assert_eq!(promoted.visibility, PostVisibility::Public);
    let public = store.app_feed(None, 10).await.unwrap();
    assert_eq!(public[0].id, post.id);
    assert_eq!(public[0].format, "reel");
    assert_eq!(public[0].media[0]["url"], "https://media.test/reel.mp4");
}

async fn setup() -> Option<(sqlx::PgPool, PgSocialStore)> {
    let url = std::env::var("TEST_DATABASE_URL").ok()?;
    let pool = sqlx::PgPool::connect(&url).await.unwrap();
    sqlx::migrate!().run(&pool).await.unwrap();
    sqlx::query("TRUNCATE comment_mentions,post_comments,tardy_posts,conversation_agent_grants,conversation_messages,conversation_participants,conversations,profile_follows,social_identities,shared_links,webhook_deliveries,feed_subscriptions,feed_events,outbox RESTART IDENTITY CASCADE").execute(&pool).await.unwrap();
    Some((pool.clone(), PgSocialStore::new(pool)))
}
