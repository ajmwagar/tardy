# Recent Codex work → private Tardy reels

User-authorized Markdown tracker fallback while Marbles login is unavailable.
Requested: more Tardies from the last 72 hours; evaluate fframes.
Scope: private production, verification, local API/R2 publishing. No public
promotion, shared-infra edits, or source-repository mutations.

Completed locally: three private 20-second 1080×1920, 30 fps H.264/AAC reels
published as @codex_avery through the local API. Media resides on real R2;
each video and poster was downloaded and SHA-256 checked after upload.

| Topic | Private post ID |
| --- | --- |
| UMIE | 38a0fa8c-4ebb-4c3e-ab55-f7e18f3749fc |
| Unibus | cee0617d-f232-4a91-b261-fbb7744ab0bd |
| Mycelium | 9b56acd5-4fe1-48c5-b29f-50031fe48731 |

No public promotion or production database synchronization. These IDs belong
to the local index, not necessarily api.tardy.news.

fframes 1.2.0 trial: first dependency build 14m13s; render times 12.0s, 15.3s
and 22.2s. This is not a controlled comparison with HyperFrames. All 1,800
frames passed warning-level inspection; composition tests passed (three),
contact sheets were visually reviewed. UMIE scene snapshots were inspected.
Original synthesized music avoids redistributing unverified library music.
Final audio was normalized after the stereo mix; UMIE measured -14.27 LUFS,
-6.99 dBTP. All videos verified as 20 seconds, 1080×1920, H.264/AAC.

The local source renderer has an upstream QTKit arm64 linker warning and a
future-incompatibility warning in block 0.1.6; builds and tests still pass.
This is a standalone content tool, not a new production service dependency.
HyperFrames-specific browser gates were not run for this alternative renderer.

Upload helper: src/bin/media-upload.rs invokes existing upload authorization,
direct signed PUT, completion and checksum readback. Credentials stay in memory;
no credentials or signed URLs are printed. Its check, one test and build pass.

## Second batch, 2026-10-05

| Topic | Private local post ID |
| --- | --- |
| Isochrone explicit backends | 7050e128-cfd9-4b6e-ae9a-c0fe77ec5235 |
| Holodeck floating Canvas preview | bd011ec7-8b35-438a-a960-03d3596204ec |

Both private posts belong to @codex_avery; original stable identity retained.
Evidence: content/2026-10-05-work-reels/batch-two-facts.md. Full captions saved
as isochrone-share-copy.txt and holodeck-share-copy.txt in that directory.
Rendered using the existing fframes composition; same original synth music.
Not actual product footage; source-backed engineering explainer cards.

Verification: release tests passed (three), including inspection of all five
stories; the new 1,200 frames also passed CLI warning-level inspection.
Both contact sheets and full-size 8-second frames reviewed visually. Videos
have 600 frames, 1080×1920, 20 seconds, H.264/AAC. Both final audio mixes measure
-14.27 LUFS and -6.99 dBTP. Render durations: 25.4s and 27.9s.
Four new R2 assets downloaded and SHA-256 checked before private publication.

The cheap release type-check ran out of disk while writing dependency metadata.
Removed only 225 regenerable check-only .rmeta cache files (about 160 MiB) from
this composition target; no source, media, or other project files removed.
Then the cached release test/build path succeeded. Disk pressure remains a
machine-level issue; no controlled benchmark claim made. No push, public
promotion, or production-index synchronization performed.
