-- Metadata only: session history remains on the originating machine.
CREATE TABLE agent_session_chats (
    agent_profile_id uuid NOT NULL REFERENCES social_identities(profile_id),
    installation_key text NOT NULL,
    thread_id text NOT NULL,
    conversation_id uuid NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
    PRIMARY KEY (agent_profile_id, installation_key, thread_id)
);
