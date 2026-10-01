use tardy::audio::{
    AttachPostAudio, AudioError, AudioUsage, AudioUsageKind, NewAudioRelease, NewOriginalTrack,
    PgAudioStore, ReleaseType,
};
use uuid::Uuid;

#[tokio::test]
async fn creator_album_is_fingerprinted_cleared_attached_and_trended() {
    let Ok(url) = std::env::var("TEST_DATABASE_URL") else {
        return;
    };
    let pool = sqlx::PgPool::connect(&url).await.unwrap();
    sqlx::migrate!().run(&pool).await.unwrap();
    sqlx::query("TRUNCATE audio_royalty_ledger,audio_usage_events,post_audio,audio_recognition_matches,audio_rights_grants,audio_tracks,audio_releases,tardy_posts,social_identities,outbox CASCADE").execute(&pool).await.unwrap();
    let creator = Uuid::new_v4();
    sqlx::query("INSERT INTO social_identities (profile_id,account_id,handle,kind) VALUES ($1,$2,'music_agent','agent')").bind(creator).bind(Uuid::new_v4()).execute(&pool).await.unwrap();
    let store = PgAudioStore::new(pool.clone());
    let release = store
        .create_release(
            creator,
            NewAudioRelease {
                title: "Compile Time".into(),
                release_type: ReleaseType::Album,
                artwork_r2_key: Some("art/compile.webp".into()),
                release_date: None,
            },
        )
        .await
        .unwrap();
    let track = store
        .add_original_track(
            creator,
            release.id,
            NewOriginalTrack {
                track_number: 1,
                disc_number: 1,
                title: "Borrow Checker Blues".into(),
                artist_name: "Music Agent".into(),
                duration_ms: 120_000,
                audio_r2_key: "music/original.flac".into(),
                content_hash: "sha256:original".into(),
                credits: vec![
                    serde_json::json!({"name":"Music Agent","role":"writer, performer, producer"}),
                ],
                attests_controls_recording: true,
                attests_controls_composition: true,
                permits_commercial_use: true,
            },
        )
        .await
        .unwrap();
    assert_eq!(track.rights_status, "pending");
    let post = Uuid::new_v4();
    sqlx::query("INSERT INTO tardy_posts (id,author_profile_id,client_request_id,caption,visibility) VALUES ($1,$2,$3,'new album','public')").bind(post).bind(creator).bind(Uuid::new_v4()).execute(&pool).await.unwrap();
    assert!(matches!(
        store
            .attach(
                creator,
                post,
                AttachPostAudio {
                    track_id: track.id,
                    start_ms: 0,
                    duration_ms: 30_000,
                    volume_millipercent: 100_000
                }
            )
            .await,
        Err(AudioError::RightsNotCleared)
    ));
    store
        .record_recognition(track.id, "test-fingerprint", None)
        .await
        .unwrap();
    store
        .attach(
            creator,
            post,
            AttachPostAudio {
                track_id: track.id,
                start_ms: 0,
                duration_ms: 30_000,
                volume_millipercent: 100_000,
            },
        )
        .await
        .unwrap();
    let event = Uuid::new_v4();
    let usage = || AudioUsage {
        event_id: event,
        post_id: Some(post),
        kind: AudioUsageKind::QualifiedPlay,
        listen_ms: 30_000,
        territory: Some("US".into()),
    };
    store.usage(None, track.id, usage()).await.unwrap();
    store.usage(None, track.id, usage()).await.unwrap();
    let trending = store.trending(10).await.unwrap();
    assert_eq!(trending.len(), 1);
    assert_eq!(trending[0].uses_24h, 1);
    assert_eq!(trending[0].qualified_plays_24h, 1);
    let jobs: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM outbox WHERE topic='audio.recognition_requested.v1'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(jobs, 1);
    let ledger: i64 = sqlx::query_scalar("SELECT count(*) FROM audio_royalty_ledger")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(ledger, 4);
}
