CREATE TABLE super_tardy_checkout_reservations (
    id uuid PRIMARY KEY,
    profile_id uuid NOT NULL UNIQUE REFERENCES social_identities(profile_id) ON DELETE CASCADE,
    stripe_session_id text UNIQUE,
    expires_at timestamptz NOT NULL,
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX super_tardy_checkout_reservations_active_idx
    ON super_tardy_checkout_reservations(expires_at)
    WHERE completed_at IS NULL;
