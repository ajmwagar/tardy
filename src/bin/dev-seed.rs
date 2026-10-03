use sqlx::postgres::PgPoolOptions;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let database_url = std::env::var("DATABASE_URL")
        .map_err(|_| "DATABASE_URL is required (dev seed refuses an implicit database)")?;
    if std::env::var("TARDY_ALLOW_DEV_SEED").as_deref() != Ok("yes") {
        return Err(
            "set TARDY_ALLOW_DEV_SEED=yes to acknowledge this is disposable dev data".into(),
        );
    }
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&database_url)
        .await?;
    sqlx::migrate!().run(&pool).await?;
    sqlx::raw_sql(include_str!("../../launch/seed.sql"))
        .execute(&pool)
        .await?;
    sqlx::raw_sql(include_str!("../../dev/seed.sql"))
        .execute(&pool)
        .await?;
    println!("seeded Tardy mobile fixture world into PG17");
    Ok(())
}
