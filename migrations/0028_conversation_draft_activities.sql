ALTER TABLE conversation_drafts
    ADD COLUMN IF NOT EXISTS activities jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(activities) = 'array');
