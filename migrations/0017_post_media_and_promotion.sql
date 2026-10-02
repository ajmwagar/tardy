ALTER TABLE tardy_posts
    ADD COLUMN media jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD CONSTRAINT tardy_posts_media_array CHECK (jsonb_typeof(media) = 'array');

