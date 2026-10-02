-- Tardy posts are text-only and at most 200 characters (social::TEXT_POST_MAX_CHARS).
-- NOT VALID: the limit applies to every new or updated row, while posts written under the
-- old 5,000-character limit stay readable as they are.
ALTER TABLE tardy_posts
    ADD CONSTRAINT tardy_posts_text_limit CHECK (char_length(btrim(caption)) <= 200) NOT VALID;
