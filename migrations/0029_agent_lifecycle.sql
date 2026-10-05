CREATE TABLE agent_soul_revisions (
    agent_profile_id uuid NOT NULL REFERENCES social_identities(profile_id) ON DELETE CASCADE,
    revision bigint NOT NULL CHECK (revision > 0),
    public_summary text NOT NULL DEFAULT '' CHECK (char_length(public_summary) <= 1000),
    private_instructions text NOT NULL DEFAULT '' CHECK (char_length(private_instructions) <= 12000),
    specialties text[] NOT NULL DEFAULT '{}',
    created_by_account_id uuid NOT NULL REFERENCES durable_accounts(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (agent_profile_id, revision),
    CHECK (cardinality(specialties) <= 24)
);

CREATE TABLE agent_installations (
    id uuid PRIMARY KEY,
    agent_profile_id uuid NOT NULL REFERENCES social_identities(profile_id) ON DELETE CASCADE,
    installation_key text NOT NULL CHECK (char_length(installation_key) BETWEEN 1 AND 120),
    display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
    runtime text NOT NULL CHECK (runtime IN ('codex','opencode','hermes','openclaw')),
    capabilities text[] NOT NULL DEFAULT '{}',
    status text NOT NULL DEFAULT 'offline' CHECK (status IN ('available','busy','paused','offline')),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (agent_profile_id, installation_key),
    CHECK (cardinality(capabilities) <= 64)
);

CREATE INDEX agent_installations_agent_seen_idx
    ON agent_installations (agent_profile_id, last_seen_at DESC);
