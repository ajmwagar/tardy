# Moving Tardy work to Titan (plan, 2026-10-01)

Titan has room this Mac doesn't: 24 cores, 61 GB RAM, 1.6 TB free, an RTX 4070 Ti. It's reachable from this Mac over Tailscale as `ssh titan` (user `mames`). Claude on the Mac can drive it from this chat.

## What's on Titan today

| Thing | State |
| --- | --- |
| `~/tardy` | **A different project** (`tardy-org/tardy`, Zig). Not ours; leave it alone. Ours goes in `~/src/tardy-app`. |
| GitHub | `gh` is signed in as **orangej20**, the active account. No global git name or email is set (good: the repo sets its own). |
| Node | v22 via Volta, with npm, npx and pnpm |
| Rust | cargo 1.98 |
| Docker | Installed, for PostgreSQL 17 |
| psql | Installed |
| Missing | Claude Code, ffmpeg (reel rendering), a Chrome for HyperFrames (it may bundle its own) |
| Marbles | A **local** server on Titan (`127.0.0.1:7878`) with HQ, bank, dir-ai-town, fpl-strategy, hq and meridian. **No `tardy` project.** Tardy's issues live on the shared server, `marbles.fpl.dev`, which still needs the client secret from Avery. |
| `~/src/bank` | FPL's link bank: `bank add <url>` fetches X posts and news pages into `inbox/`, then agents write digests through Marbles. |
| `~/comfyui` | ComfyUI on the GPU. It can make the 100x avatar pack locally. |

**The one thing Titan can't do: the iOS simulator.** It's Linux. App builds still go through EAS in the cloud, then to TestFlight or a registered phone. Checking screens in a simulator needs a Mac, so keep this Mac for quick visual checks, or install EAS "preview" builds on your phone.

## Step 1: save everything on the Mac first (about 10 minutes)

Most work is already on GitHub, in PRs #22–#25. These aren't:

1. **Push `content/launch-open-in-tardy`** to the fork. It has two "Open in Tardy" launch reel cuts (`0f738fa`, `54a7644`) that exist only here.
2. **The stash on `master`:** "local README/AGENTS/CLAUDE edits." Decide to keep or drop; keeping means committing it to a branch.
3. **Files in the main checkout that git doesn't track**, so a clone won't include them:
   - `brag-output/` (134 MB);
   - `content/` (41 MB);
   - `docs/assets/` and `docs/brand/` (8 MB);
   - `research/feeds-and-discovery.md`;
   - `docs/tardy-status-2026-10-01.md` and this plan.

   Anything that belongs in the repo gets committed. The rest is copied over (step 3).
4. **Folders outside the repo:**
   - `~/Developer/tardy-ad-bank` (3.3 MB): screenshots of other companies' ads. **Never commit it.** Copy it only.
   - `~/Developer/tardy-reel-studio` (13 MB): not a git repo. Copy it.
5. **`CLAUDE.local.md`** (the orangej20-only rules): copy it.

## Step 2: set up the repo on Titan (about 20 minutes)

1. Clone `ajmwagar/tardy` to `~/src/tardy-app`. Remotes: `origin` is `ajmwagar/tardy`, `fork` is `orangej20/tardy`.
2. Pin git to orangej20, as on the Mac:
   - repo-local `user.name` "James Merrill" and `user.email` `100983655+orangej20@users.noreply.github.com`;
   - a credential helper that runs `gh auth token -u orangej20`.
3. Install the missing tools:
   - Claude Code (`npm i -g @anthropic-ai/claude-code`, through Volta);
   - `ffmpeg` (apt);
   - HyperFrames' browser dependencies.
4. Backend: start PostgreSQL 17 in Docker, then run `cargo test` and the PG tests (`tests/auth_pg.rs`, `tests/pg_ingest.rs`).
5. App: `cd mobile && npm ci && npx tsc --noEmit && npx jest`. Run EAS builds from here (`npx eas-cli build`). You type the Expo and Apple logins yourself.
6. Check out the open branches as worktrees: `feat/live-chat` (#22), `feat/feed-research-and-ad-bank` (#24), `feat/tardy-reels` (#25).

## Step 3: copy the local-only files (about 5 minutes)

`rsync` from this Mac to Titan:

| From (Mac) | To (Titan) |
| --- | --- |
| `~/Developer/tardy-ad-bank/` | `~/src/tardy-ad-bank/` |
| `~/Developer/tardy-reel-studio/` | `~/src/tardy-reel-studio/` |
| `tardy/brag-output/` and untracked `tardy/content/` | `~/src/tardy-app/` (same paths) |
| `tardy/CLAUDE.local.md` | `~/src/tardy-app/CLAUDE.local.md` |

## Step 4: Marbles (2 minutes once Avery replies)

Tardy's issues are on `marbles.fpl.dev`, and the repo points there (`.marbles/project.toml`). Titan's local Marbles is a separate tracker.

- **Recommended: sign Titan in to `marbles.fpl.dev`** with the client secret from Avery: `marbles --url https://marbles.fpl.dev login`. The browser sign-in runs on Titan, or on any machine that can reach Titan's `localhost:17878`.
- **Not recommended:** a `tardy` project on Titan's local server. It would split the tracker, and the repo's rules say issues live on the shared server only.

## Step 5: the content bank

One bank, in four parts, each with a clear home:

| Part | What | Where | In git? |
| --- | --- | --- | --- |
| **Reference ads** | Real ads from the Meta Ad Library, used when designing reels (`/tardy-ad-refs`) | `~/src/tardy-ad-bank` | No (other companies' copyrighted creative) |
| **Inbound links** | X posts and news worth reacting to, digested by agents | FPL `~/src/bank` (`bank add <url>`) | Yes, in the bank repo |
| **Our reels** | Finished tardy reels with plan, scorecard and media | `tardy-app/content/<date>-<slug>/` | Yes, in the tardy repo |
| **Launch seed** | Tardies, agents and projects to fill the feed on day one (runbook: `docs/production-seeding.md` from #23, 50 ingestion sources) | `tardy-app/content/launch-seed/` as a manifest: stable `client_request_id`, author, caption, visibility, source URL, R2 key | Yes (the manifest; media goes to R2) |

What Titan makes possible:

1. **Render reels in batches on the GPU:** HyperFrames, plus Kokoro voices locally, at no per-render cost.
2. **The avatar pack at 100x:** ComfyUI on Titan generates agent and brand avatars in the house style. Avery's and James's photos are the human style references.
3. **Launch seed:**
   - about 100 seed tardies from the 50 sources, each with attribution and an approval note;
   - a reel for each launch feature (Open in Tardy, tap-backs, Approvals, Agent controls, live chat).
4. **Grade everything** with `/tardy-brag-grade` before it goes into the seed.

## Step 6: what stays on the Mac

- Simulator checks of the app (Xcode is Mac-only).
- The Mac still has 1–3 GB of free disk. Clean up the old local branches and worktrees once Titan is working: `tardy-pr`, `tardy-reels-pr` (1.6 GB) and `tardy-content`.

## Order

1. Step 1 on the Mac: 10 min.
2. Step 2 on Titan: 20 min, plus about 15 min for the first `cargo test` and `npm ci`.
3. Step 3: 5 min.
4. Step 4: when Avery sends the secret.
5. Step 5: ongoing. Start with the launch seed manifest, then the avatar pack.
