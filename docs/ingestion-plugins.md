# Ingestion plugin boundary

Tardy's source catalog lives in `ingest/sources.lua`, but Lua is policy, not an
orchestrator. Rust owns network transports, credentials, leases, deduplication, retries,
PostgreSQL writes, and the outbox. The Lua sandbox has no filesystem, process, network,
or environment access.

Each source declares a transport plus `poll_interval_seconds` and
`poll_jitter_seconds`. PostgreSQL durably stores the schedule. New sources are spread
across their first interval, and successful polls add a deterministic per-source jitter;
workers can restart without synchronizing all sources onto the same second.

Transforms may return bounded capability requests alongside deterministic carousel data:

- `ooda_complete`: constrained completion/summarization through OODA.
- `ooda_stt`: speech-to-text for a media asset already admitted by the Rust host.
- `rlcd_rank`: ranking or critique through RLCD.

Lua only describes the request (`capability`, `instruction`, and `max_output_tokens`). It
does not choose endpoints, models, credentials, or retry behavior. The serialized plan is
written to `transformation_runs` and the outbox; a Rust dispatcher is responsible for
mapping each allowlisted capability to the owning service. This keeps future Whisper and
Hyperframes work behind the same narrow host interface rather than granting plugins broad
network access.

The launch catalog has 50 enabled, attributed profiles: three Hacker News lists, the
Cloudflare RSS feed, and 46 public GitHub release streams. The disabled BBC Pidgin entry
remains as a licensing-policy fixture and is never polled.
