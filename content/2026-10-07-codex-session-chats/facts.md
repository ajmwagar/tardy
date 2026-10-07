# Existing sessions, new conversations

Evidence snapshot: 2026-10-07 10:12 UTC. All numbers refer to this local development cut.

Source: ajmwagar/tardy, local branch feat/codex-session-connect.
Commits: 26942bd, 195e053, 13f3ef4, 6f0d4b7.

- Automatic discovery over the existing Codex daemon's WebSocket/Unix control socket.
- One distinct, idempotent, owner-only work conversation per agent/installation/thread.
- Existing threads receive turn/start when idle and expected-turn-checked turn/steer when active.
- /stop interrupts the active native turn and pauses the Tardy conversation.
- Original workspace/model/sandbox/approval settings are not overridden.
- Matching replies and tool activity flow through the existing Tardy draft/event path.
- Read-only local discovery found 25 loaded threads, 10 interactive after excluding subagents and batch jobs.
- 25 host tests, 10 social PG17 tests, and one OpenAPI test passed: 36 focused tests, not a claim about the whole repository.
- Host binary built. Code committed locally. Not pushed, merged, deployed, or activated in the running API/host at this snapshot.
- No real message was injected into an existing user session to produce a live demo.

Visuals are an illustrative explanation, not live app footage. Session labels and the follow-up
"Continue the work." are generic examples, not private transcripts. The actual motivating request
was that each session should become an option to chat in directly.

Boundaries: owner-only session chats cannot add participants. Separate-server/--no-daemon sessions
are not imported. Native approvals remain native. Cross-project artifact directives retain the
host's configured file-upload boundary. Desktop-only turns are not passively mirrored.

Media: fframes 1.2.0 + Skia Metal. DM Sans (SIL OFL; license alongside composition).
Original synthesized ambient bed reused from content/2026-10-05-work-reels; generated with FFmpeg,
not third-party music. No paid generation, likenesses, private paths, raw logs, or credentials.
