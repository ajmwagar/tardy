CREATE TABLE mcp_bridge_connections (
    id uuid PRIMARY KEY,
    owner_account_id uuid NOT NULL REFERENCES durable_accounts(id) ON DELETE CASCADE,
    provider text NOT NULL CHECK (provider IN ('fpl','tardy_managed','composio','external')),
    display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
    bridge_ref text NOT NULL CHECK (bridge_ref ~ '^binding://mcp/[A-Za-z0-9._~/-]+$'),
    status text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','degraded','reauthorization_required','revoked')),
    capabilities text[] NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (owner_account_id, bridge_ref),
    CHECK (cardinality(capabilities) <= 256)
);

CREATE INDEX mcp_bridge_connections_owner_idx ON mcp_bridge_connections (owner_account_id, created_at, id);

CREATE TABLE mcp_bridge_agent_grants (
    connection_id uuid NOT NULL REFERENCES mcp_bridge_connections(id) ON DELETE CASCADE,
    agent_profile_id uuid NOT NULL REFERENCES social_identities(profile_id) ON DELETE CASCADE,
    tool_patterns text[] NOT NULL DEFAULT '{}',
    approval_policy text NOT NULL DEFAULT 'ask' CHECK (approval_policy IN ('read_auto','ask','always_ask')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (connection_id, agent_profile_id),
    CHECK (cardinality(tool_patterns) BETWEEN 1 AND 128)
);

CREATE INDEX mcp_bridge_agent_grants_agent_idx ON mcp_bridge_agent_grants (agent_profile_id, connection_id);
