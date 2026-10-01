CREATE TABLE social_identities (
    profile_id uuid PRIMARY KEY,
    account_id uuid NOT NULL,
    handle text NOT NULL UNIQUE CHECK (handle = lower(handle)),
    kind text NOT NULL CHECK (kind IN ('human','agent','project','channel')),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX social_identities_account_idx ON social_identities (account_id, profile_id);

CREATE TABLE profile_follows (
    follower_profile_id uuid NOT NULL REFERENCES social_identities(profile_id) ON DELETE CASCADE,
    followed_profile_id uuid NOT NULL REFERENCES social_identities(profile_id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (follower_profile_id, followed_profile_id),
    CHECK (follower_profile_id <> followed_profile_id)
);

CREATE TABLE conversations (
    id uuid PRIMARY KEY,
    mode text NOT NULL CHECK (mode IN ('dm','work')),
    created_by uuid NOT NULL REFERENCES social_identities(profile_id),
    promoted_by uuid REFERENCES social_identities(profile_id),
    promoted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((mode='dm' AND promoted_by IS NULL AND promoted_at IS NULL) OR mode='work')
);

CREATE TABLE conversation_participants (
    conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    profile_id uuid NOT NULL REFERENCES social_identities(profile_id),
    invited_by uuid NOT NULL REFERENCES social_identities(profile_id),
    joined_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, profile_id)
);

CREATE TABLE conversation_agent_grants (
    conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    agent_profile_id uuid NOT NULL REFERENCES social_identities(profile_id),
    granted_by uuid NOT NULL REFERENCES social_identities(profile_id),
    context_from_sequence bigint NOT NULL CHECK (context_from_sequence >= 1),
    include_anchor_share boolean NOT NULL DEFAULT true,
    can_reply boolean NOT NULL DEFAULT true,
    can_create_tasks boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, agent_profile_id)
);

CREATE TABLE shared_links (
    id uuid PRIMARY KEY,
    canonical_url text NOT NULL UNIQUE,
    provider text NOT NULL,
    status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','ready','failed')),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    content_hash text,
    transcript_r2_key text,
    media_r2_key text,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE conversation_messages (
    id uuid PRIMARY KEY,
    conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sequence bigint NOT NULL CHECK (sequence >= 1),
    sender_profile_id uuid NOT NULL REFERENCES social_identities(profile_id),
    body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 10000),
    shared_link_id uuid REFERENCES shared_links(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (conversation_id, sequence)
);

CREATE INDEX conversation_messages_order_idx ON conversation_messages (conversation_id, sequence);

CREATE TABLE tardy_posts (
    id uuid PRIMARY KEY,
    author_profile_id uuid NOT NULL REFERENCES social_identities(profile_id),
    client_request_id uuid NOT NULL,
    caption text NOT NULL CHECK (length(btrim(caption)) BETWEEN 1 AND 5000),
    shared_link_id uuid REFERENCES shared_links(id),
    visibility text NOT NULL CHECK (visibility IN ('private','followers','public')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (author_profile_id, client_request_id)
);

CREATE TABLE post_comments (
    id uuid PRIMARY KEY,
    post_id uuid NOT NULL REFERENCES tardy_posts(id) ON DELETE CASCADE,
    author_profile_id uuid NOT NULL REFERENCES social_identities(profile_id),
    body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 5000),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE comment_mentions (
    comment_id uuid NOT NULL REFERENCES post_comments(id) ON DELETE CASCADE,
    mentioned_profile_id uuid NOT NULL REFERENCES social_identities(profile_id),
    reply_requested boolean NOT NULL,
    PRIMARY KEY (comment_id, mentioned_profile_id)
);

ALTER TABLE feed_events DROP CONSTRAINT feed_events_kind_check;
ALTER TABLE feed_events ADD CONSTRAINT feed_events_kind_check CHECK (
    kind IN ('post_published','hyper_tardy','direct_message','agent_share',
             'work_message','comment_mention','agent_reply_requested')
);

CREATE INDEX conversation_participants_profile_idx
    ON conversation_participants (profile_id, conversation_id);
