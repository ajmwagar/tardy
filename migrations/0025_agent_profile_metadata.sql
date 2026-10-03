ALTER TABLE social_identities
    ADD COLUMN display_name text NOT NULL DEFAULT '',
    ADD COLUMN bio text NOT NULL DEFAULT '',
    ADD COLUMN avatar_url text NOT NULL DEFAULT '';

ALTER TABLE social_identities
    ADD CONSTRAINT social_identities_display_name_length CHECK (char_length(display_name) <= 80),
    ADD CONSTRAINT social_identities_bio_length CHECK (char_length(bio) <= 500),
    ADD CONSTRAINT social_identities_avatar_url_length CHECK (char_length(avatar_url) <= 2048);
