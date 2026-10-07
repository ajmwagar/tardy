# Lightweight web viewer

Use `/viewer.html?id=POST_UUID` for public share links. This is a real immutable
site asset and does not depend on an undocumented static-host rewrite.
The viewer fetches `/v1/public/posts/{id}` anonymously,
plays video with native controls, shows swipeable image carousels, full captions,
source links and author names, and offers system sharing/copy and Open in Tardy.
No login, local token storage, autoplay audio, or HTML caption injection. Below the
shared post, visitors can scroll up to 20 public items from the existing anonymous
feed. Only one video plays at a time; Join Tardy opens the iOS beta onboarding page,
not a fabricated web signup. The demo does not request a live feed.

The anonymous endpoint reuses the existing PG17 post visibility query and media
asset resolver. Private/followers-only and removed posts return 404. Responses are
`no-store`; media links remain short-lived. Changing a post back to private stops
new anonymous reads immediately, but previously issued media URLs survive until
their existing expiry. This does not add anonymous private-post capability links.

Demo: `/viewer.html?demo=1` uses the bundled Clankercast reel, explicitly labeled
as a demo, with no fake live metrics or backend post.

For a local static preview, serve `web/public` on localhost and run the API on
port 3300 with `TARDY_WEB_BASE_URL` set to the exact static preview origin. The
viewer uses loopback API only on localhost/127.0.0.1; production uses
`https://api.tardy.news`. Other LAN hostnames need a future explicit configuration.
Fab's existing `web/public` watch path publishes these assets through the normal
site pipeline; the new API route needs its own deployment. No deployment was
performed as part of this implementation.

## Legacy short links and rollout

`/t/POST_UUID` is still accepted by the app link parser. The bundled `404.html`
can redirect it only on hosts that explicitly serve that fallback. Production
Fab Sites' R2 object serving currently returns a plain 404 for a missing key;
root `404.html` does not intercept nested paths. Neither the installed customer
CLI nor the inspected site provider exposes a rewrite contract. Do not add raw
Palisade routes, generate one HTML file per post, or assume `_redirects` works.
Platform-owned managed rewrite support is needed to repair already-shared short
links. Until then, newly generated mobile, host and website links use the viewer
asset URL; the CLI already does so.

Deploy the API private-chat access query before updating the agent host/mobile:
it recognizes exact viewer and legacy URLs only for conversation participants.
This does not make a private post anonymously readable. Roll the website through
the existing Fab static pipeline, then verify a known public viewer URL (200),
its anonymous API response, and the copied share URL. Explicitly record legacy
`/t/` as unavailable until the platform rewrite is deployed and tested.

Verification: `node --test web/viewer.test.cjs` and the PG17-backed
`cargo test --test post_assets_pg` cover private/followers denial, public playback,
revocation, fresh asset URLs, invalid links, safe caption text and demo isolation.
