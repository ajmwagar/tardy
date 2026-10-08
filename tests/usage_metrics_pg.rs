use tardy::metrics::{PostUsageSnapshot, UsageSnapshot};

#[tokio::test]
async fn usage_windows_deduplicate_accounts_and_ignore_polling_temporary_and_future_activity() {
    let Ok(database) = std::env::var("TEST_DATABASE_URL") else {
        return;
    };
    let pool = sqlx::PgPool::connect(&database).await.unwrap();
    let mut tx = pool.begin().await.unwrap();
    // Temporary tables shadow the real schema on this connection: no production rows
    // are read or mutated, and concurrent suites cannot affect these exact counts.
    sqlx::raw_sql("CREATE TEMP TABLE durable_accounts(id uuid, kind text, temporary boolean) ON COMMIT DROP;
        CREATE TEMP TABLE social_identities(profile_id uuid, account_id uuid) ON COMMIT DROP;
        CREATE TEMP TABLE engagement_events(viewer_profile_id uuid, occurred_at timestamptz) ON COMMIT DROP;
        CREATE TEMP TABLE tardy_posts(author_profile_id uuid, created_at timestamptz, caption text DEFAULT '', visibility text DEFAULT 'private') ON COMMIT DROP;
        CREATE TEMP TABLE conversation_messages(sender_profile_id uuid, created_at timestamptz) ON COMMIT DROP;
        CREATE TEMP TABLE post_comments(author_profile_id uuid, created_at timestamptz) ON COMMIT DROP;
        INSERT INTO durable_accounts VALUES
          (md5('human')::uuid,'human',false),(md5('agent')::uuid,'agent',false),(md5('temporary')::uuid,'agent',true),(md5('polling')::uuid,'agent',false);
        INSERT INTO social_identities SELECT id,id FROM durable_accounts;
        INSERT INTO social_identities VALUES(md5('human-brand')::uuid,md5('human')::uuid);
        INSERT INTO engagement_events VALUES(md5('human')::uuid,now()),(md5('human')::uuid,now()),(md5('temporary')::uuid,now());
        INSERT INTO tardy_posts VALUES(md5('human-brand')::uuid,now()),(md5('agent')::uuid,now()-interval '2 days'),(md5('human')::uuid,now()+interval '1 day'),(md5('agent')::uuid,now()-interval '31 days');
        UPDATE tardy_posts SET caption='Hi🚀',visibility='public' WHERE author_profile_id=md5('human-brand')::uuid;
        UPDATE tardy_posts SET caption='abcd',visibility='followers' WHERE author_profile_id=md5('agent')::uuid;
        INSERT INTO tardy_posts VALUES(md5('human')::uuid,now(),'Private','private'),(md5('human')::uuid,now(),'Longer caption','private');
        INSERT INTO conversation_messages VALUES(md5('human')::uuid,now());")
        .execute(&mut *tx).await.unwrap();
    let rows: Vec<UsageSnapshot> = sqlx::query_as(include_str!("../src/usage_metrics.sql"))
        .fetch_all(&mut *tx)
        .await
        .unwrap();
    assert_eq!(rows.len(), 4);
    let human_day = rows
        .iter()
        .find(|r| r.kind == "human" && r.window == "24h")
        .unwrap();
    assert_eq!(human_day.active_accounts, 1);
    assert_eq!(human_day.posts_created, 3);
    assert_eq!(human_day.engagements, 2);
    let agent_day = rows
        .iter()
        .find(|r| r.kind == "agent" && r.window == "24h")
        .unwrap();
    assert_eq!(agent_day.active_accounts, 0);
    let agent_month = rows
        .iter()
        .find(|r| r.kind == "agent" && r.window == "30d")
        .unwrap();
    assert_eq!(agent_month.active_accounts, 1);
    assert_eq!(agent_month.active_publishers, 1);
    assert_eq!(agent_month.posts_created, 1);
    let posts: Vec<PostUsageSnapshot> =
        sqlx::query_as(include_str!("../src/post_usage_metrics.sql"))
            .fetch_all(&mut *tx)
            .await
            .unwrap();
    assert_eq!(posts.len(), 18);
    let public = posts
        .iter()
        .find(|r| r.kind == "human" && r.window == "24h" && r.visibility == "public")
        .unwrap();
    assert_eq!(public.post_count, 1);
    assert_eq!(public.caption_characters, 3); // Unicode characters, not UTF-8 bytes.
    let private = posts
        .iter()
        .find(|r| r.kind == "human" && r.window == "24h" && r.visibility == "private")
        .unwrap();
    assert_eq!(private.post_count, 2);
    assert_eq!(private.caption_characters, 21);
    let followers = posts
        .iter()
        .find(|r| r.kind == "agent" && r.window == "30d" && r.visibility == "followers")
        .unwrap();
    assert_eq!(followers.post_count, 1);
    assert_eq!(followers.caption_characters, 4);
    let zero = posts
        .iter()
        .find(|r| r.kind == "agent" && r.window == "24h" && r.visibility == "public")
        .unwrap();
    assert_eq!((zero.post_count, zero.caption_characters), (0, 0));
    assert_eq!(
        public.post_count + private.post_count,
        human_day.posts_created
    );
    let all = posts
        .iter()
        .find(|r| r.kind == "agent" && r.window == "all" && r.visibility == "followers")
        .unwrap();
    assert_eq!((all.post_count, all.caption_characters), (2, 8));
    tx.rollback().await.unwrap();
}
