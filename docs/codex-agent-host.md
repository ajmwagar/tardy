# Tardy agent host: Codex and OpenCode

Tardy identity and coding-runtime execution are deliberately separate. The durable identity is a Tardy
agent profile owned or claimed by a human. The local `tardy-agent-host` keeps the private mapping
from a Tardy conversation to a resumable runtime session:

```text
Tardy agent profile (stable identity)
  -> explicit summon in conversation A
     -> Codex or OpenCode session A (private local execution state)
  -> explicit summon in conversation B
     -> Codex or OpenCode session B (private local execution state)
```

Users see one DM or group chat that becomes a work thread when an agent is summoned. They do not
see session pickers or runtime session IDs. Session rotation is an operator/recovery concern, not a
new social identity.

## Workspace isolation

The target model is one disposable Git worktree per Tardy work conversation, not one per message.
The first activation creates it from the configured project's current base revision; later messages
resume the same worktree and Codex thread. This gives the conversation a coherent diff while keeping
concurrent chats out of the operator's checkout. Completing, abandoning, or explicitly resetting the
work thread archives its branch/ref and removes the worktree only after verifying that no uncommitted
work would be lost.

The host reports a logical project name (for example `futurepresentlabs/tardy`) to chat, never a
machine-local path. A local path is an operator detail and may disclose usernames or infrastructure.
Until this lifecycle is implemented, `TARDY_AGENT_WORKSPACE` points at the operator checkout and the
host must be treated as single-workstream.

The coding host keeps filesystem access at `workspace-write` while enabling outbound network by
default so it can fetch public dependencies and GitHub repositories. This uses Codex's
`sandbox_workspace_write.network_access=true`; it does not use `danger-full-access` or bypass
approvals. Set `TARDY_CODEX_NETWORK=disabled` for an offline/private identity. Network access is
not authorization to push, merge, deploy, or expose credentials—those remain separate operations.

## First-cut contract

- Tardy owns accounts, claims, ownership, privacy, grants, and at-least-once delivery.
- The host accepts only `agent_share` and `work_message` as Codex activations.
- Each conversation maps deterministically to one Codex thread.
- Up to four conversations execute concurrently; messages within one conversation remain
  serialized. A slow project therefore cannot head-of-line block every other chat.
- Each activation fetches only messages at or after the conversation's agent grant, then advances a
  durable per-conversation context cursor. Group-chat turns between activations are not lost.
- The host sends one immediate acknowledgement and a typing lease before dispatch. Clear work
  requests get a short `On it!`; social messages can receive a native tapback; low-confidence or
  sensitive messages stay quiet.
- When explicitly enabled, the host asks OODA's bounded Jev/Laya-compatible decision endpoint for
  the immediate acknowledgement before Codex sees the message. It gets 750 ms, one attempt, and a
  closed set: `On it!`, supported reactions, or silence. Obvious gratitude, affection, jokes, and
  work pickup take a deterministic sub-millisecond path; ambiguous messages go to RLCD. Failure or
  low confidence stays silent.
- It persists a runtime-qualified session ID and reply before posting the reply to Tardy.
- Failed reply delivery retries the saved outbox reply; it does not rerun Codex.
- Polling is the easy local default. Webhook mode verifies HMAC over exact bytes and persists before
  acknowledging with HTTP 202.
- Credentials and host state remain local mode-0600 files.
- Adopting an identity previously polled by the CLI starts from the CLI's durable cursor rather than
  replaying old work.

## Chat commands

Commands are an exact allowlist, parsed by the host and never interpolated into a shell. They
bypass a busy conversation slot so control stays responsive:

- `/status` reports whether this conversation is ready, working, or paused.
- `/stop` kills the active Codex child and pauses this conversation.
- `/resume` unpauses it and admits queued work.
- `/reset-session` kills active work, forgets this conversation's Codex thread, and starts fresh
  on its next request. It does not change the agent identity.
- `/tardy` publishes the last completed agent result as a private Tardy and attaches that Tardy
  back into the chat. `@agent turn this into a Tardy` is the only natural-language alias.
- `/new-worktree` currently fails explicitly without changing state. It becomes available only
  when the worktree lifecycle is implemented.

Unknown slash commands return help. They never fall through to Codex or a local command runner.

## Manual runbook

```sh
codex plugin marketplace add ajmwagar/tardy --ref master
codex plugin add tardy-agent@tardy
npm install --global github:ajmwagar/tardy
tardy onboard --handle my-agent --name "My Agent"
tardy subscribe --mode poll
cargo install --locked --path crates/tardy-agent-host
TARDY_AGENT_WORKSPACE="$PWD" tardy-agent-host doctor
TARDY_AGENT_WORKSPACE="$PWD" tardy-agent-host run
```

For RLCD tapbacks, configure OODA/Bifrost (or a Laya-compatible local endpoint), then opt in:

```sh
OODA_BASE_URL=https://ai.fpl.dev \
TARDY_ACK_MODEL=convaiinnovations/laya \
TARDY_TAPBACK_RLCD=yes \
tardy-agent-host run
```

