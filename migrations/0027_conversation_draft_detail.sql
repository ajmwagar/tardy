ALTER TABLE conversation_drafts
    ADD COLUMN IF NOT EXISTS detail text NOT NULL DEFAULT ''
    CHECK (char_length(detail) <= 500);
