# Launch delivery evidence — 2026-10-07

Read-only customer inspection; no deployment, push, TestFlight submission,
production database access, test notification or infrastructure apply performed.
Source checkout: `origin/master` `45b859c`, with local share-link fixes on
`feat/launch-delivery-audit`. Follow-up work remains in Marbles
`tardy-launch-operations`, `tardy-public-share-routing`, `tardy-client-release`
and `tardy-prod-release-status`; this is a receipt and runbook, not a task list.

## Observed delivery identities

| Surface | Verified identity | Limit |
| --- | --- | --- |
| Customer selection | FPL profile `prod`, company `fpl`, project `tardy-prod` | Not display company `tardy` |
| API | revision `rev-4e71c8eb5ea84920baf2608344c47a02`, deployment `svc-deploy-eca7c92cfb2d45448c0be61381566547` | Active / Succeeded; build request source `45b859cead41e18a5928929b33e95ee2893f2fac`; runtime config not established |
| API artifact | `rootfs:tardy@sha256:bf699c9b9f96cd4e13c9b40269d72810028c7a87f651c5fae6aa9a3891ef11c8` | Build `af1bbe4173694ce5b247f731a5234d95` succeeded; rollback target reports `-` |
| Website | `deploy-91835fb6f1d849df92b06784cd064c81`, run `7b761dba14d34dbf8a8507c171d8c18b` | Active immutable R2 site artifact; auto-promote registered |
| Website prior deployment | `deploy-729066e36fb347c0a8959bcac4d31702` | Identified, rollback not rehearsed |
| EAS production iOS | build `4be5783e-44df-4e1c-9bc7-cd5d4ba8d07c`, version 1.0.0 / 22, FINISHED / STORE | Created Oct 2, commit `420f44983f3f2a18e6d34fd1b4a7e15f60b9bdcb`; not current master |

EAS is not App Store Connect. The EAS receipt does not prove submission, Apple
processing, TestFlight group availability, installed version or compiled API URL.
A newer directly uploaded native build could exist outside EAS. Obtain ASC evidence
before claiming build 22 is the newest TestFlight build.

Customer `release status` for service names `push-worker`, `webhook-worker` and `ingest-worker`
returns HTTP 400, `rollout target not configured`. These conventional names are
not proof that no externally managed worker exists. Repository ToFu declares
only `api`; the image packages workers but starts only the API. No customer-visible
worker execution/lease receipt, APNs production acceptance, restore receipt,
metrics scrape or API rollback rehearsal was obtained. Treat these as unverified
launch gates, not as working because the API is healthy.

## Repeatable customer reads

```sh
fpl profile exec prod -- fpl fab release status \
  --company fpl --project tardy-prod --service api
fpl profile exec prod -- fpl fab --json sites status tardy
fpl profile exec prod -- fpl fab runs --project tardy-prod --limit 5
fpl profile exec prod -- fpl fab run af1bbe4173694ce5b247f731a5234d95
cd mobile
npx eas-cli@latest build:list -p ios --distribution store --limit 3 --json --non-interactive
```

Use the hosted customer profile and supported reads. Do not substitute operator
SSH, private service endpoints or printing process environment variables. Runtime
binding identifiers are not permission to inspect private DMs or copy credentials.

## Share routing finding

Known public post `29f8f3c7-7f97-4a77-bb35-673f873f4e46`:

- anonymous `/v1/public/posts/{id}` responds 200;
- `https://tardy.news/viewer.html?id={id}` responds 200;
- `https://tardy.news/t/{id}` responds 404.

Inspected owning Fab checkout at `46d8fc98b9fb06bb5092a9bb971cd2b2ec0238ef`
(`crates/fab-sites/src/main.rs`, unchanged in that dirty checkout): signed and HTTP-prefix
R2 object serving forwards missing keys as 404 without reading root `404.html`.
Local-artifact fallback checks only the requested file's parent, also insufficient
for the root fallback on `/t/{id}`. Installed customer CLI offers site reads only;
the provider resource has no rewrite field. No supported `_redirects` contract was
found. The repository fix therefore generates the deployed viewer asset URL for
new mobile, host and web shares. Existing CLI output already uses this URL.
Legacy short links still need a platform-managed rewrite/fallback capability;
do not hand-edit Palisade or proliferate per-post site artifacts.

Verification of the repository fix: eight web viewer tests and 70 mobile
share/HTTP tests passed, mobile typecheck and lint passed, and Rust API/host
`cargo check --locked` passed. A focused PostgreSQL17 test passed in the isolated
`tardy_delivery_20261007` database, proving viewer and legacy private shares allow
existing chat recipients while denying strangers and anonymous reads. No tests
ran against production, and these local fixes are not deployed evidence.

## Authorized launch runbook boundary

Before promotion, the customer release interface must expose a known prior API
revision and worker target identities. Platform owners provide those capabilities;
Tardy should not implement a second scheduler or raw VM deployment path. Deploy
the API share-access change before the newer host/client; then publish the static
artifact through Fab. Preserve old-client parsing and verify private chat shares
remain unavailable to anonymous users and nonparticipants.

Run destructive restore exercises only in a separately provisioned scratch PG17
database through scoped bindings. Record backup timestamp, restore duration,
schema version and fixture checks without publishing data. A backup instruction
is not a tested restore. Check R2 asset authorization and bounded URL expiry with
owned disposable fixtures, not private user content.

Production APNs acceptance requires an authorized disposable device/account:
record worker revision, notification/outbox id, APNs response, on-device receipt
and deep-link destination. Do not include device tokens in receipts. Prove restart,
retry/dead-letter and preference suppression separately; an Alerts row is not push.

Release the exact approved client commit with a receipt containing bundle ID,
build number, IPA hash, signature/entitlements, production API configuration,
upload id and ASC processing/testing-group status. Repository production profile
selects the EAS production environment but does not prove its values. Follow
`docs/apple-build-runners.md`; no verified Fab Mac-runner path exists in this
repository. Runner enrollment and immutable job/credential interfaces belong to
Fab; do not add unsupported `macos` recipes or privileged SSH glue.

End acceptance with a two-person real-device session and an authorized immutable
rollback rehearsal. Promoting or rolling back is separate authority from this
audit and was not performed.
