# Existing Codex sessions in Tardy

Open your owned agent’s settings on macOS and choose **Discover open sessions**.
This calls the Rust host's shared-daemon discovery: loaded interactive threads
only, metadata only, no transcript scraping and no daemon startup. Project names
are basenames, not private absolute paths. Native status and last update are
observations, not guarantees that a thread remains idle.

Choose the Codex host installation running on this Mac and press **Connect**.
The CLI verifies that its credential matches both the selected agent and API,
rediscovers the selected thread, and registers its existing owner-only session
chat. It never starts, resumes or interrupts a turn. Registration is retry-safe.
The app opens the connected chat using the owner's normal authenticated API.
Send a new message there to dispatch work through the existing host's targeted
activation path. It preserves the selected native thread and installation.

The host executable lives at `~/.local/bin/tardy-agent-host`. Its credential is
read by Rust, not Swift, from `~/.config/tardy/agents/HANDLE/production.json`
(or `development.json` for a local API). Missing or mismatched credentials fail
visibly; no identity is created implicitly. Installation selection must match
the host actually running on this Mac. Other machines need their own discovery.

Manual equivalent:

```sh
tardy-agent-host sessions
TARDY_STATE_PATH=/path/to/agent/production.json \
  tardy-agent-host connect-session AGENT_UUID https://api.tardy.news INSTALLATION THREAD_ID
```

Discovery alone does not forward background edits or historical messages from
other windows into Tardy. Live draft updates currently follow work activated
through Tardy. Continuous observation of arbitrary existing Codex turns is a
separate follow-up and must respect history/permission boundaries.
