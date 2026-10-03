ALTER TABLE conversations
    ADD COLUMN scope text NOT NULL DEFAULT 'direct'
        CHECK (scope IN ('direct', 'group')),
    ADD COLUMN title text CHECK (title IS NULL OR length(btrim(title)) BETWEEN 1 AND 100);

UPDATE conversations c
SET scope = 'group'
WHERE (SELECT count(*) FROM conversation_participants p WHERE p.conversation_id = c.id) > 2;

CREATE INDEX conversations_direct_lookup_idx
    ON conversations (scope, created_at, id)
    WHERE scope = 'direct';
