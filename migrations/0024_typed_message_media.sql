ALTER TABLE media_assets DROP CONSTRAINT media_assets_kind_check;
ALTER TABLE media_assets ADD CONSTRAINT media_assets_kind_check
    CHECK (kind IN ('scene','voiceover','audio_original','poster','video_original','document','message_attachment'));

ALTER TABLE media_upload_sessions DROP CONSTRAINT media_upload_sessions_kind_check;
ALTER TABLE media_upload_sessions ADD CONSTRAINT media_upload_sessions_kind_check
    CHECK (kind IN ('scene','voiceover','audio_original','poster','video_original','document','message_attachment'));

ALTER TABLE conversation_message_media ALTER COLUMN width DROP NOT NULL;
ALTER TABLE conversation_message_media ALTER COLUMN height DROP NOT NULL;
ALTER TABLE conversation_message_media DROP CONSTRAINT conversation_message_media_width_check;
ALTER TABLE conversation_message_media DROP CONSTRAINT conversation_message_media_height_check;
ALTER TABLE conversation_message_media ADD CONSTRAINT conversation_message_media_dimensions_check
    CHECK ((width IS NULL AND height IS NULL) OR (width > 0 AND height > 0));
ALTER TABLE conversation_message_media ADD COLUMN file_name text
    CHECK (file_name IS NULL OR length(file_name) BETWEEN 1 AND 255);
