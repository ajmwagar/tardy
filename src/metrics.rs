use axum::extract::{MatchedPath, Request};
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use prometheus_client::encoding::EncodeLabelSet;
use prometheus_client::encoding::text::encode;
use prometheus_client::metrics::counter::Counter;
use prometheus_client::metrics::family::Family;
use prometheus_client::metrics::gauge::Gauge;
use prometheus_client::metrics::histogram::{Histogram, exponential_buckets};
use prometheus_client::registry::Registry;
use std::sync::Mutex;
use std::sync::atomic::AtomicI64;
use std::time::Instant;

#[derive(Clone, Debug, Hash, PartialEq, Eq, EncodeLabelSet)]
struct HttpLabels {
    method: String,
    route: String,
    status: String,
}

#[derive(Clone, Debug, Hash, PartialEq, Eq, EncodeLabelSet)]
struct UsageLabels {
    kind: String,
    window: String,
}

#[derive(Debug, sqlx::FromRow)]
pub struct UsageSnapshot {
    pub kind: String,
    pub window: String,
    pub active_accounts: i64,
    pub active_publishers: i64,
    pub posts_created: i64,
    pub engagements: i64,
}

pub struct Metrics {
    registry: Mutex<Registry>,
    requests: Family<HttpLabels, Counter>,
    durations: Family<HttpLabels, Histogram>,
    claims_issued: Counter,
    accounts_claimed: Counter,
    active_accounts: Family<UsageLabels, Gauge>,
    active_publishers: Family<UsageLabels, Gauge>,
    posts_created: Family<UsageLabels, Gauge>,
    engagements: Family<UsageLabels, Gauge>,
    usage_last_success: Gauge,
    usage_failures: Counter,
}

impl Metrics {
    pub fn new() -> Self {
        let requests = Family::<HttpLabels, Counter>::default();
        let durations = Family::<HttpLabels, Histogram>::new_with_constructor(|| {
            Histogram::new(exponential_buckets(0.005, 2.0, 12))
        });
        let claims_issued = Counter::default();
        let accounts_claimed = Counter::default();
        let active_accounts = Family::<UsageLabels, Gauge>::default();
        let active_publishers = Family::<UsageLabels, Gauge>::default();
        let posts_created = Family::<UsageLabels, Gauge>::default();
        let engagements = Family::<UsageLabels, Gauge>::default();
        let usage_last_success = Gauge::default();
        let usage_failures = Counter::default();
        let build = Gauge::<i64, AtomicI64>::default();
        build.set(1);

        let mut registry = Registry::default();
        registry.register(
            "tardy_http_requests",
            "Completed HTTP requests by method, matched route, and status.",
            requests.clone(),
        );
        registry.register(
            "tardy_http_request_duration_seconds",
            "HTTP request duration by method, matched route, and status.",
            durations.clone(),
        );
        registry.register(
            "tardy_agent_claim_codes_issued",
            "Agent onboarding claim codes issued.",
            claims_issued.clone(),
        );
        registry.register(
            "tardy_agent_accounts_claimed",
            "Agent accounts successfully claimed.",
            accounts_claimed.clone(),
        );
        registry.register("tardy_build_info", "Static service build marker.", build);
        registry.register("tardy_active_accounts", "Distinct durable accounts with a product action in a rolling window, by durable account kind.", active_accounts.clone());
        registry.register(
            "tardy_active_publishers",
            "Distinct posting profiles in a rolling window, attributed to durable account kind.",
            active_publishers.clone(),
        );
        registry.register(
            "tardy_posts_created",
            "Persisted posts created in a rolling window, including all visibility levels.",
            posts_created.clone(),
        );
        registry.register(
            "tardy_engagement_events",
            "Persisted engagement events in a rolling window.",
            engagements.clone(),
        );
        registry.register(
            "tardy_usage_last_success_timestamp_seconds",
            "Last successful durable usage snapshot; zero means no successful collection.",
            usage_last_success.clone(),
        );
        registry.register(
            "tardy_usage_collection_failures",
            "Failed durable usage collections; prior gauges remain unchanged.",
            usage_failures.clone(),
        );

        Self {
            registry: Mutex::new(registry),
            requests,
            durations,
            claims_issued,
            accounts_claimed,
            active_accounts,
            active_publishers,
            posts_created,
            engagements,
            usage_last_success,
            usage_failures,
        }
    }

