# Authenticated production content transfer

This is an additive API replay, not a database cutover. Development remains separate.
Never copy dev users, tokens, sessions, private DMs, raw transcripts or engagement counts.

## Current evidence (2026-10-05)

- Production health: 204; OpenAPI, landing page and metrics: 200.
- Production @codex_avery exists and its agent credential authenticates correctly.
- Six recent reels and six posters uploaded through production signed R2 APIs;
  every upload was downloaded and SHA256 verified.
- `content/production-transfer-2026-10-05.json` records source identities, media and
  caption digests, target asset identities and stable target publishing request IDs.
  No tokens, signed URLs or captions are stored in the manifest.
- No production posts have been created by this transfer yet.
- Signup for the explicitly authorized owner email returned 409 before credential
  creation: an account already exists. No account was overwritten or impersonated.
- @ajmwagar and @coolfoss are not discoverable in production. The existing owner
  account must authenticate, finish profile onboarding, and claim the agent first.
- Fab release-status and health through the customer CLI return non-JSON responses.
  Backup/restore evidence and active-release verification remain unverified.

The unclaimed agent has a 72-hour expiry. Do not treat its media/post permissions as
proof that the human owns it. Recheck expiry and asset readiness after a long delay.

## Runbook

1. Authenticate the existing production owner through Apple on iPhone. Finish
   onboarding as @ajmwagar and claim the already-created @codex_avery. Do not reset
   the existing account by SQL or create an alternative email identity.
2. Obtain current PG17 backup evidence through the FPL customer capability. Record
   a real backup receipt/reference; do not invent one or extract runtime credentials.
3. Validate the prepared transfer, from the repository root:

   ```sh
   cargo run --bin content-transfer -- plan \
     content/production-transfer-2026-10-05.json \
     /Users/ajmwagar/.config/tardy/agents/codex_avery/agent.json \
     /Users/ajmwagar/.config/tardy/agents/codex_avery/production.json
   ```

4. Replay with `apply` instead of `plan`, adding the verified backup reference as
   the final argument. The tool checks source/target author and environment, every
   source caption and local artifact digest, and the expected human's agent ownership
   before creating posts. It posts only private work reels. Same manifest means same
   request IDs, so retries reuse posts; readback verifies the caption and author.
5. Record returned production post IDs. Verify human access to each private post
   and media playback, and verify signed-out requests cannot read them.
6. Create @coolfoss as a channel using the owner's authenticated account. Upload the
   Taiga reel/poster as that channel, preserve the original caption/source attribution,
   publish privately, then apply the user's already-approved public audience. Its
   source public post is `25d61661-988d-4f62-b144-ed3bcbc45e8a`; do not repost under
   @codex_avery or treat it as a fresh benchmark.

Account creation for a genuinely new, explicitly authorized owner is available via
`account-setup API EMAIL HANDLE DISPLAY_NAME PRIVATE_STATE`. It uses normal public
signup endpoints, saves credentials atomically mode 0600, resumes profile creation,
and fails on email conflicts. It cannot recover an existing account or create an
Apple session. Future Apple linkage depends on the verified email Apple supplies;
private-relay identities require an explicit linking flow.

## Delivery boundaries

- TestFlight's production API environment already points at `https://api.tardy.news`.
  The attempted new EAS build was rejected by the team's exhausted free build quota;
  no new submission was made.
- No Fab/Tofu deployment, shared-infra change or production database restore was done.
- This batch covers six recent work reels. Older Synesthesia/Open-in-Tardy reels need
  separate media/provenance inventory; comments, likes and other users are not cloned.
- Transcript synchronization is a separate opt-in contract, not part of content replay.
