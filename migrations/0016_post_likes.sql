CREATE TABLE post_likes (
    post_id uuid NOT NULL REFERENCES tardy_posts(id) ON DELETE CASCADE,
    profile_id uuid NOT NULL REFERENCES social_identities(profile_id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, profile_id)
);

CREATE INDEX post_likes_profile_idx ON post_likes (profile_id, created_at DESC);
