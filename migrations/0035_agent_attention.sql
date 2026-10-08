-- Durable notification deduplication, independent of the expiring stream draft.
CREATE TABLE agent_attention_events (
    conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    agent_profile_id uuid NOT NULL REFERENCES social_identities(profile_id) ON DELETE CASCADE,
    activity_id text NOT NULL CHECK (char_length(activity_id) BETWEEN 1 AND 200),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, agent_profile_id, activity_id)
);

ALTER TABLE conversation_messages ADD COLUMN client_request_id uuid;
ALTER TABLE conversation_messages ADD COLUMN request_digest bytea;
CREATE UNIQUE INDEX conversation_message_request_idx
    ON conversation_messages(conversation_id,sender_profile_id,client_request_id)
    WHERE client_request_id IS NOT NULL;
