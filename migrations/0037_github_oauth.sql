CREATE TABLE github_oauth_attempts (
    state_hash bytea PRIMARY KEY,
    code_challenge text NOT NULL,
    link_account_id uuid REFERENCES durable_accounts(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX github_oauth_attempts_expiry ON github_oauth_attempts(expires_at);
