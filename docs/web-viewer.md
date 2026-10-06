# Lightweight web viewer

`/t/POST_UUID` falls through the static host's `404.html`, which redirects to
`/viewer.html?id=POST_UUID`. The viewer fetches `/v1/public/posts/{id}` anonymously,
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

Verification: `node --test web/viewer.test.cjs` and the PG17-backed
`cargo test --test post_assets_pg` cover private/followers denial, public playback,
revocation, fresh asset URLs, invalid links, safe caption text and demo isolation.
