# Production readiness audit — 2026-10-07

Verdict: **not ready for public launch**. Healthy public endpoints and green CI are
necessary, but do not prove authentication, deletion, moderation, worker delivery,
restore capability, or the installed client version. Work is tracked in Marbles,
starting at `tardy-launch-readiness`; this document is evidence, not a task database.

## Audit boundary

Inspected fresh `origin/master` at `45b859c`, repository-owned infrastructure,
client configuration, GitHub PRs/CI, and anonymous production HTTP responses.
Production checks were read-only. No private conversations, runtime secrets, billing
transactions, infrastructure applies, deployment, or TestFlight submission were performed.
The session-control/client changes on `feat/codex-session-connect` are local work,
not evidence of deployed functionality. The article branch is also not current master.

## Verified observations

| Surface | Result | What it proves |
| --- | --- | --- |
| `api.tardy.news/healthz` | 204 | Process responds; current handler does not query PG |
| `api.tardy.news/openapi.json` | 200 | Public contract is accessible |
| `/v1/social/conversations`, no bearer | 401 | This inbox route rejects anonymous access |
| `POST /v1/sessions`, deliberately invalid Apple credential | 503, Apple not configured | Production Apple login is currently disabled; no account created |
| `/v1/public/posts/29f8f3c7-7f97-4a77-bb35-673f873f4e46` | 200 | One known public reel is readable |
| `tardy.news/`, `/privacy.html`, `/llms.txt`, `/SKILL.md` | 200 | Public landing/legal/agent assets respond |
| `tardy.news/account/delete` | 404 | Current mobile deletion destination is broken |
| `tardy.news/support` | 404 | This specific route is absent; does not prove contact info absent everywhere |
| `tardy.news/t/29f8f3c7-7f97-4a77-bb35-673f873f4e46` | 404 | Public short share links remain broken |
| `api.tardy.news/readyz` | 404 | No deployed dependency readiness endpoint |
| GitHub CI run `37572606200`, commit `45b859c` | success | Current master passed configured CI |

Open PRs observed: #44 Claude Code host, #43 profile search, #35 breaking lane,
#27 text posts. These need review against current master, not blanket merging.
Marbles has many old open/review items whose code has since landed; statuses are not
proof of absence. Close only with actual merge evidence.

## Launch-critical findings

**Apple authentication (`tardy-p2as`, P0).** The production credential exchange returns
`Sign in with Apple is not configured`. The repository declares `APPLE_CLIENT_ID`,
but active deployment configuration is not verified. Restore through the customer
Fab/ToFu rollout path and prove a fresh real-device sign-in before any launch promotion.

**GitHub onboarding (`tardy-github-auth`, requested).** Add sign-in/up alongside Apple
through the shared PG identity/session boundary. Use server-owned OAuth, PKCE/state,
expiring one-use callback binding, strict redirects and minimal identity access.
Provider linking requires explicit authenticated confirmation; do not silently merge
accounts using email or handles. Repository/MCP permissions remain a separate consent.

**Account lifecycle (`tardy-launch-account-deletion`).** The settings action is a
website redirect; its target is 404. No human-account deletion endpoint was found in
the inspected router. Implement authenticated in-app initiation, recent-auth policy,
session/agent credential revocation, owned-agent disposition, media and retention
policy, and durable completion. Signing out is not deletion.

**Community safety (`tardy-t42g`).** No public-content report intake or quarantine
path was found in the router; `/v1/ad-campaigns/{id}/report` is analytics, not abuse
reporting. Some blocking exists, but the complete client/server block/unblock and
cross-surface enforcement needs acceptance tests. Require moderation, operator
response ownership, and visible support contact before public UGC launch.

**AI privacy (`tardy-feft`).** Versioned search consent exists; this does not prove
consent coverage for external processing of personal agent/chat/repository material.
Audit each egress boundary and ensure revocation actually stops transfers.

**Payments (`tardy-rnyd`).** Web checkout links are unconditional in `mobile/src/config.ts`;
no storefront gate was found there. Decide release regions and approved purchase
flows before submission. Website billing success, entitlement reconciliation,
cancellation, webhook replay, and return-to-app need real test evidence.

**Release identity (`tardy-prod-release-status`, `tardy-client-release`).** The owning
company is `fpl` per repository defaults, not the display company `tardy` (the latter
returned `project_access_denied`). Customer Fab release status verified active revision
`rev-4e71c8eb5ea84920baf2608344c47a02`, deployment
`svc-deploy-eca7c92cfb2d45448c0be61381566547`, build
`af1bbe4173694ce5b247f731a5234d95`, and artifact
`rootfs:tardy@sha256:bf699c9b9f96cd4e13c9b40269d72810028c7a87f651c5fae6aa9a3891ef11c8`.
Rollout reports Succeeded/active, but no rollback target was reported (`-`).
This does not establish its Git commit or runtime bindings. No fresh Apple/EAS build identity, processing
status, or installed TestFlight API URL was verified. Mobile defaults to mock data
when `EXPO_PUBLIC_TARDY_API_URL` is absent; prove production bundle configuration.

**Workers (`tardy-ihky`, `tardy-launch-operations`).** The Docker image packages push,
ingest and webhook workers, but its entrypoint runs only the API. Repository ToFu
declares only the API service. This is a deployment-evidence gap, not proof that
workers are absent externally. Require customer-visible worker status, APNs production
receipt and deep-link test, outbox lag, retry/dead-letter behavior, and restart recovery.
Shared-link download tooling has additional packaging/rights requirements.

**Operations/security (`tardy-launch-operations`).** Backup instructions exist, but
there is no audited restore receipt here. Rate limits were not found in the API;
edge enforcement is unverified. Require scoped secrets/rotation, abuse budgets,
PG restore rehearsal, R2 private-media authorization tests, metrics scrape/alerts,
and a rehearsed immutable-release rollback. Do not mirror private DMs between envs
by default. No production load/capacity test was performed.

## Review policy cross-check

Checked [Apple’s current guidelines](https://developer.apple.com/app-store/review/guidelines/)
on the audit date. Relevant gates: UGC filtering/reporting/blocking/contact (1.2),
in-app account deletion (5.1.1(v)), explicit permission for personal-data sharing
with third-party AI (5.1.2(i)), storefront-dependent external purchase links
(3.1.1(a)), and authorization for third-party media downloads (5.2.3).
Attribution alone is not a license to rehost someone else’s reel or music.
This is an engineering gate assessment, not legal advice or approval assurance.

## Changes produced by this audit

Added `/readyz`: 204 only after a successful PG probe; absent/unavailable PG returns
503, bounded to two seconds, with no database error details exposed publicly.
It does not certify Apple, R2, Stripe, workers, schema compatibility or capacity.
The process-level `/healthz` remains unchanged. Repository Shroud promotion health
now points at `/readyz`; deploy the API change together with that configuration.
Added `crates/` to Fab API build watch paths, since the Docker build includes crates.

## Suggested launch sequence

Restore Apple sign-in first, then address account lifecycle and safety while obtaining release/worker/backup
evidence through FPL customer capabilities. Then run a two-person production acceptance
session: fresh Apple sign-in, profile/follow counters, reel/audio playback, comments,
share/DM/agent response, receipts, notification read markers, and one device APNs alert.
Use owned disposable fixtures; never destructive PG integration suites against prod.
Finally validate reviewer access, privacy labels, age rating, screenshots and the exact
release build; promote an immutable candidate with a recorded rollback target.
Defer ads, federation, cloud agents and new connectors until these gates pass.