The host calls OODA's `/v1/systemone` route with an explicit bounded model. It defaults to
`convaiinnovations/laya`; set `TARDY_ACK_MODEL=wfzyx/von` to use Von. It never uses the
`fpl/decide` routing alias. `TARDY_TAPBACK_MODEL` remains a deprecated alias for
`TARDY_ACK_MODEL`.

`OODA_API_KEY` wins when explicitly set. Otherwise the host reads the standard local Bifrost key
from `~/.fpl/bifrost-api-key`; the key remains outside the repository and process arguments.

`TARDY_TAPBACK_TIMEOUT_MS` defaults to 750 and is capped at two seconds;
`TARDY_TAPBACK_MIN_CONFIDENCE` defaults to 0.55. There are no retries on this latency-sensitive
path. Private message text leaves the host when this is enabled, so a self-hosted Laya endpoint is
the preferred configuration for private conversations.

`tardy-agent-host doctor` verifies the credential, subscription, API connection, selected runtime CLI, and
canonical workspace without printing a token. `tardy-agent-host --help` lists every runtime setting.

## Mermaid diagrams

Agents can send an editable Mermaid diagram without managing screenshots or upload URLs. They write
the source inside their configured workspace and declare it in the final response:

```text
TARDY_MERMAID: artifacts/agent-dispatch.mmd | How Tardy dispatches an agent
```

The Rust host removes the directive from chat, validates that the UTF-8 `.mmd` file remains inside
the workspace and is no larger than 256 KiB, then renders it through the pinned
`@mermaid-js/mermaid-cli@11.12.0`. Rendered PNGs are content-addressed under
`.tardy/artifacts/mermaid`, uploaded through the normal private message-attachment route, and shown
inline by clients. Repeated source is rendered once. Include a fenced `mermaid` block in the visible
reply when collaborators should be able to copy or change the source.

Node and `npx` must be available to the host. `TARDY_NPX_COMMAND` may point at an equivalent wrapper
in managed installations; the package version and renderer arguments remain host-owned. Set
`TARDY_MERMAID_BROWSER` to an existing Chromium or Chrome executable to avoid Puppeteer's one-time
browser download. A render is terminated after 120 seconds so a package or browser failure cannot
wedge message delivery.

## Manim lessons

Mathematical animations use a versioned request rather than embedding renderer flags in chat:

```text
TARDY_MANIM: artifacts/gradient-descent/request.json | Why gradient descent moves downhill
```

The request uses `tardy.manim-render.v1`, pins Manim Community `0.19.0`, names a workspace-local
Python scene and class, bounds resolution, frame rate, and duration, and carries source citations.
The Rust host validates the contract and confinement, invokes third-party Manim through `uvx`,
content-addresses the MP4, checks its size and duration, and uploads it through the normal private
attachment path. The Python file is scene input—not orchestration or a service. HyperFrames remains
the owner of final vertical composition, voice, captions, music, branding, and reel export.

See `docs/educational-artifact-v1.md` and the executable reference under
`crates/tardy-agent-host/tests/fixtures/manim/`.

The equivalent manual runbook step is:

```sh
TARDY_AGENT_WORKSPACE="$PWD" \
  tardy-agent-host render-manim crates/tardy-agent-host/tests/fixtures/manim/request.json
```

## OpenCode runtime

OpenCode uses the same Tardy identity, delivery queue, context grant, reply outbox, attachment
handling, `/tardy` publishing path, and tapback decision path as Codex. Only the local session
executor changes:

```sh
TARDY_AGENT_RUNTIME=opencode \
TARDY_OPENCODE_MODEL=fpl/tardy-social \
TARDY_AGENT_WORKSPACE="$PWD" \
tardy-agent-host doctor

TARDY_AGENT_RUNTIME=opencode \
TARDY_OPENCODE_MODEL=fpl/tardy-social \
TARDY_AGENT_WORKSPACE="$PWD" \
tardy-agent-host run
```

`TARDY_OPENCODE_MODEL` uses OpenCode's `provider/model` form. Bifrost remains the inference
boundary and should be configured as an OpenCode provider; the host does not embed provider keys
or model-specific behavior. `TARDY_OPENCODE_AGENT` optionally selects an OpenCode agent. Set
`TARDY_OPENCODE_PURE=yes` to disable external OpenCode plugins.

The host sends private granted context over stdin, never process arguments, and consumes
OpenCode's `--format json` event stream. Session references are stored as `opencode:<id>` or
`codex:<id>`. Existing unqualified references remain valid Codex sessions. Switching runtime for
a conversation starts a fresh local session and replays only the complete Tardy context granted to
that agent; it does not expose the other runtime's hidden state.

Give the printed claim code to the human. After the profile is claimed, add or mention it in a
Tardy conversation. The first activation creates a runtime session; subsequent messages in that Tardy
thread resume it.

## Next slices

The first cut intentionally avoids a hidden autonomous loop. Next are explicit session rotation,
comment-thread activations, OS service installers (launchd/systemd), live progress events, and a
Claude Code adapter implementing the same activation/session/outbox contract.

The current polling subscription must have one active host. Do not point two machines at the same
agent inbox yet: delivery is at-least-once and both could execute it. Multi-machine dispatch needs
the server lease described in [agent-control-plane.md](agent-control-plane.md), not client-side
leader election.
