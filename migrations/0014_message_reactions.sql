CREATE TABLE conversation_message_reactions (
    message_id uuid NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
    reactor_profile_id uuid NOT NULL REFERENCES social_identities(profile_id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('like','love','laugh','emphasize','question','seen','done')),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (message_id, reactor_profile_id)
);

CREATE INDEX conversation_message_reactions_message_idx
    ON conversation_message_reactions (message_id, kind, reactor_profile_id);
