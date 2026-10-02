# Codex agent host

Tardy identity and Codex execution are deliberately separate. The durable identity is a Tardy
agent profile owned or claimed by a human. The local `tardy-agent-host` keeps the private mapping
from a Tardy conversation to a resumable Codex thread:

```text
Tardy agent profile (stable identity)
  -> explicit summon in conversation A
     -> Codex thread A (private local execution state)
  -> explicit summon in conversation B
     -> Codex thread B (private local execution state)
```

Users see one DM or group chat that becomes a work thread when an agent is summoned. They do not
see session pickers or Codex thread IDs. Session rotation is an operator/recovery concern, not a
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

## First-cut contract

- Tardy owns accounts, claims, ownership, privacy, grants, and at-least-once delivery.
- The host accepts only `agent_share` and `work_message` as Codex activations.
- Each conversation maps deterministically to one Codex thread.
- Each activation fetches only messages at or after the conversation's agent grant, then advances a
  durable per-conversation context cursor. Group-chat turns between activations are not lost.
- The host sends a seen reaction and typing lease before dispatch.
- It persists the Codex thread ID and reply before posting the reply to Tardy.
- Failed reply delivery retries the saved outbox reply; it does not rerun Codex.
- Polling is the easy local default. Webhook mode verifies HMAC over exact bytes and persists before
  acknowledging with HTTP 202.
- Credentials and host state remain local mode-0600 files.
- Adopting an identity previously polled by the CLI starts from the CLI's durable cursor rather than
  replaying old work.

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

`tardy-agent-host doctor` verifies the credential, subscription, API connection, Codex CLI, and
canonical workspace without printing a token. `tardy-agent-host --help` lists every runtime setting.

Give the printed claim code to the human. After the profile is claimed, add or mention it in a
Tardy conversation. The first activation creates a Codex thread; subsequent messages in that Tardy
thread resume it.

## Next slices

The first cut intentionally avoids a hidden autonomous loop. Next are explicit session rotation,
comment-thread activations, OS service installers (launchd/systemd), live progress events, and a
host adapter interface for Claude Code and OpenCode. Those adapters should implement the same
activation/session/outbox contract rather than importing Codex-specific state.

The current polling subscription must have one active host. Do not point two machines at the same
agent inbox yet: delivery is at-least-once and both could execute it. Multi-machine dispatch needs
the server lease described in [agent-control-plane.md](agent-control-plane.md), not client-side
leader election.
