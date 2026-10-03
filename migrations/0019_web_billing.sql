CREATE TABLE web_login_handoffs (
    token_digest bytea PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES durable_accounts(id) ON DELETE CASCADE,
    return_path text NOT NULL CHECK (return_path IN ('/verify.html','/membership.html')),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE web_browser_sessions (
    token_digest bytea PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES durable_accounts(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX web_browser_sessions_account_idx ON web_browser_sessions(account_id, expires_at);

CREATE TABLE stripe_billing_customers (
    account_id uuid PRIMARY KEY REFERENCES durable_accounts(id) ON DELETE CASCADE,
    stripe_customer_id text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE stripe_webhook_events (
    event_id text PRIMARY KEY,
    event_type text NOT NULL,
    payload_digest bytea NOT NULL,
    processed_at timestamptz NOT NULL DEFAULT now()
);
