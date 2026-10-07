-- Metadata only: session history remains on the originating machine.
CREATE TABLE agent_session_chats (
    agent_profile_id uuid NOT NULL REFERENCES social_identities(profile_id) ON DELETE CASCADE,
    installation_key text NOT NULL CHECK (char_length(installation_key) BETWEEN 1 AND 120),
    thread_id text NOT NULL CHECK (char_length(thread_id) BETWEEN 1 AND 120),
    conversation_id uuid NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
    PRIMARY KEY (agent_profile_id, installation_key, thread_id)
);
