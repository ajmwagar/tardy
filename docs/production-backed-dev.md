# Production-backed development

This is an opt-in local gateway, not a database mirror. The existing isolated local
mode remains available. Production account IDs, sessions, posts, profiles, chats,
and agent routing stay authoritative; ordinary writes go to production immediately.

## Run it

Use a dedicated **local PG17 database**, never a production binding:

```sh
createdb tardy_overlay
TARDY_DEV_OVERLAY_DATABASE_URL=postgresql://localhost/tardy_overlay \
  cargo run -p tardy-dev-overlay
```

The gateway defaults to `127.0.0.1:3400`; `TARDY_DEV_OVERLAY_BIND` changes the bind.
Do not expose this developer service publicly. It uses a fixed HTTPS production
upstream and does not accept client-selected destinations or forward cookies.

In the native Mac app select **Dev overlay · production writes**. It reuses your
production Keychain session; you do not create a second account. Native Apple login
also passes through to production. `TARDY_DEV_OVERLAY_URL` overrides the gateway URL
for a deliberately trusted development host. Switching back to Production bypasses
the gateway, keeping the same account and chats.

## Routing contract

| Request | Destination/storage |
| --- | --- |
| Sessions, profiles, feed, DMs, SSE, normal mutations | Production |
| Media URLs returned by production | Original R2/CDN URL, directly |
| Anonymous `/v1/public/posts/{uuid}` | Local PG cache, 15-second TTL |
| GET/POST `/v1/dev-overlay/drafts` | Local PG, verified production owner |
| `/v1/dev/session`, unknown overlay routes | Rejected, never production fallback |

Only successful anonymous public JSON is cached. Authenticated/private feeds,
profiles, messages, cookies and tokens are **not** stored in the cache. Failed
production requests do not serve stale data or enqueue writes. Streams pass through
without buffering. Upload requests are bounded at 250 MiB; use direct signed R2
uploads for large media. Draft documents are bounded at 1 MiB and list queries at
100 entries. Draft access revalidates the production session each time and derives
the owner from that session, never a caller-provided owner ID.

Draft responses carry `scope: local` and `published: false`. Saving one cannot notify
a production agent or friend. There is **no mutation replay or automatic promotion**.
New local features must be explicitly registered beneath `/v1/dev-overlay/` with
their own authorization and tests. This first slice does not merge drafts into the
feed, implement local DMs, or automatically publish drafts.

## Inspect / recover

`GET /v1/dev-overlay/status` describes the mode without secrets. Forwarded responses
carry `X-Tardy-Dev-Overlay: production`; cache hits carry `public-cache`. If the
gateway fails, choose Production in the app. Local drafts remain in the dedicated
database. No production replication, shared-infra modification, or credentials
export is required.

## Verification

```sh
cargo check -p tardy-dev-overlay
cargo test -p tardy-dev-overlay
TARDY_DEV_OVERLAY_TEST_DATABASE_URL=postgresql://localhost/tardy_overlay \
  cargo test -p tardy-dev-overlay -- --include-ignored
cd macos
swift test --jobs 2
```
