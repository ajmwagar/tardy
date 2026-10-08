/// Only named disposable fixtures or the exact loopback CI database are allowed.
pub fn assert_isolated_database(database_url: &str, local_name: &str) {
    let ci = std::env::var("CI").as_deref() == Ok("true");
    assert!(
        isolated_database(database_url, local_name, ci),
        "isolated test database required"
    );
}

fn isolated_database(database_url: &str, local_name: &str, ci: bool) -> bool {
    let Ok(url) = reqwest::Url::parse(database_url) else {
        return false;
    };
    let loopback = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    let database = url.path().trim_start_matches('/');
    matches!(url.scheme(), "postgres" | "postgresql")
        && loopback
        && (database == local_name || (ci && database == "tardy_test"))
}

#[test]
fn fixture_guard_rejects_real_databases_and_remote_hosts() {
    assert!(isolated_database(
        "postgres://localhost/fixture",
        "fixture",
        false
    ));
    assert!(isolated_database(
        "postgres://127.0.0.1/tardy_test",
        "fixture",
        true
    ));
    assert!(!isolated_database(
        "postgres://127.0.0.1/tardy_test",
        "fixture",
        false
    ));
    assert!(!isolated_database(
        "postgres://localhost/tardy_prod",
        "fixture",
        true
    ));
    assert!(!isolated_database(
        "postgres://prod.example/fixture",
        "fixture",
        true
    ));
    assert!(!isolated_database(
        "https://localhost/fixture",
        "fixture",
        true
    ));
}
