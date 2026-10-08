use std::sync::Arc;
use tardy::ads::{HttpX402Facilitator, PaymentRequirements, PgAdsStore};
use tardy::api::AdsRuntime;
use tardy::apple_auth::AppleAuthenticator;
use tardy::audio::PgAudioStore;
use tardy::media::MediaService;
use tardy::pg_accounts::PgAccountStore;
use tardy::push::PgPushStore;
use tardy::social::PgSocialStore;
use tardy::subscriptions::PgSubscriptionStore;
use tardy::web_billing::{PgWebBillingStore, StripeConfig};
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
    state = state.with_media_service(MediaService::from_env_with_pool(pool.clone())?);
    state = state.with_push_store(PgPushStore::new(pool.clone()));
    state = state.with_pg_accounts(PgAccountStore::new(pool.clone()));
    state = state.with_social_store(PgSocialStore::new(pool.clone()));
    state = state.with_mcp_bridges(tardy::mcp_bridges::PgMcpBridgeStore::new(pool.clone()));
    if let Some(bridge) = tardy::fpl_bridge::FplBridgeRuntime::from_env(pool.clone())? {
        state = state.with_fpl_bridge(bridge);
    }
    state = state.with_audio_store(PgAudioStore::new(pool.clone()));
    let web_base_url =
        std::env::var("TARDY_WEB_BASE_URL").unwrap_or_else(|_| "https://tardy.news".into());
    let stripe = StripeConfig::from_env(web_base_url.clone())?;
    if stripe.is_none() {
        tracing::warn!("STRIPE_SECRET_KEY is unset; Stripe checkout is disabled");
    }
    state = state.with_web_billing(PgWebBillingStore::new(pool.clone(), web_base_url, stripe));
    {
        let client_id = std::env::var("APPLE_CLIENT_ID")
            .map(Ok)
            .unwrap_or_else(|_| AppleAuthenticator::native_client_id())?;
        let apple_auth = AppleAuthenticator::new(client_id)?;
        let warmer = apple_auth.clone();
        tokio::spawn(async move {
            if let Err(error) = warmer.prewarm().await {
                tracing::warn!(%error, "Apple signing-key prewarm failed; first sign-in will retry");
            }
        });
        state = state.with_apple_auth(apple_auth);
    }
    let github_id = std::env::var("GITHUB_CLIENT_ID").ok();
    let github_secret = std::env::var("GITHUB_CLIENT_SECRET").ok();
    let github_callback = std::env::var("GITHUB_REDIRECT_URI").ok();
    match (github_id, github_secret, github_callback) {
        (None, None, None) => tracing::warn!("GitHub identity onboarding is disabled"),
        (Some(id), Some(secret), Some(callback)) => {
            state = state.with_github_auth(tardy::github_auth::GithubAuthenticator::new(
                id, secret, callback,
            )?);
        }
        _ => return Err("GitHub OAuth configuration is incomplete".into()),
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
    tokio::spawn(tardy::usage_metrics::collect(
        pool.clone(),
        state.metrics.clone(),
    ));
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
    let lifetime = std::env::var("TARDY_MAX_RUNTIME_SECONDS")
        .ok()
        .map(|value| value.parse::<u64>())
        .transpose()?;
    if lifetime == Some(0) {
        return Err("TARDY_MAX_RUNTIME_SECONDS must be positive".into());
    }
    let server = axum::serve(listener, router(state)).with_graceful_shutdown(shutdown(lifetime));
    if let Some(seconds) = lifetime {
        // SSE clients can otherwise keep a gracefully draining process alive past
        // its credential lease. The development supervisor reconnects them.
        match tokio::time::timeout(
            std::time::Duration::from_secs(seconds.saturating_add(15)),
            std::future::IntoFuture::into_future(server),
        )
        .await
        {
            Ok(result) => result?,
            Err(_) => tracing::warn!("bounded API lifetime ended after drain window"),
        }
    } else {
        server.await?;
    }
    Ok(())
}

fn required(name: &str) -> Result<String, Box<dyn std::error::Error>> {
    std::env::var(name).map_err(|_| format!("{name} is required").into())
}

async fn shutdown(lifetime: Option<u64>) {
    let deadline = async {
        match lifetime {
            Some(seconds) => tokio::time::sleep(std::time::Duration::from_secs(seconds)).await,
            None => std::future::pending::<()>().await,
        }
    };
    #[cfg(unix)]
    let terminate = async {
        let mut signal = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("SIGTERM handler");
        signal.recv().await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {},
        _ = terminate => {},
        _ = deadline => tracing::info!("renewing scoped development credential lease"),
    }
}
