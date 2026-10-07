use tardy::pg_accounts::{PgAccountError, PgAccountStore};
use uuid::Uuid;

async fn store() -> Option<(PgAccountStore, sqlx::PgPool)> {
    let database_url = std::env::var("TEST_DATABASE_URL").ok()?;
    assert!(
        database_url.ends_with("/tardy_launch_auth_20261007"),
        "auth fixtures require the isolated launch auth database"
    );
    // This suite creates disposable fixtures. Never point it at production.
    let pool = sqlx::PgPool::connect(&database_url).await.unwrap();
    sqlx::migrate!().run(&pool).await.unwrap();
    Some((PgAccountStore::new(pool.clone()), pool))
}

#[tokio::test]
async fn oauth_attempts_are_pkce_bound_one_use_expiring_and_actor_bound() {
    let Some((store, _)) = store().await else {
        return;
    };
    let now = 1_800_000_000_000;
    let attempt = store
        .begin_github_oauth("challenge", None, now)
        .await
        .unwrap();
    assert!(
        store
            .consume_github_oauth(&attempt, "wrong", None, now)
            .await
            .is_err()
    );
    let (first, second) = tokio::join!(
        store.consume_github_oauth(&attempt, "challenge", None, now),
        store.consume_github_oauth(&attempt, "challenge", None, now)
    );
    assert_eq!(usize::from(first.is_ok()) + usize::from(second.is_ok()), 1);
    let expired = store
        .begin_github_oauth("challenge", None, now)
        .await
        .unwrap();
    assert!(
        store
            .consume_github_oauth(&expired, "challenge", None, now + 600_000)
            .await
            .is_err()
    );
    let owner = store
        .sign_in_apple(
            &Uuid::new_v4().to_string(),
            None,
            None,
            Uuid::new_v4().as_bytes(),
            now,
        )
        .await
        .unwrap();
    let bound = store
        .begin_github_oauth("challenge", Some(owner.profile.account_id), now)
        .await
        .unwrap();
    assert!(
        store
            .consume_github_oauth(&bound, "challenge", None, now)
            .await
            .is_err()
    );
    assert!(
        store
            .consume_github_oauth(&bound, "challenge", Some(Uuid::new_v4()), now)
            .await
            .is_err()
    );
    store
        .consume_github_oauth(&bound, "challenge", Some(owner.profile.account_id), now)
        .await
        .unwrap();
}

#[tokio::test]
async fn github_uses_provider_subject_and_explicit_link_not_email_or_login() {
    let Some((store, _)) = store().await else {
        return;
    };
    let now = 1_800_000_000_000;
    let subject = Uuid::new_v4().to_string();
    let first = store
        .sign_in_github(
            &subject,
            "Mutable login",
            &Uuid::new_v4().to_string(),
            None,
            now,
        )
        .await
        .unwrap();
    let again = store
        .sign_in_github(
            &subject,
            "Changed login",
            &Uuid::new_v4().to_string(),
            None,
            now,
        )
        .await
        .unwrap();
    assert_eq!(first.profile.account_id, again.profile.account_id);
    assert_eq!(first.profile.profile_id, again.profile.profile_id);
    let owner = store
        .sign_in_apple(
            &Uuid::new_v4().to_string(),
            None,
            None,
            Uuid::new_v4().as_bytes(),
            now,
        )
        .await
        .unwrap();
    assert!(matches!(
        store
            .sign_in_github(
                &subject,
                "Name",
                &Uuid::new_v4().to_string(),
                Some(owner.profile.account_id),
                now
            )
            .await,
        Err(PgAccountError::IdentityConflict)
    ));
    let linked = store
        .sign_in_github(
            &Uuid::new_v4().to_string(),
            "Name",
            &Uuid::new_v4().to_string(),
            Some(owner.profile.account_id),
            now,
        )
        .await
        .unwrap();
    assert_eq!(linked.profile.account_id, owner.profile.account_id);
    assert_eq!(linked.profile, owner.profile);
    assert_eq!(linked.provider, "github");
    store
        .resume_human_session(&linked.token, now)
        .await
        .unwrap();
}

#[tokio::test]
async fn apple_does_not_silently_link_by_email() {
    let Some((store, _)) = store().await else {
        return;
    };
    let now = 1_800_000_000_000;
    let email = format!("{}@example.test", Uuid::new_v4());
    let owner = store
        .sign_in_apple(
            &Uuid::new_v4().to_string(),
            Some(&email),
            None,
            Uuid::new_v4().as_bytes(),
            now,
        )
        .await
        .unwrap();
    let other_subject = Uuid::new_v4().to_string();
    assert!(matches!(
        store
            .sign_in_apple(
                &other_subject,
                Some(&email),
                None,
                Uuid::new_v4().as_bytes(),
                now
            )
            .await,
        Err(PgAccountError::EmailConflict)
    ));
    let linked = store
        .link_apple(
            owner.profile.account_id,
            &other_subject,
            Some(&email),
            None,
            Uuid::new_v4().as_bytes(),
            now,
        )
        .await
        .unwrap();
    assert_eq!(linked.profile.account_id, owner.profile.account_id);
}

#[tokio::test]
async fn deletion_intake_prevents_provider_reissuance_linking_and_dev_sessions() {
    let Some((store, pool)) = store().await else {
        return;
    };
    let now = 1_800_000_000_000;
    let subject = Uuid::new_v4().to_string();
    let email = format!("{}@example.test", Uuid::new_v4());
    let owner = store
        .sign_in_apple(&subject, Some(&email), None, Uuid::new_v4().as_bytes(), now)
        .await
        .unwrap();
    let github_id = Uuid::new_v4().to_string();
    let linked = store
        .sign_in_github(
            &github_id,
            "Name",
            &Uuid::new_v4().to_string(),
            Some(owner.profile.account_id),
            now,
        )
        .await
        .unwrap();
    store
        .request_deletion(owner.profile.account_id)
        .await
        .unwrap();
    assert!(store.resume_human_session(&owner.token, now).await.is_err());
    assert!(
        store
            .resume_human_session(&linked.token, now)
            .await
            .is_err()
    );
    assert!(
        store
            .sign_in_apple(&subject, Some(&email), None, Uuid::new_v4().as_bytes(), now)
            .await
            .is_err()
    );
    assert!(
        store
            .sign_in_github(&github_id, "Name", &Uuid::new_v4().to_string(), None, now)
            .await
            .is_err()
    );
    assert!(
        store
            .sign_in_github(
                &Uuid::new_v4().to_string(),
                "Name",
                &Uuid::new_v4().to_string(),
                Some(owner.profile.account_id),
                now
            )
            .await
            .is_err()
    );
    assert!(store.development_session(&email, now).await.is_err());
    sqlx::query("UPDATE account_deletion_requests SET status='completed' WHERE account_id=$1")
        .bind(owner.profile.account_id)
        .execute(&pool)
        .await
        .unwrap();
    assert!(
        store
            .sign_in_apple(&subject, Some(&email), None, Uuid::new_v4().as_bytes(), now)
            .await
            .is_err()
    );
}
