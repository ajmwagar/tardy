CREATE TABLE conversation_drafts (
    conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_profile_id uuid NOT NULL REFERENCES social_identities(profile_id) ON DELETE CASCADE,
    body text NOT NULL CHECK (char_length(body) <= 20000),
    status text NOT NULL DEFAULT 'writing' CHECK (status IN ('writing','tool','finalizing')),
    updated_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (conversation_id, sender_profile_id)
);

CREATE INDEX conversation_drafts_expiry_idx ON conversation_drafts (expires_at);
