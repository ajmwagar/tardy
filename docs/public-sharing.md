# Public Tardy links

`GET /t/{post_id}` on the API serves crawler-readable HTML: full caption,
canonical URL, Open Graph and Twitter card metadata. Caption HTTP(S) links
are escaped anchors marked `rel="ugc"`; arbitrary HTML and executable
schemes are never accepted. Paid placements must separately qualify their
links as sponsored; this does not sell ranking credit with verification.

Both the HTML and `/t/{post_id}/poster` recheck anonymous post access.
Private or removed posts return 404 without their caption or media. The
poster route resolves current media URLs rather than embedding expiring
storage credentials in metadata. Responses are no-store, although external
preview services may retain previously public content in their own caches.

The post payload advertises `share_path`. Clients only use the rich URL when
this field matches the post ID; older servers retain the working viewer URL.
Mobile recognizes both website and API post links as native post cards.
macOS loads chat cards through the authenticated post API and opens them in
the reel viewer, with retry on failure. Native sharing uses the system sheet.

Release order: deploy API routes first, verify a public post's HTML and poster
and a private post's 404, then publish website and app changes. The website's
static `/t/` redirect is not a substitute for server-rendered crawler HTML.
The current canonical rich share URL uses `api.tardy.news`; routing the same
HTML through `tardy.news` remains a managed deployment task. Do not change
canonical URLs until routing is verified.

Verification: run `node --test web/viewer.test.cjs`, `swift test` in macos,
and the Rust `share_preview` integration test against an isolated PG17
database using `TEST_DATABASE_URL`. Test link recognition on mobile as well.
