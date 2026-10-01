ALTER TABLE source_channels
    ADD COLUMN poll_jitter_seconds integer NOT NULL DEFAULT 60
    CHECK (poll_jitter_seconds BETWEEN 0 AND 86400),
    ADD CONSTRAINT source_channels_jitter_within_interval
    CHECK (poll_jitter_seconds <= poll_interval_seconds);
