CREATE TABLE audio_releases (
    id uuid PRIMARY KEY,
    owner_profile_id uuid NOT NULL REFERENCES social_identities(profile_id),
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 300),
    release_type text NOT NULL CHECK (release_type IN ('single','ep','album')),
    artwork_r2_key text,
    release_date date,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audio_tracks (
    id uuid PRIMARY KEY,
    release_id uuid NOT NULL REFERENCES audio_releases(id) ON DELETE CASCADE,
    uploader_profile_id uuid NOT NULL REFERENCES social_identities(profile_id),
    track_number integer NOT NULL CHECK (track_number > 0),
    disc_number integer NOT NULL DEFAULT 1 CHECK (disc_number > 0),
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 300),
    artist_name text NOT NULL CHECK (length(btrim(artist_name)) BETWEEN 1 AND 300),
    duration_ms bigint NOT NULL CHECK (duration_ms BETWEEN 1000 AND 7200000),
    audio_r2_key text NOT NULL,
    content_hash text NOT NULL,
    isrc text,
    iswc text,
    credits jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(credits)='array'),
    attribution_text text,
    recognition_status text NOT NULL DEFAULT 'queued' CHECK (recognition_status IN ('queued','processing','no_match','matched','failed')),
    rights_status text NOT NULL DEFAULT 'pending' CHECK (rights_status IN ('pending','cleared','blocked','expired')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (release_id,disc_number,track_number),
    UNIQUE (content_hash)
);

CREATE TABLE audio_recognition_matches (
    id uuid PRIMARY KEY,
    track_id uuid NOT NULL REFERENCES audio_tracks(id) ON DELETE CASCADE,
    provider text NOT NULL,
    provider_recording_id text NOT NULL,
    title text,
    artist_name text,
    album_title text,
    isrc text,
    confidence_millionths integer NOT NULL CHECK (confidence_millionths BETWEEN 0 AND 1000000),
    attribution jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attribution)='object'),
    raw_reference jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(raw_reference)='object'),
    detected_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (track_id,provider,provider_recording_id)
);

CREATE TABLE audio_rights_grants (
    id uuid PRIMARY KEY,
    track_id uuid NOT NULL REFERENCES audio_tracks(id) ON DELETE CASCADE,
    grantor_profile_id uuid NOT NULL REFERENCES social_identities(profile_id),
    basis text NOT NULL CHECK (basis IN ('creator_attestation','direct_license','public_domain')),
    controls_recording boolean NOT NULL,
    controls_composition boolean NOT NULL,
    permits_sync boolean NOT NULL,
    permits_on_demand_streaming boolean NOT NULL,
    permits_commercial_use boolean NOT NULL,
    territory text NOT NULL DEFAULT 'worldwide',
    valid_from timestamptz NOT NULL DEFAULT now(),
    valid_until timestamptz,
    attestation_version text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE TABLE post_audio (
    post_id uuid PRIMARY KEY REFERENCES tardy_posts(id) ON DELETE CASCADE,
    track_id uuid NOT NULL REFERENCES audio_tracks(id),
    attached_by_profile_id uuid NOT NULL REFERENCES social_identities(profile_id),
    start_ms bigint NOT NULL DEFAULT 0 CHECK (start_ms >= 0),
    duration_ms bigint NOT NULL CHECK (duration_ms BETWEEN 1000 AND 180000),
    volume_millipercent integer NOT NULL DEFAULT 100000 CHECK (volume_millipercent BETWEEN 0 AND 100000),
    attached_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audio_usage_events (
    id uuid PRIMARY KEY,
    track_id uuid NOT NULL REFERENCES audio_tracks(id),
    post_id uuid REFERENCES tardy_posts(id),
    actor_profile_id uuid REFERENCES social_identities(profile_id),
    kind text NOT NULL CHECK (kind IN ('post_created','play_started','qualified_play','play_completed','export')),
    idempotency_key uuid NOT NULL,
    occurred_at timestamptz NOT NULL,
    listen_ms bigint NOT NULL DEFAULT 0 CHECK (listen_ms >= 0),
    territory text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (track_id,idempotency_key)
);

CREATE TABLE audio_royalty_ledger (
    id uuid PRIMARY KEY,
    usage_event_id uuid NOT NULL REFERENCES audio_usage_events(id),
    payee_profile_id uuid NOT NULL REFERENCES social_identities(profile_id),
    right_type text NOT NULL CHECK (right_type IN ('recording','composition','performance','mechanical','sync')),
    amount_micros bigint NOT NULL DEFAULT 0,
    currency varchar(3) NOT NULL DEFAULT 'USD' CHECK (currency=upper(currency)),
    calculation_version text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (usage_event_id,payee_profile_id,right_type)
);

CREATE INDEX audio_usage_trending_idx ON audio_usage_events (occurred_at,track_id) WHERE kind IN ('post_created','qualified_play','play_completed');

CREATE OR REPLACE FUNCTION reject_audio_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'audio usage and royalty ledgers are immutable; append a correction';
END;
$$;
CREATE TRIGGER audio_usage_no_update BEFORE UPDATE OR DELETE ON audio_usage_events FOR EACH ROW EXECUTE FUNCTION reject_audio_ledger_mutation();
CREATE TRIGGER audio_royalty_no_update BEFORE UPDATE OR DELETE ON audio_royalty_ledger FOR EACH ROW EXECUTE FUNCTION reject_audio_ledger_mutation();
