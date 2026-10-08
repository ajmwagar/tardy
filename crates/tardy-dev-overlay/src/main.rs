use std::sync::Arc;
use tardy_dev_overlay::{DevOverlay, router};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let bind = std::env::var("TARDY_DEV_OVERLAY_BIND").unwrap_or_else(|_| "127.0.0.1:3400".into());
    let database = std::env::var("TARDY_DEV_OVERLAY_DATABASE_URL")?;
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(4)
        .connect(&database)
        .await?;
    sqlx::migrate!("./migrations").run(&pool).await?;
    let overlay = DevOverlay::production(pool)?;
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    eprintln!(
        "Tardy dev overlay listening on {bind}; normal writes go to production; drafts stay local"
    );
    axum::serve(listener, router(Arc::new(overlay))).await?;
    Ok(())
}
