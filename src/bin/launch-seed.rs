use sqlx::{Row, postgres::PgPoolOptions};

const EXPECTED_PROFILES: i64 = 17;
const EXPECTED_POSTS: i64 = 26;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let apply = std::env::args().nth(1).as_deref() == Some("apply");
    let database_url = std::env::var("DATABASE_URL")
        .map_err(|_| "DATABASE_URL is required through the runtime PostgreSQL binding")?;
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&database_url)
        .await?;

    if apply {
        if std::env::var("TARDY_DEPLOYMENT_ENV").as_deref() != Ok("tardy-prod")
            || std::env::var("TARDY_CONFIRM_LAUNCH_SEED").as_deref() != Ok("tardy-prod")
        {
            return Err("production apply requires TARDY_DEPLOYMENT_ENV=tardy-prod and TARDY_CONFIRM_LAUNCH_SEED=tardy-prod".into());
        }
        sqlx::raw_sql(include_str!("../../launch/seed.sql"))
            .execute(&pool)
            .await?;
    }

    let row = sqlx::query(
        "SELECT \
         (SELECT count(*) FROM social_identities WHERE account_id = md5('launch-account:'||handle)::uuid) AS profiles, \
         (SELECT count(*) FROM tardy_posts WHERE client_request_id IN (SELECT md5('dev-post-request:'||author.handle||':'||n)::uuid FROM social_identities author CROSS JOIN generate_series(1,4) n) OR client_request_id IN (SELECT md5('launch-fpl-request:'||n)::uuid FROM generate_series(1,4) n) OR id::text LIKE '10000000-0000-0000-0000-%') AS posts, \
         EXISTS(SELECT 1 FROM active_profile_badges WHERE profile_id=md5('dev-profile:fpl')::uuid AND verification_tier='real_tardy') AS fpl_verified",
    )
    .fetch_one(&pool)
    .await?;
    let profiles: i64 = row.try_get("profiles")?;
    let posts: i64 = row.try_get("posts")?;
    let fpl_verified: bool = row.try_get("fpl_verified")?;
    println!(
        "launch seed mode={} profiles={profiles}/{EXPECTED_PROFILES} posts={posts}/{EXPECTED_POSTS} fpl_verified={fpl_verified}",
        if apply { "apply" } else { "plan" }
    );
    if apply && (profiles != EXPECTED_PROFILES || posts != EXPECTED_POSTS || !fpl_verified) {
        return Err("launch seed validation counts did not match".into());
    }
    Ok(())
}
