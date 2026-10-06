CREATE TABLE agent_link_requests (
    id uuid PRIMARY KEY,
    agent_account_id uuid NOT NULL REFERENCES durable_accounts(id) ON DELETE CASCADE,
    agent_profile_id uuid NOT NULL REFERENCES social_identities(profile_id) ON DELETE CASCADE,
    owner_account_id uuid NOT NULL REFERENCES durable_accounts(id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL,
    decided_at timestamptz,
    UNIQUE (agent_account_id, owner_account_id),
    CHECK ((status = 'pending') = (decided_at IS NULL))
);
CREATE INDEX agent_link_requests_inbox_idx ON agent_link_requests(owner_account_id, created_at)
    WHERE status = 'pending';
