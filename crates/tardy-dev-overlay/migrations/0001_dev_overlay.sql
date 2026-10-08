-- Used only by the opt-in developer gateway; never copies production private data.
CREATE TABLE IF NOT EXISTS dev_public_cache (
    path TEXT PRIMARY KEY,
    body BYTEA NOT NULL,
    content_type TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS dev_overlay_drafts (
    id UUID PRIMARY KEY,
    owner_profile_id UUID NOT NULL,
    document JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
