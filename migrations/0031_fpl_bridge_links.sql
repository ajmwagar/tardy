CREATE TABLE fpl_bridge_link_attempts (
    state_hash bytea PRIMARY KEY,
    owner_account_id uuid NOT NULL REFERENCES durable_accounts(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes'
);

CREATE TABLE fpl_bridge_links (
    owner_account_id uuid PRIMARY KEY REFERENCES durable_accounts(id) ON DELETE CASCADE,
    subject text NOT NULL UNIQUE,
    email text NOT NULL,
    linked_at timestamptz NOT NULL DEFAULT now()
);
