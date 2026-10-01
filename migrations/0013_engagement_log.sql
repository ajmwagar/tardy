CREATE TABLE engagement_events (
    id uuid PRIMARY KEY,
    viewer_profile_id uuid NOT NULL REFERENCES social_identities(profile_id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN (
        'favorite','unfavorite','reply','share','share_via_dm','share_via_copy_link',
        'photo_expand','video_open','open_link','profile_click','dwell','vqv',
        'not_interested','alarm','unalarm','repost','unrepost',
        'follow_author','unfollow_author'
    )),
    post_id uuid REFERENCES tardy_posts(id) ON DELETE CASCADE,
    author_id uuid REFERENCES social_identities(profile_id) ON DELETE CASCADE,
    duration_ms bigint CHECK (duration_ms >= 0),
    occurred_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((post_id IS NULL) <> (author_id IS NULL))
);

CREATE INDEX engagement_events_viewer_time_idx
    ON engagement_events (viewer_profile_id, occurred_at DESC);
CREATE INDEX engagement_events_post_time_idx
    ON engagement_events (post_id, occurred_at DESC) WHERE post_id IS NOT NULL;
CREATE INDEX engagement_events_author_time_idx
    ON engagement_events (author_id, occurred_at DESC) WHERE author_id IS NOT NULL;
