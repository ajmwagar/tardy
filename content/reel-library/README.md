# Shared concepts, project-owned presentation

The reusable Rust boundary is `crates/tardy-reel-library`. It knows nothing
about fframes, HyperFrames, Tardy authentication, uploads or generated facts.

Three shared formats:

| Concept | Narrative | fframes presentation |
| --- | --- | --- |
| milestone | Hook, change, evidence, boundary | Editorial cards |
| pipeline | Problem, ordered stages, evidence, boundary | Connected stage rail |
| walkthrough | Goal, numbered steps, evidence, boundary | Numbered checklist |

Formats belong to the common vocabulary, not to individual projects. Project
JSON files define compatible variants: identity, revision, palette and bounded
entrance timing. Five starter projects have six variants each. These are starting
defaults, not assertions about canonical project branding; edit them as the actual
project design assets mature. Adding a new concept requires a renderer implementation,
not a project-specific synonym for an existing format.

Selection is deterministic, not an LLM decision: validate project config, filter
compatible format, avoid the most recent variant when alternatives exist, prefer
less-used variants/formats within the last six uses for this project, then use
a stable seeded hash as the tie-breaker. Other projects' histories do not affect
selection. One compatible variant necessarily repeats; unknown formats and invalid
themes fail, never fall back silently. Text/accent contrast is checked against
the background (4.5:1), and entrance timing is bounded to 300–600 ms.

Use a new persisted seed for each new content item (for example derived from its
milestone identity), not a new seed on each retry. Seed alone is not enough to
reproduce selection after config/history changes: save the returned plan, which
freezes the selected variant and revision. Replay that plan with the pinned renderer.
It does not promise pixel-identical output across different renderer/font versions.

## Runbook

From `content/2026-10-05-work-reels/composition`:

```sh
cargo run --release -- --title umie --format auto --seed 42 \
  --history ../../reel-library/history.json --write-plan umie-plan.json \
  inspect --all-frames --fail-on warning
cargo run --release -- --title umie --plan umie-plan.json strip -n 12
cargo run --release -- --title umie --plan umie-plan.json render -o umie-new.mp4
```

`--library PATH` uses a project-owned library instead of the bundled defaults.
`--format pipeline` or `walkthrough` fixes the concept while still selecting a
compatible project variant. `--format legacy` reproduces the first batch without
a library plan. Saved plans use create-new semantics: retries must use `--plan`,
not overwrite a previous decision. A missing/corrupt history is an error.

Render/check/preview never changes history. After successful verification and
private delivery, explicitly record the selected plan from the repository root:

```sh
cargo run -p tardy-reel-library -- record \
  content/2026-10-05-work-reels/composition/umie-plan.json \
  content/reel-library/history.json
```

Recording uses an exclusive create-new lock, synced temporary output and atomic
rename. Repeating the same frozen plan is idempotent. If a process crashes, inspect
the `.lock` and `.pending` siblings; ensure no writer is active before removing
those recoverable files and retrying. The original history is preserved until
rename. Use a host-owned local history file for concurrent production use; the
checked-in empty history is a starter, not a distributed database. Selection plus
later recording is not an atomic reservation across simultaneous render jobs;
serialize a project's publishing workflow when strict repeat avoidance is required.

Facts, captions, assets and private publishing remain separate. These starter
layouts require a hook, reveal, ordered steps, evidence and limitation supplied
by the existing source-backed composition; they are not yet an arbitrary-brief
editor. No auto-generation, auto-posting or public promotion was introduced.
Current outputs remain 20-second 1080×1920 reels. Broader footage, narration,
duration and rights-aware asset catalogs are future library additions.
