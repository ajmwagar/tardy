CREATE TABLE profile_verifications (
    profile_id uuid PRIMARY KEY REFERENCES social_identities(profile_id) ON DELETE CASCADE,
    tier text NOT NULL CHECK (tier IN ('real_tardy','super_tardy')),
    super_tardy_slot integer UNIQUE,
    provider text NOT NULL CHECK (provider IN ('stripe','x402','admin')),
    provider_reference text NOT NULL,
    starts_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (
        (tier='real_tardy' AND super_tardy_slot IS NULL AND expires_at IS NOT NULL)
        OR
        (tier='super_tardy' AND super_tardy_slot BETWEEN 1 AND 1000 AND expires_at IS NULL)
    ),
    UNIQUE (provider, provider_reference)
);

CREATE INDEX profile_verifications_active_idx
    ON profile_verifications (profile_id, expires_at)
    WHERE revoked_at IS NULL;

CREATE TABLE profile_brand_affiliations (
    profile_id uuid PRIMARY KEY REFERENCES social_identities(profile_id) ON DELETE CASCADE,
    brand_profile_id uuid NOT NULL REFERENCES social_identities(profile_id) ON DELETE CASCADE,
    granted_by_account_id uuid NOT NULL REFERENCES durable_accounts(id),
    label text NOT NULL DEFAULT '' CHECK (length(label) <= 50),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (profile_id <> brand_profile_id)
);

CREATE INDEX profile_brand_affiliations_brand_idx
    ON profile_brand_affiliations (brand_profile_id, profile_id);

-- Stripe and x402 retries converge here before changing an entitlement. Raw card or wallet
-- credentials never enter this table.
CREATE TABLE verification_payment_events (
    id uuid PRIMARY KEY,
    provider text NOT NULL CHECK (provider IN ('stripe','x402')),
    provider_event_id text NOT NULL,
    profile_id uuid NOT NULL REFERENCES social_identities(profile_id),
    tier text NOT NULL CHECK (tier IN ('real_tardy','super_tardy')),
    amount_cents integer NOT NULL CHECK (amount_cents > 0),
    status text NOT NULL CHECK (status IN ('settled','refunded','disputed')),
    occurred_at timestamptz NOT NULL,
    payload_digest bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_event_id)
);

CREATE VIEW active_profile_badges AS
SELECT
    i.profile_id,
    CASE
        WHEN v.tier='super_tardy' THEN 'super_tardy'
        WHEN v.tier='real_tardy' AND v.expires_at > now() THEN 'real_tardy'
    END AS verification_tier,
    CASE WHEN v.tier='super_tardy' THEN v.super_tardy_slot END AS super_tardy_slot,
    brand.profile_id AS brand_profile_id,
    brand.handle AS brand_handle,
    COALESCE(NULLIF(brand_h.avatar_url,''),'https://tardy.news/favicon.svg') AS brand_avatar_url,
    NULLIF(ba.label,'') AS brand_label
FROM social_identities i
LEFT JOIN profile_verifications v
    ON v.profile_id=i.profile_id AND v.revoked_at IS NULL
LEFT JOIN profile_brand_affiliations ba ON ba.profile_id=i.profile_id
LEFT JOIN social_identities brand ON brand.profile_id=ba.brand_profile_id
LEFT JOIN human_profiles brand_h ON brand_h.profile_id=brand.profile_id;
