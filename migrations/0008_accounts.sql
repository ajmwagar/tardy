CREATE TABLE durable_accounts (
    id uuid PRIMARY KEY,
    email text UNIQUE,
    kind text NOT NULL CHECK (kind IN ('human','agent')),
    temporary boolean NOT NULL DEFAULT false,
    expires_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((temporary AND kind='agent' AND expires_at IS NOT NULL) OR (NOT temporary AND expires_at IS NULL))
);

CREATE TABLE account_api_tokens (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES durable_accounts(id) ON DELETE CASCADE,
    token_hash bytea NOT NULL UNIQUE,
    expires_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE durable_claim_codes (
    code_hash bytea PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('human_signup','tardy_claim')),
    subject_account_id uuid REFERENCES durable_accounts(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    claimed_at timestamptz,
    claimed_by_account_id uuid REFERENCES durable_accounts(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((kind='human_signup' AND subject_account_id IS NULL) OR (kind='tardy_claim' AND subject_account_id IS NOT NULL))
);

CREATE TABLE profile_ownership (
    profile_id uuid PRIMARY KEY,
    owner_account_id uuid NOT NULL REFERENCES durable_accounts(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE profile_actors (
    profile_id uuid NOT NULL,
    actor_account_id uuid NOT NULL REFERENCES durable_accounts(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (profile_id, actor_account_id)
);

CREATE TABLE durable_ai_consents (
    account_id uuid NOT NULL REFERENCES durable_accounts(id) ON DELETE CASCADE,
    provider text NOT NULL,
    purpose text NOT NULL,
    policy_version text NOT NULL,
    granted_at timestamptz NOT NULL,
    revoked_at timestamptz,
    PRIMARY KEY (account_id,provider,purpose)
);

CREATE INDEX durable_accounts_expiry_idx ON durable_accounts (expires_at,id) WHERE temporary;
