use std::sync::Arc;
use tardy::ads::{HttpX402Facilitator, PaymentRequirements, PgAdsStore};
use tardy::api::AdsRuntime;
use tardy::apple_auth::AppleAuthenticator;
use tardy::audio::PgAudioStore;
use tardy::pg_accounts::PgAccountStore;
use tardy::push::PgPushStore;
use tardy::social::PgSocialStore;
use tardy::subscriptions::PgSubscriptionStore;
use tardy::{AppState, router};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    let bind = std::env::var("TARDY_BIND").unwrap_or_else(|_| "127.0.0.1:3000".into());
    let public_base_url =
        std::env::var("TARDY_PUBLIC_BASE_URL").unwrap_or_else(|_| format!("http://{bind}"));
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    tracing::info!(%bind, %public_base_url, delivery = "fab", "tardy listening");
    let database_url = required("DATABASE_URL")?;
    let mut state = AppState::postgres(public_base_url)?;
    tracing::info!(ranker = state.ranker.name(), "for you ranker selected");
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(8)
        .connect(&database_url)
        .await?;
    sqlx::migrate!().run(&pool).await?;
    state = state.with_push_store(PgPushStore::new(pool.clone()));
    state = state.with_pg_accounts(PgAccountStore::new(pool.clone()));
    state = state.with_social_store(PgSocialStore::new(pool.clone()));
    state = state.with_audio_store(PgAudioStore::new(pool.clone()));
    if let Ok(client_id) = std::env::var("APPLE_CLIENT_ID") {
        state = state.with_apple_auth(AppleAuthenticator::new(client_id)?);
    } else {
        tracing::warn!("APPLE_CLIENT_ID is unset; Sign in with Apple is disabled");
    }
    let subscription_base_url = state.public_base_url.clone();
    state = state.with_subscriptions(PgSubscriptionStore::new(
        pool.clone(),
        subscription_base_url,
        std::env::var("WEBHOOK_SIGNING_KEY")
            .ok()
            .map(String::into_bytes),
    ));
    if let Ok(facilitator_url) = std::env::var("X402_FACILITATOR_URL") {
        let processor = HttpX402Facilitator::new(
            facilitator_url,
            std::env::var("X402_FACILITATOR_BEARER_TOKEN").ok(),
        )?;
        let atomic_per_budget_micro = required("X402_ATOMIC_PER_BUDGET_MICRO")?.parse()?;
        state = state.with_ads(AdsRuntime {
            store: PgAdsStore::new(pool.clone()),
            processor: Arc::new(processor),
            requirement: PaymentRequirements {
                scheme: std::env::var("X402_SCHEME").unwrap_or_else(|_| "exact".into()),
                network: required("X402_NETWORK")?,
                amount: String::new(),
                asset: required("X402_ASSET")?,
                pay_to: required("X402_PAY_TO")?,
                max_timeout_seconds: 300,
                extra: serde_json::Map::new(),
            },
            atomic_per_budget_micro,
        });
    }
    let state = Arc::new(state);
    if state.social.is_some() {
        let cleanup_state = state.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(15 * 60));
            loop {
                interval.tick().await;
                match cleanup_state.purge_expired_unclaimed_tardies().await {
                    Ok(count) if count > 0 => {
                        tracing::info!(count, "purged expired unclaimed Tardies")
                    }
                    Ok(_) => {}
                    Err(error) => {
                        tracing::error!(?error, "failed to purge expired unclaimed Tardies")
                    }
                }
            }
        });
    }
    axum::serve(listener, router(state))
        .with_graceful_shutdown(shutdown())
        .await?;
    Ok(())
}

fn required(name: &str) -> Result<String, Box<dyn std::error::Error>> {
    std::env::var(name).map_err(|_| format!("{name} is required").into())
}

async fn shutdown() {
    let _ = tokio::signal::ctrl_c().await;
}
