ALTER TABLE feed_events ADD COLUMN subject_id uuid;
UPDATE feed_events SET subject_id = reel_id;
ALTER TABLE feed_events ALTER COLUMN subject_id SET NOT NULL;
ALTER TABLE feed_events ALTER COLUMN reel_id DROP NOT NULL;
ALTER TABLE feed_events ADD COLUMN recipient_profile_id uuid;
ALTER TABLE feed_events DROP CONSTRAINT feed_events_kind_check;
ALTER TABLE feed_events ADD CONSTRAINT feed_events_kind_check
    CHECK (kind IN ('post_published','hyper_tardy','direct_message','agent_share'));
ALTER TABLE feed_events DROP CONSTRAINT feed_events_kind_reel_id_key;
ALTER TABLE feed_events ADD CONSTRAINT feed_events_kind_subject_id_key UNIQUE (kind, subject_id);

ALTER TABLE feed_subscriptions ADD COLUMN profile_id uuid;
ALTER TABLE feed_subscriptions DROP CONSTRAINT feed_subscriptions_kind_check;
ALTER TABLE feed_subscriptions ADD CONSTRAINT feed_subscriptions_kind_check
    CHECK (kind IN ('hashtag','hyper_tardy','agent_inbox'));
ALTER TABLE feed_subscriptions DROP CONSTRAINT feed_subscriptions_check;
ALTER TABLE feed_subscriptions ADD CONSTRAINT feed_subscriptions_selector_check CHECK (
    (kind='hashtag' AND hashtag IS NOT NULL AND profile_id IS NULL) OR
    (kind='hyper_tardy' AND hashtag IS NULL AND profile_id IS NULL) OR
    (kind='agent_inbox' AND hashtag IS NULL AND profile_id IS NOT NULL)
);

CREATE INDEX feed_events_agent_inbox_idx
    ON feed_events (recipient_profile_id,id)
    WHERE kind IN ('direct_message','agent_share');
