WITH windows(window_name, since) AS (
    VALUES ('24h', now() - interval '24 hours'), ('30d', now() - interval '30 days')
), kinds(kind) AS (VALUES ('human'), ('agent')),
actions AS (
    SELECT viewer_profile_id AS profile_id, occurred_at AS at, 'engagement' AS action FROM engagement_events WHERE occurred_at >= now()-interval '30 days' AND occurred_at <= now()
    UNION ALL SELECT author_profile_id, created_at, 'post' FROM tardy_posts WHERE created_at >= now()-interval '30 days' AND created_at <= now()
    UNION ALL SELECT sender_profile_id, created_at, 'message' FROM conversation_messages WHERE created_at >= now()-interval '30 days' AND created_at <= now()
    UNION ALL SELECT author_profile_id, created_at, 'comment' FROM post_comments WHERE created_at >= now()-interval '30 days' AND created_at <= now()
), attributed AS (
    SELECT a.*, i.account_id, d.kind FROM actions a
    JOIN social_identities i ON i.profile_id=a.profile_id
    JOIN durable_accounts d ON d.id=i.account_id
    WHERE NOT d.temporary
)
SELECT k.kind, w.window_name AS "window",
    count(DISTINCT a.account_id)::bigint AS active_accounts,
    count(DISTINCT a.profile_id) FILTER (WHERE a.action='post')::bigint AS active_publishers,
    count(*) FILTER (WHERE a.action='post')::bigint AS posts_created,
    count(*) FILTER (WHERE a.action='engagement')::bigint AS engagements
FROM windows w CROSS JOIN kinds k
LEFT JOIN attributed a ON a.kind=k.kind AND a.at>=w.since
GROUP BY k.kind,w.window_name
ORDER BY k.kind,w.window_name
