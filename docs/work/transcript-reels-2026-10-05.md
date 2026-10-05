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
