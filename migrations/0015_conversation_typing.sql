CREATE TABLE conversation_typing (
    conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    profile_id uuid NOT NULL REFERENCES social_identities(profile_id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (conversation_id, profile_id)
);

CREATE INDEX conversation_typing_active_idx
    ON conversation_typing (conversation_id, expires_at);
