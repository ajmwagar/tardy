use serde_json::Value;
use std::{
    collections::BTreeMap,
    env,
    path::Path,
    process::Stdio,
    time::{Duration, Instant},
};
use tokio::process::Command;

const ROOT_ENV: &str = ".env.local";
const MOBILE_ENV: &str = "mobile/.env.local";

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    load_env(ROOT_ENV)?;
    let command = env::args().nth(1).unwrap_or_else(|| "doctor".into());
    match command.as_str() {
        "doctor" => doctor().await,
        "expo" => {
            doctor().await?;
            println!("\nStarting Expo on the LAN (Ctrl-C stops it)...");
            let status = Command::new("npm")
                .args(["exec", "expo", "start", "--", "--lan", "--clear"])
                .current_dir("mobile")
                .stdin(Stdio::inherit())
                .stdout(Stdio::inherit())
                .stderr(Stdio::inherit())
                .status()
                .await?;
            if status.success() {
                Ok(())
            } else {
                Err(format!("Expo exited with {status}").into())
            }
        }
        _ => Err("usage: cargo run --bin tardy-dev -- [doctor|expo]".into()),
    }
}

async fn doctor() -> Result<(), Box<dyn std::error::Error>> {
    let mobile = read_env(MOBILE_ENV)?;
    let api = mobile
        .get("EXPO_PUBLIC_TARDY_API_URL")
        .filter(|v| !v.is_empty())
        .ok_or("mobile/.env.local must set EXPO_PUBLIC_TARDY_API_URL")?
        .trim_end_matches('/');
    let email = mobile
        .get("EXPO_PUBLIC_TARDY_DEV_EMAIL")
        .map(String::as_str)
        .unwrap_or("orangej20@gmail.com");
    let database_url =
        env::var("DATABASE_URL").map_err(|_| "DATABASE_URL is missing from .env.local")?;
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(Duration::from_secs(3))
        .connect(&database_url)
        .await?;
    let version: String = sqlx::query_scalar("SHOW server_version")
        .fetch_one(&pool)
        .await?;
    check("PG17", version.starts_with("17"), &version)?;
    let applied: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM _sqlx_migrations WHERE success")
        .fetch_one(&pool)
        .await?;
    let expected = std::fs::read_dir("migrations")?
        .filter_map(Result::ok)
        .filter(|e| e.path().extension().is_some_and(|x| x == "sql"))
        .count() as i64;
    check(
        "migrations",
        applied == expected,
        &format!("{applied}/{expected} applied"),
    )?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()?;
    let start = Instant::now();
    let health = client.get(format!("{api}/healthz")).send().await?;
    check(
        "Rust API",
        health.status().is_success(),
        &format!("{api} · {} ms", start.elapsed().as_millis()),
    )?;

    if api.contains(".ts.net") {
        let status = tailscale_status().await?;
        check(
            "Tailscale Serve",
            status.contains(api) || status.contains(":8443"),
            api,
        )?;
    } else {
        println!("SKIP Tailscale Serve  API URL is not a tailnet URL");
    }

    let response = client
        .post(format!("{api}/v1/dev/session"))
        .json(&serde_json::json!({"email": email}))
        .send()
        .await?;
    let status = response.status();
    let signed_in: Value = response.json().await.unwrap_or(Value::Null);
    check(
        "development auth",
        status.is_success(),
        &format!("{email} · HTTP {status}"),
    )?;
    let token = signed_in
        .pointer("/session/token")
        .and_then(Value::as_str)
        .ok_or("dev session omitted token")?;
    let profile = signed_in
        .pointer("/session/account_id")
        .and_then(Value::as_str)
        .ok_or("dev session omitted account_id")?;
    let feed = client
        .get(format!("{api}/v1/feed"))
        .bearer_auth(token)
        .header("x-tardy-profile-id", profile)
        .send()
        .await?;
    let feed_status = feed.status();
    let body: Value = feed.json().await.unwrap_or(Value::Null);
    let items = body
        .get("items")
        .and_then(Value::as_array)
        .ok_or("feed omitted items")?;
    check(
        "feed records",
        feed_status.is_success() && !items.is_empty(),
        &format!("{} posts", items.len()),
    )?;
    let media = items
        .iter()
        .flat_map(|p| {
            p.get("media")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        })
        .filter_map(|m| m.get("url").and_then(Value::as_str))
        .next()
        .ok_or("feed has no media URL")?;
    let media_response = client
        .get(media)
        .header(reqwest::header::RANGE, "bytes=0-0")
        .send()
        .await?;
    check(
        "media",
        media_response.status().is_success(),
        &format!("{} · HTTP {}", origin(media), media_response.status()),
    )?;
    println!("\nReady: run `cargo run --bin tardy-dev -- expo`");
    Ok(())
}

fn check(name: &str, ok: bool, detail: &str) -> Result<(), Box<dyn std::error::Error>> {
    if ok {
        println!("PASS {name:<18} {detail}");
        Ok(())
    } else {
        Err(format!("FAIL {name}: {detail}").into())
    }
}

fn origin(url: &str) -> &str {
    url.split_once("//")
        .and_then(|(_, rest)| rest.split('/').next())
        .unwrap_or(url)
}

async fn tailscale_status() -> Result<String, Box<dyn std::error::Error>> {
    let candidates = [
        "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
        "tailscale",
    ];
    for binary in candidates {
        if let Ok(output) = Command::new(binary)
            .args(["serve", "status"])
            .output()
            .await
        {
            if output.status.success() {
                return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
            }
        }
    }
    Err("Tailscale CLI unavailable or `tailscale serve status` failed".into())
}

fn load_env(path: impl AsRef<Path>) -> Result<(), Box<dyn std::error::Error>> {
    for (key, value) in read_env(path)? {
        if env::var_os(&key).is_none() {
            unsafe { env::set_var(key, value) };
        }
    }
    Ok(())
}

fn read_env(
    path: impl AsRef<Path>,
) -> Result<BTreeMap<String, String>, Box<dyn std::error::Error>> {
    let mut values = BTreeMap::new();
    for (line_no, raw) in std::fs::read_to_string(path.as_ref())?.lines().enumerate() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (key, raw_value) = line.split_once('=').ok_or_else(|| {
            format!(
                "{}:{} is not KEY=VALUE",
                path.as_ref().display(),
                line_no + 1
            )
        })?;
        let value = raw_value
            .trim()
            .trim_matches(|c| c == '\'' || c == '"')
            .to_owned();
        values.insert(key.trim().to_owned(), value);
    }
    Ok(values)
}
