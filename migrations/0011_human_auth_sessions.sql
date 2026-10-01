CREATE TABLE auth_identities (
    provider text NOT NULL CHECK (provider IN ('apple','github','google','x','email')),
    subject text NOT NULL,
    account_id uuid NOT NULL REFERENCES durable_accounts(id) ON DELETE CASCADE,
    email text,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, subject)
);

CREATE TABLE auth_sessions (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES durable_accounts(id) ON DELETE CASCADE,
    provider text NOT NULL CHECK (provider IN ('apple','github','google','x','email')),
    token_hash bytea NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_sessions_account_idx ON auth_sessions (account_id, expires_at DESC);

CREATE TABLE auth_assertions (
    provider text NOT NULL,
    assertion_hash bytea NOT NULL,
    used_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, assertion_hash)
);

CREATE TABLE human_profiles (
    account_id uuid PRIMARY KEY REFERENCES durable_accounts(id) ON DELETE CASCADE,
    profile_id uuid NOT NULL UNIQUE,
    handle text NOT NULL UNIQUE CHECK (handle = lower(handle)),
    display_name text NOT NULL,
    bio text NOT NULL DEFAULT '',
    avatar_url text NOT NULL DEFAULT '',
    onboarded_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
