use tardy::push::{ApnsEnvironment, PgPushStore, RegisterPushDevice};
use tardy::social::{IdentityKind, PgSocialStore, PostMedia, PostVisibility, SocialError};
use tardy::subscriptions::{DeliveryMode, NewSubscription, PgSubscriptionStore, SubscriptionKind};
use uuid::Uuid;

static DATABASE_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[tokio::test]
async fn agent_souls_are_versioned_and_installations_age_from_presence() {
    let _guard = DATABASE_TEST_LOCK.lock().unwrap();
    let Some((pool, store)) = setup().await else {
        return;
    };
    let owner = Uuid::new_v4();
    let human = Uuid::new_v4();
    let agent = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO durable_accounts (id,email,kind,temporary) VALUES ($1,$2,'human',false)",
    )
    .bind(owner)
    .bind(format!("soul-{owner}@example.test"))
    .execute(&pool)
    .await
    .unwrap();
    store
        .register_identity(owner, human, "soul-owner", IdentityKind::Human, "Owner", "")
        .await
        .unwrap();
    store
        .register_identity(owner, agent, "soul-agent", IdentityKind::Agent, "Agent", "")
        .await
        .unwrap();
    sqlx::query("INSERT INTO profile_ownership (owner_account_id,profile_id) VALUES ($1,$2)")
        .bind(owner)
        .bind(agent)
        .execute(&pool)
        .await
        .unwrap();

    let empty = store.agent_soul(owner, agent).await.unwrap();
    assert_eq!(empty.revision, 0);
    let first = store
        .update_agent_soul(
            owner,
            agent,
            0,
            "A patient systems tutor",
            "Prefer runnable examples.",
            &["Rust".into(), "Mathematics".into()],
        )
        .await
        .unwrap();
    assert_eq!(first.revision, 1);
    assert!(matches!(
        store
            .update_agent_soul(owner, agent, 0, "stale", "stale", &[])
            .await,
        Err(SocialError::Conflict(_))
    ));

    let installation = store
        .heartbeat_agent_installation(
            agent,
            "mac-studio",
            "Mac Studio",
            "codex",
            &["chat".into(), "tools".into()],
            "available",
        )
        .await
        .unwrap();
    assert_eq!(installation.status, "available");
    let installations = store.agent_installations(owner, agent).await.unwrap();
    assert_eq!(installations.len(), 1);
    assert_eq!(installations[0].installation_key, "mac-studio");

    sqlx::query(
        "UPDATE agent_installations SET last_seen_at=now()-interval '2 minutes' WHERE id=$1",
    )
    .bind(installation.id)
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        store.agent_installations(owner, agent).await.unwrap()[0].status,
        "offline"
    );
}

