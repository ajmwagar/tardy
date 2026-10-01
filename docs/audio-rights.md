# Audio catalog, recognition, and royalties

Tardy launches with creator-owned originals. A creator or claimed Tardy may upload a single, EP, or album, but upload completion is not a public-streaming grant.

## Day-one state machine

1. Authorize an `audio_original` upload and complete it in R2.
2. Create a release (`single`, `ep`, or `album`) and its ordered tracks.
3. Require the uploader to attest control of both the sound recording and underlying composition.
4. Queue `audio.recognition_requested.v1` using the immutable content hash.
5. Keep the track `pending` while fingerprinting runs. Private review is allowed; post attachment, public playback, and trending are not.
6. A no-match result plus a complete creator attestation may clear the track. A match records provider identifiers, ISRC when supplied, confidence, and attribution, but does not grant permission.
7. A dispute, expired grant, or policy decision moves the track to `blocked` or `expired`, preventing new attachment while preserving usage and royalty ledgers.

Recognition adapters are replaceable workers. The HTTP request path never invokes an LLM or fingerprint provider and never treats generated attribution as authoritative.

## Rights model

The schema keeps recording and composition control separate. That distinction is required because a song and its recording can be separately owned and licensed. A usable post clip needs an active grant that permits synchronization and on-demand streaming in the relevant territory. Commercial use is recorded separately.

Provider recognition is evidence for review and attribution, not proof of ownership and not a license. Store the raw provider reference for audit, while rendering normalized attribution from structured credits.

## Usage and royalties

Every post attachment, qualified play, completed play, and export is an immutable, idempotent usage event. Each payable event creates recording and composition ledger rows with `pending-rates-v1`; amounts remain zero until Tardy has an applicable agreement and deterministic rate calculation. Corrections must be compensating entries, never edits.

The ledger already captures track, post, payee, right type, territory, duration, event time, and calculation version. Before supporting commercial catalog streaming, add agreement identifiers, revenue pools, subscription/ad-supported offering types, monthly certified reports, and settlement batches.

## Trending audio

Trending includes only `cleared` tracks and uses a reproducible 24-hour score:

- post uses × 100
- qualified plays × 10
- completed plays × 20

The first implementation is intentionally simple. Add unique-listener weighting, decay buckets, fraud suppression, minimum cohort sizes, and regional charts before using it for payouts. Rights eligibility remains a hard filter, never a ranking feature.

## Licensing boundary

Do not infer that a license covering one right covers another. U.S. Copyright Office guidance distinguishes the musical work from the sound recording, and its Music Modernization Act materials describe separate licensing/reporting systems for interactive streaming. Reporting rules can require recording and musical-work identifiers, featured artists, owners, and actual playing time. Obtain specialist counsel and direct/provider agreements before enabling third-party commercial catalog music.

Primary references:

- https://www.copyright.gov/engage/musicians/
- https://copyright.gov/music-modernization/faq.html
- https://www.copyright.gov/title37/210/37cfr210-27.html
- https://www.copyright.gov/licensing/sec_112.html
