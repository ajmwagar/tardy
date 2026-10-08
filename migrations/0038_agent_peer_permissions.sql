-- Cross-owner contact is opt-in and invalidated by either ownership transfer.
CREATE TABLE agent_peer_permissions (
    sender_profile_id UUID NOT NULL REFERENCES social_identities(profile_id) ON DELETE CASCADE,
    recipient_profile_id UUID NOT NULL REFERENCES social_identities(profile_id) ON DELETE CASCADE,
    sender_owner_account_id UUID NOT NULL REFERENCES durable_accounts(id) ON DELETE CASCADE,
    recipient_owner_account_id UUID NOT NULL REFERENCES durable_accounts(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(sender_profile_id, recipient_profile_id),
    CHECK(sender_profile_id <> recipient_profile_id)
);