#[tokio::test]
async fn direct_threads_reuse_while_groups_keep_their_own_identity() {
    let _guard = DATABASE_TEST_LOCK.lock().unwrap();
    let Some((_pool, store)) = setup().await else {
        return;
    };
    let owner = Uuid::new_v4();
    let friend_owner = Uuid::new_v4();
    let owner_profile = Uuid::new_v4();
    let friend = Uuid::new_v4();
    let third = Uuid::new_v4();
    for (account, profile, handle) in [
        (owner, owner_profile, "thread-owner"),
        (friend_owner, friend, "thread-friend"),
        (friend_owner, third, "thread-third"),
    ] {
        store
            .register_identity(account, profile, handle, IdentityKind::Human, handle, "")
            .await
            .unwrap();
    }

    let direct = store
        .create_conversation(owner_profile, friend)
        .await
        .unwrap();
    let reused = store
        .create_conversation(friend, owner_profile)
        .await
        .unwrap();
    assert_eq!(direct.id, reused.id);

    let first_group = store
        .create_group_conversation(owner_profile, &[friend], Some("Project One"))
        .await
        .unwrap();
    let second_group = store
        .create_group_conversation(owner_profile, &[friend], Some("Project Two"))
        .await
        .unwrap();
    assert_ne!(first_group.id, second_group.id);
    assert_eq!(first_group.title.as_deref(), Some("Project One"));

    let expanded = store
        .add_participant(owner_profile, first_group.id, third)
        .await
        .unwrap();
    assert!(expanded.participants.contains(&third));
    let renamed = store
        .rename_conversation(owner_profile, first_group.id, Some("Ship Room"))
        .await
        .unwrap();
    assert_eq!(renamed.title.as_deref(), Some("Ship Room"));
    let reduced = store
        .remove_participant(owner_profile, first_group.id, third)
        .await
        .unwrap();
    assert_eq!(reduced.id, first_group.id);
    assert!(!reduced.participants.contains(&third));
}

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
        .register_identity(owner, human, "avery", IdentityKind::Human, "Avery", "")
        .await
        .unwrap();
    store
        .register_identity(
            friend_owner,
            friend,
            "james",
            IdentityKind::Human,
            "James",
            "",
        )
        .await
        .unwrap();
    store
        .register_identity(owner, agent, "builder", IdentityKind::Agent, "Builder", "")
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
        .send_message(human, conversation.id, "look at this", None, &[])
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
            &[],
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
    let agent_messages = store.messages(agent, conversation.id, 0, 50).await.unwrap();
    assert_eq!(agent_messages.len(), 1);
    assert_eq!(agent_messages[0].sequence, 2);
    assert_eq!(agent_messages[0].body, "@builder can you prototype it?");
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
    assert!(reloaded[1].read_by.is_empty());
    store
        .mark_read(human, conversation.id, messages[1].id)
        .await
        .unwrap();
    assert_eq!(
        store
            .messages(friend, conversation.id, 0, 50)
            .await
            .unwrap()[1]
            .read_by,
        vec![human]
    );
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
    assert_eq!(events[0].payload["context_from_sequence"], 2);
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
        .register_identity(account, human, "avery", IdentityKind::Human, "Avery", "")
        .await
        .unwrap();
    store
        .register_identity(
            account,
            agent,
            "shipper",
            IdentityKind::Agent,
            "Shipper",
            "",
        )
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
    let Some((pool, store)) = setup().await else {
        return;
    };
    let account = Uuid::new_v4();
    let human = Uuid::new_v4();
    let agent = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO durable_accounts (id,email,kind,temporary) VALUES ($1,$2,'human',false)",
    )
    .bind(account)
    .bind(format!("owner-{account}@example.test"))
    .execute(&pool)
    .await
    .unwrap();
    store
        .register_identity(account, human, "owner", IdentityKind::Human, "Owner", "")
        .await
        .unwrap();
    store
        .register_identity(
            account,
            agent,
            "reelbot",
            IdentityKind::Agent,
            "Reelbot",
            "",
        )
        .await
        .unwrap();
    sqlx::query("INSERT INTO profile_ownership (owner_account_id,profile_id) VALUES ($1,$2)")
        .bind(account)
        .bind(agent)
        .execute(&pool)
        .await
        .unwrap();
    let media = PostMedia {
        kind: "video".into(),
        asset_id: None,
        poster_asset_id: None,
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

#[tokio::test]
async fn owner_can_comment_on_owned_agents_private_post_but_stranger_cannot() {
    let _guard = DATABASE_TEST_LOCK.lock().unwrap();
    let Some((pool, store)) = setup().await else {
        return;
    };
    let owner_account = Uuid::new_v4();
    let stranger_account = Uuid::new_v4();
    let owner = Uuid::new_v4();
    let agent = Uuid::new_v4();
    let stranger = Uuid::new_v4();
    for (account, profile, handle, kind) in [
        (owner_account, owner, "private-owner", IdentityKind::Human),
        (owner_account, agent, "private-agent", IdentityKind::Agent),
        (
            stranger_account,
            stranger,
            "private-stranger",
            IdentityKind::Human,
        ),
    ] {
        store
            .register_identity(account, profile, handle, kind, handle, "")
            .await
            .unwrap();
    }
    sqlx::query("INSERT INTO profile_ownership (owner_account_id,profile_id) VALUES ($1,$2)")
        .bind(owner_account)
        .bind(agent)
        .execute(&pool)
        .await
        .unwrap();
    let post = store
        .publish_post(
            agent,
            Uuid::new_v4(),
            "private work update",
            None,
            PostVisibility::Private,
        )
        .await
        .unwrap();

    assert!(store.comments(owner, post.id).await.unwrap().is_empty());
    let comment = store
        .comment(owner, post.id, "Keep going", &[])
        .await
        .unwrap();
    let comments = store.comments(owner, post.id).await.unwrap();
    assert_eq!(comments.len(), 1);
    assert_eq!(comments[0].id, comment.id);
    assert_eq!(comments[0].body, "Keep going");
    assert!(store.comments(stranger, post.id).await.is_err());
    assert!(
        store
            .comment(stranger, post.id, "I should not be here", &[])
            .await
            .is_err()
    );
}

#[tokio::test]
async fn agent_draft_stream_is_private_and_final_message_clears_it() {
    let _guard = DATABASE_TEST_LOCK.lock().unwrap();
    let Some((_pool, store)) = setup().await else {
        return;
    };
    let owner_account = Uuid::new_v4();
    let stranger_account = Uuid::new_v4();
    let owner = Uuid::new_v4();
    let agent = Uuid::new_v4();
    let stranger = Uuid::new_v4();
    for (account, profile, handle, kind) in [
        (owner_account, owner, "draft-owner", IdentityKind::Human),
        (owner_account, agent, "draft-agent", IdentityKind::Agent),
        (
            stranger_account,
            stranger,
            "draft-stranger",
            IdentityKind::Human,
        ),
    ] {
        store
            .register_identity(account, profile, handle, kind, handle, "")
            .await
            .unwrap();
    }
    let conversation = store.create_conversation(owner, agent).await.unwrap();
    let draft = store
        .set_draft(
            agent,
            conversation.id,
            "Streaming **now**",
            "writing",
            "",
            &[],
        )
        .await
        .unwrap();
    assert_eq!(draft.sender_profile_id, agent);
    assert_eq!(
        store.drafts(owner, conversation.id).await.unwrap(),
        vec![draft]
    );
    assert!(store.drafts(stranger, conversation.id).await.is_err());
    assert!(
        store
            .set_draft(
                owner,
                conversation.id,
                "humans cannot impersonate streams",
                "writing",
                "",
                &[]
            )
            .await
            .is_err()
    );

    store
        .send_message(agent, conversation.id, "Streaming **now**", None, &[])
        .await
        .unwrap();
    assert!(
        store
            .drafts(owner, conversation.id)
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn human_group_notifies_members_then_becomes_work_when_an_agent_is_summoned() {
    let _guard = DATABASE_TEST_LOCK.lock().unwrap();
    let Some((pool, store)) = setup().await else {
        return;
    };
    let owner_account = Uuid::new_v4();
    let james_account = Uuid::new_v4();
    let friend_account = Uuid::new_v4();
    let avery = Uuid::new_v4();
    let james = Uuid::new_v4();
    let friend = Uuid::new_v4();
    let agent = Uuid::new_v4();
    for (account, profile, handle, kind) in [
        (owner_account, avery, "avery-group", IdentityKind::Human),
        (james_account, james, "james-group", IdentityKind::Human),
        (friend_account, friend, "friend-group", IdentityKind::Human),
        (owner_account, agent, "builder-group", IdentityKind::Agent),
    ] {
        store
            .register_identity(account, profile, handle, kind, handle, "")
            .await
            .unwrap();
    }

    let push = PgPushStore::new(pool.clone());
    push.register_device(
        james_account,
        RegisterPushDevice {
            token: "11".repeat(32),
            environment: ApnsEnvironment::Sandbox,
            topic: "dev.fpl.tardy".into(),
        },
    )
    .await
    .unwrap();
    let conversation = store
        .create_group_conversation(avery, &[james, friend], Some("Launch crew"))
        .await
        .unwrap();
    assert_eq!(conversation.mode, tardy::social::ConversationMode::Dm);
    assert_eq!(conversation.participants.len(), 3);
    assert_eq!(
        push.notifications(james_account, 10).await.unwrap().len(),
        1
    );
    assert_eq!(
        push.notifications(friend_account, 10).await.unwrap().len(),
        1
    );

    let message = store
        .send_message(
            avery,
            conversation.id,
            "Let’s build this together",
            None,
            &[],
        )
        .await
        .unwrap();
    let notifications = push.notifications(james_account, 10).await.unwrap();
    assert_eq!(notifications.len(), 2);
    assert_eq!(notifications[0].kind, "message");
    assert_eq!(notifications[0].actor_id, avery);
    assert_eq!(notifications[0].text, message.body);
    assert_eq!(notifications[0].conversation_id, Some(conversation.id));
    let queued: i64 =
        sqlx::query_scalar("SELECT count(*) FROM push_deliveries WHERE status='queued'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(queued, 2, "invites and messages are on by default");

    let promoted = store
        .summon_agent(owner_account, avery, conversation.id, agent, true)
        .await
        .unwrap();
    assert_eq!(promoted.mode, tardy::social::ConversationMode::Work);
    assert_eq!(promoted.participants.len(), 4);
}

#[tokio::test]
async fn social_actions_create_deduplicated_durable_notifications() {
    let _guard = DATABASE_TEST_LOCK.lock().unwrap();
    let Some((pool, store)) = setup().await else {
        return;
    };
    let author_account = Uuid::new_v4();
    let actor_account = Uuid::new_v4();
    let mentioned_account = Uuid::new_v4();
    let author = Uuid::new_v4();
    let actor = Uuid::new_v4();
    let mentioned = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO durable_accounts (id,email,kind,temporary) VALUES ($1,$2,'human',false)",
    )
    .bind(actor_account)
    .bind(format!("actor-{actor_account}@example.test"))
    .execute(&pool)
    .await
    .unwrap();
    for (account, profile, handle) in [
        (author_account, author, "author-notify"),
        (actor_account, actor, "actor-notify"),
        (mentioned_account, mentioned, "mentioned-notify"),
    ] {
        store
            .register_identity(account, profile, handle, IdentityKind::Human, handle, "")
            .await
            .unwrap();
    }
    sqlx::query("INSERT INTO profile_ownership (owner_account_id,profile_id) VALUES ($1,$2)")
        .bind(actor_account)
        .bind(actor)
        .execute(&pool)
        .await
        .unwrap();
    let post = store
        .publish_post(
            author,
            Uuid::new_v4(),
            "notification target",
            None,
            PostVisibility::Public,
        )
        .await
        .unwrap();

    let push = PgPushStore::new(pool.clone());
    push.register_device(
        author_account,
        RegisterPushDevice {
            token: "22".repeat(32),
            environment: ApnsEnvironment::Sandbox,
            topic: "dev.fpl.tardy".into(),
        },
    )
    .await
    .unwrap();

    store.follow(actor, author).await.unwrap();
    store.follow(actor, author).await.unwrap();
    let author_profile = store.app_account_by_id(author).await.unwrap();
    let actor_profile = store.app_account_by_id(actor).await.unwrap();
    assert_eq!(author_profile.followers, 1);
    assert_eq!(actor_profile.following, 1);
    store.set_post_liked(actor, post.id, true).await.unwrap();
    store.set_post_liked(actor, post.id, true).await.unwrap();
    store
        .set_post_marker(actor, post.id, "alarm", true)
        .await
        .unwrap();
    store
        .set_post_marker(actor, post.id, "repost", true)
        .await
        .unwrap();
    let marked = store.app_post(Some(actor), post.id).await.unwrap();
    assert_eq!(marked.alarm_count, 1);
    assert_eq!(marked.repost_count, 1);
    assert!(marked.viewer_has_alarm);
    assert!(marked.viewer_has_reposted);
    store
        .set_post_marker(actor, post.id, "repost", false)
        .await
        .unwrap();
    assert!(
        !store
            .app_post(Some(actor), post.id)
            .await
            .unwrap()
            .viewer_has_reposted
    );

    let mut ownership = vec![store.app_account_by_id(actor).await.unwrap()];
    store
        .mark_owned_accounts(actor_account, &mut ownership)
        .await
        .unwrap();
    assert_eq!(ownership[0].owned_by_viewer, Some(true));
    store
        .comment(
            actor,
            post.id,
            "@mentioned-notify take a look",
            &[mentioned],
        )
        .await
        .unwrap();

    let author_notifications = push.notifications(author_account, 10).await.unwrap();
    assert_eq!(
        author_notifications
            .iter()
            .map(|notification| notification.kind.as_str())
            .collect::<Vec<_>>(),
        vec!["comment", "like", "follow"]
    );
    assert_eq!(
        author_notifications
            .iter()
            .filter(|notification| notification.post_id == Some(post.id))
            .count(),
        2
    );
    let mentioned_notifications = push.notifications(mentioned_account, 10).await.unwrap();
    assert_eq!(mentioned_notifications.len(), 1);
    assert_eq!(mentioned_notifications[0].kind, "mention");
    assert_eq!(mentioned_notifications[0].post_id, Some(post.id));
    let deliveries: i64 = sqlx::query_scalar("SELECT count(*) FROM push_deliveries")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(deliveries, 0, "social pushes are opt-in by default");
}

async fn setup() -> Option<(sqlx::PgPool, PgSocialStore)> {
    let url = std::env::var("TEST_DATABASE_URL").ok()?;
    let pool = sqlx::PgPool::connect(&url).await.unwrap();
    sqlx::migrate!().run(&pool).await.unwrap();
    sqlx::query("TRUNCATE push_deliveries,push_notifications,notification_preferences,push_devices,comment_mentions,post_comments,tardy_posts,conversation_agent_grants,conversation_messages,conversation_participants,conversations,profile_follows,social_identities,shared_links,webhook_deliveries,feed_subscriptions,feed_events,outbox RESTART IDENTITY CASCADE").execute(&pool).await.unwrap();
    Some((pool.clone(), PgSocialStore::new(pool)))
}
