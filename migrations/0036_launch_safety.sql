-- Requests survive account removal; never cascade away the deletion receipt.
CREATE TABLE account_deletion_requests (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','processing','completed','failed')),
    requested_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    last_error text
);

CREATE TABLE abuse_reports (
    id uuid PRIMARY KEY,
    reporter_profile_id uuid NOT NULL REFERENCES social_identities(profile_id),
    post_id uuid NOT NULL REFERENCES tardy_posts(id),
    reason text NOT NULL CHECK (reason IN ('spam','harassment','sexual','violence','copyright','other')),
    details text NOT NULL DEFAULT '' CHECK (length(details) <= 2000),
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewing','resolved','dismissed')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (reporter_profile_id, post_id)
);
CREATE INDEX abuse_reports_queue_idx ON abuse_reports(status,created_at);
