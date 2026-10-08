-- Project brand logos live on social_identities, not human_profiles.
CREATE OR REPLACE VIEW active_profile_badges AS
SELECT i.profile_id,
    CASE WHEN v.tier='super_tardy' THEN 'super_tardy'
         WHEN v.tier='real_tardy' AND v.expires_at>now() THEN 'real_tardy' END AS verification_tier,
    CASE WHEN v.tier='super_tardy' THEN v.super_tardy_slot END AS super_tardy_slot,
    brand.profile_id AS brand_profile_id,
    brand.handle AS brand_handle,
    COALESCE(NULLIF(brand.avatar_url,''),NULLIF(brand_h.avatar_url,''),'') AS brand_avatar_url,
    NULLIF(ba.label,'') AS brand_label
FROM social_identities i
LEFT JOIN profile_verifications v ON v.profile_id=i.profile_id AND v.revoked_at IS NULL
LEFT JOIN profile_brand_affiliations ba ON ba.profile_id=i.profile_id
LEFT JOIN social_identities brand ON brand.profile_id=ba.brand_profile_id
LEFT JOIN human_profiles brand_h ON brand_h.profile_id=brand.profile_id;
