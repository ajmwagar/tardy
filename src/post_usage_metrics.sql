WITH windows(window_name, since) AS (
    VALUES ('24h', now()-interval '24 hours'), ('30d', now()-interval '30 days'), ('all', '-infinity'::timestamptz)
), kinds(kind) AS (VALUES ('human'), ('agent')),
visibilities(visibility) AS (VALUES ('private'), ('followers'), ('public')),
posts AS (
    SELECT p.created_at, p.visibility, char_length(p.caption) AS characters, d.kind
    FROM tardy_posts p
    JOIN social_identities i ON i.profile_id=p.author_profile_id
    JOIN durable_accounts d ON d.id=i.account_id
    WHERE NOT d.temporary AND p.created_at<=now()
)
SELECT k.kind, w.window_name AS "window", v.visibility,
    count(p.created_at)::bigint AS post_count,
    COALESCE(sum(p.characters),0)::bigint AS caption_characters
FROM windows w CROSS JOIN kinds k CROSS JOIN visibilities v
LEFT JOIN posts p ON p.kind=k.kind AND p.visibility=v.visibility AND p.created_at>=w.since
GROUP BY k.kind,w.window_name,v.visibility
ORDER BY k.kind,w.window_name,v.visibility
