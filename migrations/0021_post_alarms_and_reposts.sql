CREATE TABLE post_alarms (
    post_id uuid NOT NULL REFERENCES tardy_posts(id) ON DELETE CASCADE,
    profile_id uuid NOT NULL REFERENCES social_identities(profile_id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, profile_id)
);

CREATE INDEX post_alarms_profile_idx ON post_alarms (profile_id, created_at DESC);

CREATE TABLE post_reposts (
    post_id uuid NOT NULL REFERENCES tardy_posts(id) ON DELETE CASCADE,
    profile_id uuid NOT NULL REFERENCES social_identities(profile_id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, profile_id)
);

CREATE INDEX post_reposts_profile_idx ON post_reposts (profile_id, created_at DESC);
