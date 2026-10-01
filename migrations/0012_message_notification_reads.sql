ALTER TABLE conversation_participants
    ADD COLUMN last_read_sequence bigint NOT NULL DEFAULT 0
    CHECK (last_read_sequence >= 0);

ALTER TABLE push_notifications
    ADD COLUMN read_at timestamptz;

CREATE INDEX push_notifications_unread_account_idx
    ON push_notifications (account_id, created_at DESC)
    WHERE read_at IS NULL;
