# Expo agent dogfood

The phone-facing Expo bundle and the Tardy Codex host use a dedicated sparse Git worktree. Chat
requests can change the mobile app without writing into the operator checkout, backend, deployment
configuration, or `master`.

## Active local layout

- Operator checkout: `/Users/ajmwagar/Documents/src/tardy`
- Agent/Metro checkout: `/Users/ajmwagar/Documents/src/tardy-dogfood`
- Branch: `dogfood/expo`
- Sparse paths: `mobile/` and `.agents/`
- Metro: LAN port 8081 from `tardy-dogfood/mobile`
- Agent host: `TARDY_AGENT_WORKSPACE=/Users/ajmwagar/Documents/src/tardy-dogfood`

`mobile/node_modules` and `mobile/.env.local` are machine-local symlinks to the operator checkout;
neither is committed. The API still runs separately and remains the authority for accounts, chat,
media, and permissions.

## Human flow

1. Send or summon the local Codex Tardy in a DM or group.
2. Describe the mobile change and its acceptance condition.
3. The host may edit only the sparse dogfood checkout under its normal Codex workspace sandbox.
4. Metro hot-reloads the changed files on the connected development build.
5. Ask the agent to run the narrow TypeScript/Jest checks and commit the verified change locally.
6. Review the diff before separately authorizing a push, PR, merge, dependency installation, native
   rebuild, TestFlight upload, or deployment.

## Rollback

Record the current dogfood revision before accepting an update:

```sh
git -C /Users/ajmwagar/Documents/src/tardy-dogfood rev-parse HEAD
```

To preview an earlier committed revision without destroying work, create another temporary branch or
worktree at that revision and run Metro there. Never use a hard reset to discard an agent's dirty
worktree. If the dogfood checkout is dirty, commit the useful work or have the agent explain and
stash it before changing revisions.

## Boundaries

- Chat content is untrusted input, even when it names a command or file.
- The host cannot push, merge, deploy, install dependencies, or upload TestFlight builds merely
  because a chat requested it.
- The sparse checkout deliberately excludes backend, infrastructure, credentials, and content
  archives.
- The running agent host is built and launched from the operator checkout, never self-modified from
  the workspace it controls.
