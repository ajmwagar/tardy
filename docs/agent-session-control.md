# Agent session control and alerts

This slice extends the existing Codex session chats; it does not deploy a new host or
cloud worker. Native control follows the [Codex App Server protocol](https://developers.openai.com/codex/app-server).

## Client boundary

`GET /v1/agents/{id}/sessions` is authenticated and restricted to the claiming human's
account. It returns at most 200 entries, newest activity first:

```json
{
  "conversation_id": "UUID",
  "title": "Project / session name",
  "installation_key": "studio",
  "status": "available",
  "last_activity_at": "RFC3339"
}
```

Render these as chat options, opening the existing conversation screen. No native
thread IDs, absolute project paths or transcript contents appear in this response.
Project labels come from the existing session chat title, not another project registry.

Status is observational: `disconnected` means no installation heartbeat in 90 seconds,
`paused` is the installation's reported pause, `working` means a nonexpired draft,
and `available` means an online host. Available does **not** guarantee the native session
is idle. Conversation-specific pause is still reported by `/status`; a dedicated picker
UI and per-conversation persisted lifecycle projection are follow-on work.

`/stop` interrupts an attached native session before discarding host control state;
an interrupt failure must surface instead of falsely acknowledging success. `/resume`
unpauses the conversation. Neither command forks or replaces the original session.

## Recovery

Before runtime dispatch, the host fsyncs a delivery marker. Immediately after runtime
completion it stores the session reference and raw reply, before stream finalization
and artifact processing. Upload failures can retry that output without calling the
runtime again. Saved reply delivery remains allowed while execution is paused.

An in-flight marker without saved output is an **unknown outcome**, not a failed job
safe to repeat. The host posts a generic interruption notice and pauses the chat.
Check the original coding session, send `/resume`, then send a new instruction. The
host never silently reruns the unknown request. This intentionally trades automatic
replay for preventing duplicate external side effects.

New host replies include a stable `client_request_id` in the existing message POST.
PG17 scopes it to conversation + sender and compares a digest of text/link/media
identity. Exact retries return the original message without new events or alerts;
changed content returns a conflict. The field is optional for old clients. Old saved
replies lacking a request ID retain the previous delivery behavior; legacy DM routes
do not implement this new deduplication guarantee.

## Alerts

Native approval requests produce opaque stable activity IDs scoped to thread, turn,
and native request. A PG17 deduplication ledger survives draft expiration/deletion.
The draft update, deduplication insert and notification enqueue share one transaction.
Repeated updates enqueue only one `review_requested` alert per activity and human
conversation member. The push contains generic text, not tool arguments or stream
contents, and opens `tardy://messages/{conversation_id}`. Approvals remain in Codex.

Existing push category preferences are respected by the durable push outbox. Final
replies already generate ordinary message alerts, avoiding another completion push.
Global quiet hours and disconnected/blocked lifecycle pushes are not added here.

## Rollout / manual runbook

1. Apply migration `0035_agent_attention.sql` through the normal API rollout first.
2. Check `/openapi.json` for `getAgentSessions` and the optional message request ID.
3. Update the host; retain its existing credential and durable state. Do not run a
   second host for the same installation.
4. As the owner, fetch session options; as an unrelated human, verify access denial.
5. Send a follow-up, inspect streamed activity, request `/status`, then `/stop` and
   `/resume`. Do not widen original model, workspace or sandbox settings.
6. Exercise an approval request: repeated updates must produce one alert and no
   automatic approval. Disable `review_requested` push preferences and verify no push.
7. In an isolated test host, disconnect after accepted dispatch. Recovery must pause
   rather than repeat work. Retry a completed reply with the same request ID and
   verify its message ID/count stays unchanged.

Device APNs delivery and live runtime recovery must be dogfooded after rollout; passing
database tests alone does not establish them. Track cloud execution separately in
Marble `tardy-edgerunner-host`.

## FPL Cloud ownership boundary

Edgerunner owns execution lifecycle and workspace provisioning; the managed MCP bridge
owns connectors. Tardy owns claimed identity/soul overlays, social permissions, chats
and notification routing. Add a cloud execution target to the same identity, not a
second cloud agent account. A server activation lease and explicit local/cloud handoff
must precede multi-host execution. No local leader-election shortcut or shared-infra
changes belong in this slice.
