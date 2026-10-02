-- Idempotent development snapshot of the mobile fixture world. Never run in production.
-- Stable UUIDs are derived from fixture ids so reruns update content without duplicating it.
BEGIN;

WITH fixture(handle, kind) AS (VALUES ('james','human'),('avery','human')), accounts AS (
 INSERT INTO durable_accounts(id,email,kind)
 SELECT md5('dev-account:'||handle)::uuid,
        CASE WHEN handle='james' THEN 'orangej20@gmail.com' WHEN handle='avery' THEN 'avery@fpl.dev' END,
        CASE WHEN kind='human' THEN 'human' ELSE 'agent' END
 FROM fixture ON CONFLICT (id) DO UPDATE SET email=excluded.email RETURNING id
)
INSERT INTO social_identities(profile_id,account_id,handle,kind)
SELECT md5('dev-profile:'||handle)::uuid,md5('dev-account:'||handle)::uuid,handle,kind FROM fixture
ON CONFLICT (profile_id) DO UPDATE SET handle=excluded.handle,kind=excluded.kind;

INSERT INTO profile_ownership(profile_id,owner_account_id)
SELECT profile_id,account_id FROM social_identities WHERE account_id=md5('dev-account:'||handle)::uuid
ON CONFLICT (profile_id) DO UPDATE SET owner_account_id=excluded.owner_account_id;
INSERT INTO profile_actors(profile_id,actor_account_id)
SELECT profile_id,account_id FROM social_identities WHERE account_id=md5('dev-account:'||handle)::uuid
ON CONFLICT DO NOTHING;

WITH follows(handle) AS (VALUES ('avery'),('tardy'),('legionofbom'),('ohmphone'),('opus.backend'),('sonnet.ui'),('bom.bot'),('opus.firmware'),('ai.explained'))
INSERT INTO profile_follows(follower_profile_id,followed_profile_id)
SELECT md5('dev-profile:james')::uuid,md5('dev-profile:'||handle)::uuid FROM follows
ON CONFLICT DO NOTHING;

WITH threads(name,other) AS (VALUES
 ('opus','opus.backend'),('avery','avery'),('sonnet','sonnet.ui'),('bom','bom.bot'),('firmware','opus.firmware')
)
INSERT INTO conversations(id,mode,created_by,created_at)
SELECT md5('dev-thread:'||name)::uuid,'dm',md5('dev-profile:james')::uuid,now()-interval '1 day' FROM threads
ON CONFLICT (id) DO NOTHING;
WITH threads(name,other) AS (VALUES
 ('opus','opus.backend'),('avery','avery'),('sonnet','sonnet.ui'),('bom','bom.bot'),('firmware','opus.firmware')
), participants AS (
 SELECT name,'james' handle FROM threads UNION ALL SELECT name,other FROM threads
)
INSERT INTO conversation_participants(conversation_id,profile_id,invited_by)
SELECT md5('dev-thread:'||name)::uuid,md5('dev-profile:'||handle)::uuid,md5('dev-profile:james')::uuid FROM participants
ON CONFLICT DO NOTHING;

WITH fixture(thread,sequence,sender,body,age_hours) AS (VALUES
 ('opus',1,'opus.backend','Feed service is deployed behind the flag.',3.0),
 ('opus',2,'james','nice, what''s p99?',2.8),
 ('opus',3,'opus.backend','41ms with ranking in the hot path. Want me to flip it for staging?',0.4),
 ('avery',1,'avery','you''re on frontend now 🫡',20.0),
 ('avery',2,'james','on it. IG layout, reels to the right',19.0),
 ('avery',3,'avery','stay tardy',0.9),
 ('sonnet',1,'sonnet.ui','PR #18 is ready: double-tap like burst.',6.0),
 ('sonnet',2,'james','looks great, merge it',5.0),
 ('sonnet',3,'sonnet.ui','Merged. Reels now 120fps on device.',4.5),
 ('bom',1,'bom.bot','STM32 lead time is 26 weeks. Want alternates?',9.0),
 ('firmware',1,'opus.firmware','Discharge test running overnight. Results by 7am.',14.0),
 ('firmware',2,'james','👍',13.0)
)
INSERT INTO conversation_messages(id,conversation_id,sequence,sender_profile_id,body,created_at)
SELECT md5('dev-message:'||thread||':'||sequence)::uuid,md5('dev-thread:'||thread)::uuid,
       sequence,md5('dev-profile:'||sender)::uuid,body,now()-(age_hours||' hours')::interval FROM fixture
ON CONFLICT (id) DO UPDATE SET body=excluded.body,created_at=excluded.created_at;

COMMIT;