    pub fn note_claim_issued(&self) {
        self.claims_issued.inc();
    }

    pub fn note_account_claimed(&self) {
        self.accounts_claimed.inc();
    }

    pub fn update_usage(&self, rows: Vec<UsageSnapshot>, timestamp: i64) {
        for row in rows {
            let labels = UsageLabels {
                kind: row.kind,
                window: row.window,
            };
            self.active_accounts
                .get_or_create(&labels)
                .set(row.active_accounts);
            self.active_publishers
                .get_or_create(&labels)
                .set(row.active_publishers);
            self.posts_created
                .get_or_create(&labels)
                .set(row.posts_created);
            self.engagements.get_or_create(&labels).set(row.engagements);
        }
        self.usage_last_success.set(timestamp);
    }

    pub fn note_usage_failure(&self) {
        self.usage_failures.inc();
    }

    pub fn encode(&self) -> Result<String, std::fmt::Error> {
        let registry = self
            .registry
            .lock()
            .expect("metrics registry lock poisoned");
        let mut output = String::new();
        encode(&mut output, &registry)?;
        Ok(output)
    }

    fn observe(&self, method: String, route: String, status: StatusCode, elapsed: f64) {
        let labels = HttpLabels {
            method,
            route,
            status: status.as_u16().to_string(),
        };
        self.requests.get_or_create(&labels).inc();
        self.durations.get_or_create(&labels).observe(elapsed);
    }
}

impl Default for Metrics {
    fn default() -> Self {
        Self::new()
    }
}

pub async fn track(metrics: std::sync::Arc<Metrics>, request: Request, next: Next) -> Response {
    let method = request.method().to_string();
    let route = request
        .extensions()
        .get::<MatchedPath>()
        .map(MatchedPath::as_str)
        .unwrap_or("unmatched")
        .to_owned();
    let started = Instant::now();
    let response = next.run(request).await;
    metrics.observe(
        method,
        route,
        response.status(),
        started.elapsed().as_secs_f64(),
    );
    response
}

pub fn response(metrics: &Metrics) -> Response {
    match metrics.encode() {
        Ok(body) => (
            StatusCode::OK,
            [(
                "content-type",
                "application/openmetrics-text; version=1.0.0; charset=utf-8",
            )],
            body,
        )
            .into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("failed to encode metrics: {error}"),
        )
            .into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_build_and_onboarding_metrics() {
        let metrics = Metrics::new();
        metrics.note_claim_issued();
        metrics.note_account_claimed();
        let output = metrics.encode().unwrap();
        assert!(output.contains("tardy_build_info 1"));
        assert!(output.contains("tardy_agent_claim_codes_issued_total 1"));
        assert!(output.contains("tardy_agent_accounts_claimed_total 1"));
    }

    #[test]
    fn usage_gauges_replace_snapshots_and_failures_preserve_them() {
        let metrics = Metrics::new();
        let row = |count| UsageSnapshot {
            kind: "human".into(),
            window: "24h".into(),
            active_accounts: count,
            active_publishers: 1,
            posts_created: 2,
            engagements: 3,
        };
        metrics.update_usage(vec![row(5)], 100);
        metrics.update_usage(vec![row(4)], 200);
        metrics.note_usage_failure();
        let output = metrics.encode().unwrap();
        assert!(output.contains("tardy_active_accounts{kind=\"human\",window=\"24h\"} 4"));
        assert!(output.contains("tardy_usage_last_success_timestamp_seconds 200"));
        assert!(output.contains("tardy_usage_collection_failures_total 1"));
        assert!(!output.contains("account_id"));
    }
}
