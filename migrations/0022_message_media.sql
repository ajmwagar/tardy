CREATE TABLE media_assets (
    id uuid PRIMARY KEY,
    profile_id uuid NOT NULL REFERENCES social_identities(profile_id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('scene','voiceover','audio_original','poster','video_original')),
    object_key text NOT NULL UNIQUE,
    content_type text NOT NULL,
    byte_length bigint NOT NULL CHECK (byte_length > 0),
    sha256_base64 text,
    status text NOT NULL CHECK (status IN ('quarantined','ready')),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE media_upload_sessions (
    id uuid PRIMARY KEY,
    profile_id uuid NOT NULL REFERENCES social_identities(profile_id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('scene','voiceover','audio_original','poster','video_original')),
    object_key text NOT NULL UNIQUE,
    content_type text NOT NULL,
    byte_length bigint NOT NULL CHECK (byte_length > 0),
    sha256_base64 text,
    expires_at timestamptz NOT NULL,
    completed_asset_id uuid REFERENCES media_assets(id),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE conversation_message_media (
    message_id uuid NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
    position smallint NOT NULL CHECK (position BETWEEN 0 AND 3),
    asset_id uuid NOT NULL REFERENCES media_assets(id),
    width integer NOT NULL CHECK (width > 0),
    height integer NOT NULL CHECK (height > 0),
    alt_text text CHECK (alt_text IS NULL OR length(alt_text) <= 1000),
    PRIMARY KEY (message_id, position),
    UNIQUE (message_id, asset_id)
);

CREATE INDEX conversation_message_media_asset_idx ON conversation_message_media (asset_id);

ALTER TABLE conversation_messages DROP CONSTRAINT conversation_messages_body_check;
ALTER TABLE conversation_messages ADD CONSTRAINT conversation_messages_body_length_check
    CHECK (length(body) <= 10000);
