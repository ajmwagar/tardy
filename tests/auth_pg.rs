use tardy::pg_accounts::{PgAccountError, PgAccountStore};

#[tokio::test]
async fn apple_identity_creates_resumable_per_device_session() {
    let Ok(database_url) = std::env::var("TEST_DATABASE_URL") else {
        return;
    };
    let pool = sqlx::PgPool::connect(&database_url).await.unwrap();
    sqlx::migrate!().run(&pool).await.unwrap();
    sqlx::query("TRUNCATE auth_assertions,auth_sessions,auth_identities,human_profiles,profile_follows,social_identities,profile_actors,profile_ownership,durable_claim_codes,account_api_tokens,durable_accounts CASCADE")
        .execute(&pool).await.unwrap();
    let store = PgAccountStore::new(pool);
    let now = 1_800_000_000_000;
    let signed_in = store
        .sign_in_apple(
            "apple-stable-subject",
            Some("Person@Example.com"),
            Some("Person Example"),
            b"unique-assertion-one",
            now,
        )
        .await
        .unwrap();
    assert!(matches!(
        store
            .sign_in_apple(
                "apple-stable-subject",
                Some("person@example.com"),
                None,
                b"unique-assertion-one",
                now + 1,
            )
            .await,
        Err(PgAccountError::AssertionReplayed)
    ));
    assert_eq!(signed_in.provider, "apple");
    assert_eq!(signed_in.profile.display_name, "Person Example");
    assert!(signed_in.profile.onboarded_at_ms.is_none());
    let profile = store
        .set_human_handle(signed_in.profile.account_id, "person.example")
        .await
        .unwrap();
    assert_eq!(profile.handle, "person.example");
    assert!(profile.onboarded_at_ms.is_none());
    let profile = store
        .update_human_profile(
            signed_in.profile.account_id,
            Some("Updated Person"),
            Some("Shipping Tardy."),
        )
        .await
        .unwrap();
    assert_eq!(profile.display_name, "Updated Person");
    assert_eq!(profile.bio, "Shipping Tardy.");
    let profile = store
        .set_human_avatar(
            signed_in.profile.account_id,
            "https://tardy.test/v1/avatars/seed",
        )
        .await
        .unwrap();
    assert_eq!(profile.avatar_url, "https://tardy.test/v1/avatars/seed");
    assert!(matches!(
        store
            .update_human_profile(signed_in.profile.account_id, Some(""), None)
            .await,
        Err(PgAccountError::InvalidDisplayName)
    ));
    let profile = store
        .complete_human_onboarding(signed_in.profile.account_id, now + 1)
        .await
        .unwrap();
    assert_eq!(profile.onboarded_at_ms, Some(now + 1));
    assert_eq!(
        store.authenticate(&signed_in.token, now).await.unwrap(),
        signed_in.profile.account_id
    );

    let resumed = store
        .resume_human_session(&signed_in.token, now + 1)
        .await
        .unwrap();
    assert_eq!(resumed.profile, profile);
    store
        .revoke_human_session(&signed_in.token, now + 2)
        .await
        .unwrap();
    assert!(matches!(
        store.resume_human_session(&signed_in.token, now + 3).await,
        Err(PgAccountError::InvalidClaim)
    ));
}
