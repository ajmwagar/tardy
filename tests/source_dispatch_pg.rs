use chrono::Utc;
use sqlx::PgPool;
use std::collections::BTreeMap;
use tardy::ingest::{
    CarouselPlan, NormalizedItem, RightsMode, RightsPolicy, SourceDefinition, TransformPlan,
    Transport,
};
use tardy::pg_ingest::PgIngestStore;
use tardy::social::PgSocialStore;
use tardy::source_dispatch::{DisabledCapabilities, SourceDispatcher};

#[tokio::test]
async fn source_event_becomes_one_attributed_public_feed_post() {
    let Ok(database_url) = std::env::var("TEST_DATABASE_URL") else {
        return;
    };
    let pool = PgPool::connect(&database_url).await.unwrap();
    let ingest = PgIngestStore::connect(&database_url, 2).await.unwrap();
    ingest.migrate().await.unwrap();
    sqlx::query(
        "TRUNCATE comment_mentions,post_comments,tardy_posts,conversation_agent_grants,
         conversation_messages,conversation_participants,conversations,profile_follows,
         social_identities,shared_links,outbox,transformation_runs,source_items,source_channels
         RESTART IDENTITY CASCADE",
    )
    .execute(&pool)
    .await
    .unwrap();

    let source = SourceDefinition {
        id: "example-news".into(),
        display_name: "Example News".into(),
        enabled: true,
        limit: 10,
        poll_interval_seconds: 300,
        poll_jitter_seconds: 60,
        transport: Transport::Rss {
            url: "https://example.test/feed.xml".into(),
        },
        rights: RightsPolicy {
            mode: RightsMode::Facts,
            attribution: "Example News".into(),
            commercial_use: true,
        },
        transform: "news".into(),
    };
    let item = NormalizedItem {
        source_id: source.id.clone(),
        external_id: "story-1".into(),
        title: "A useful update".into(),
        canonical_url: "https://example.test/story-1".into(),
        author: None,
        published_at_ms: None,
        summary: None,
        facts: BTreeMap::new(),
    };
    let plan = TransformPlan {
        headline: item.title.clone(),
        attribution: source.rights.attribution.clone(),
        source_url: item.canonical_url.clone(),
        carousel: CarouselPlan {
            format: "headline_source_v1".into(),
            slides: vec![item.title.clone(), source.rights.attribution.clone()],
        },
        llm: None,
        capabilities: vec![],
    };
    ingest
        .sync_sources(std::slice::from_ref(&source))
        .await
        .unwrap();
    sqlx::query("UPDATE source_channels SET next_poll_at=now() WHERE id=$1")
        .bind(&source.id)
        .execute(&pool)
        .await
        .unwrap();
    ingest
        .claim_due_source("poller", 60)
        .await
        .unwrap()
        .unwrap();
    ingest
        .record_success("poller", &source, &[(item, plan)], None, None, Utc::now())
        .await
        .unwrap();

    let event = ingest
        .claim_outbox_topic("dispatcher", "source.item_ingested.v1", 1)
        .await
        .unwrap()
        .pop()
        .unwrap();
    let dispatcher = SourceDispatcher::new(pool.clone());
    let post_id = dispatcher
        .dispatch("dispatcher", &event, &DisabledCapabilities)
        .await
        .unwrap();

    let feed = PgSocialStore::new(pool.clone())
        .app_feed(None, 10)
        .await
        .unwrap();
    assert_eq!(feed.len(), 1);
    assert_eq!(feed[0].id, post_id);
    assert_eq!(feed[0].caption, "A useful update\n\nSource: Example News");
    assert_eq!(feed[0].links[0]["url"], "https://example.test/story-1");
    let output: serde_json::Value = sqlx::query_scalar("SELECT output FROM transformation_runs")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(output["post_id"], post_id.to_string());

    // A redelivery after acknowledgement loss is safe: it marks the event again
    // without creating another post.
    sqlx::query(
        "UPDATE outbox SET delivered_at=NULL,lease_owner='dispatcher',lease_until=now()+interval '60 seconds'
         WHERE id=$1",
    )
    .bind(event.id)
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        dispatcher
            .dispatch("dispatcher", &event, &DisabledCapabilities)
            .await
            .unwrap(),
        post_id
    );
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM tardy_posts")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 1);

    sqlx::query(
        "UPDATE transformation_runs SET status='planned',plan=jsonb_set(plan,'{headline}','\"\"')",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE outbox SET delivered_at=NULL,failed_at=NULL,lease_owner='dispatcher',lease_until=now()+interval '60 seconds'
         WHERE id=$1",
    )
    .bind(event.id)
    .execute(&pool)
    .await
    .unwrap();
    let error = dispatcher
        .dispatch("dispatcher", &event, &DisabledCapabilities)
        .await
        .unwrap_err();
    dispatcher
        .quarantine("dispatcher", &event, &error.to_string())
        .await
        .unwrap();
    let status: String = sqlx::query_scalar("SELECT status FROM transformation_runs")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "quarantined");
    let failed: bool = sqlx::query_scalar("SELECT failed_at IS NOT NULL FROM outbox WHERE id=$1")
        .bind(event.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(failed);
}
