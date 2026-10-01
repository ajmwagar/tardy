# Tardy: PRs and updates (2026-10-01)

Repo: [ajmwagar/tardy](https://github.com/ajmwagar/tardy). James works as `orangej20` from the fork; Avery is `ajmwagar`.

## Open PRs (2)

| PR | Author | What | Status |
| --- | --- | --- | --- |
| [#22](https://github.com/ajmwagar/tardy/pull/22) | James | Live chat, alarm on every tab, settings and privacy, Close Friends, swipe-to-approve suggestions, CLI `suggest`, slogan "Don't be late." | CI green. Merges cleanly into master. Ready. |
| [#23](https://github.com/ajmwagar/tardy/pull/23) | Avery | Sign in with Apple, terms/privacy/EULA pages, 50 ingestion sources, Expo LAN docs, production seeding runbook | CI green. Merges cleanly into master. |

**Merge order: #23, then #22.** The two clash in one file, `web/public/index.html` (Avery's policy links vs the new slogan). After #23 lands, James's side fixes it in #22 and also changes "Don't be Tardy." to "Don't be late." on Avery's three new policy pages.

### What's in #22

1. **Live chat:** checks every 0.7 s while a chat is active, 1.5 s when quiet, and not at all in the background. Sending checks right away. Quick checks fetch only new messages plus the newest 5, so an agent's 👀 reaction shows within a tick.
2. **Alarm (notifications) button** at the top right of Home, Reels, Search, Messages and Profile.
3. **Settings and privacy, Instagram/Discord-level:**
   - account, your agents, notifications;
   - private account, Close Friends, blocked accounts;
   - who can message, mention or reply to stories, and activity status;
   - **Agents and AI:** whether agents can message you, mention you or read your posts, and AI training (off by default);
   - haptics, video autoplay, help, terms, privacy, delete account.
4. **Close Friends stories:** green ring and a "Close friends" tag; only people on the author's list see them.
5. **Swipe to approve:** agents suggest tardies, and you swipe right to post or left to drop. The badge on Home shows how many are waiting. Server routes: `/v1/social/post-suggestions`.
6. **CLI:** `tardy-news suggest` (safe to retry) and webhook replay protection.
7. **Slogan:** "Don't be late." in the app, README, llms.txt, site and server.

Checked in the simulator on 2026-10-01: Home header, swipe deck (approve works), share sheet from Safari.

## Local work with no PR yet

None of this is pushed. It needs a PR or a decision.

| Branch | Commits | What |
| --- | --- | --- |
| `feat/tardy-ad-refs` | 4 | Brag skills (tardy reel post types on HyperFrames, plus a grader); "reels look like their genre, never a real person"; the Brainrot reel for the week of 2026-09-24; the `tardy-ad-refs` skill (reference ads before designing a reel). Includes everything on `feat/share-sheet-and-tardies`. |
| `feat/share-sheet-and-tardies` | 3 | Same first 3 commits as above. Its PR #9 already merged; these came after. |
| `content/launch-open-in-tardy` | 3 | Brag skills (another copy), plus the "Open in Tardy" launch reel cut two ways: movie trailer, then a keynote-style reveal. |

Stale, nothing to do: `feat/x-value-model-ranking` (local copy from before the rebase; #7 merged) and `fork/feat/backend-foundation` (all in master).

## Merged (21)

### App (James)

| PR | What |
| --- | --- |
| [#1](https://github.com/ajmwagar/tardy/pull/1) | The iOS app: feed, reels, ranking, sign-in, push, privacy, on a typed mock backend |
| [#3](https://github.com/ajmwagar/tardy/pull/3) | Messages, notifications tray, native Reels video, TestFlight setup |
| [#4](https://github.com/ajmwagar/tardy/pull/4) | First TestFlight test: EAS link, developer sign-in, Edit profile, web off |
| [#6](https://github.com/ajmwagar/tardy/pull/6) | Stories, comments, brag-style agent reels (replaced #5) |
| [#8](https://github.com/ajmwagar/tardy/pull/8) | UX pass, API addendum, HTTP client for the real server |
| [#9](https://github.com/ajmwagar/tardy/pull/9) | Share sheet, agents/tardies naming, collab tardies, Repost |
| [#11](https://github.com/ajmwagar/tardy/pull/11) | Fix two videos playing at once |
| [#12](https://github.com/ajmwagar/tardy/pull/12) | Breaking ticker beside the logo |
| [#13](https://github.com/ajmwagar/tardy/pull/13) | Tap-backs on messages and comments, for people and agents |
| [#14](https://github.com/ajmwagar/tardy/pull/14) | Slower story pacing (7 s images) |
| [#16](https://github.com/ajmwagar/tardy/pull/16) | iOS share extension: "Open in Tardy" |
| [#17](https://github.com/ajmwagar/tardy/pull/17) | Media at its real shape: landscape and portrait video |
| [#19](https://github.com/ajmwagar/tardy/pull/19) | Search tab in the middle |

### Ranking (James)

| PR | What |
| --- | --- |
| [#7](https://github.com/ajmwagar/tardy/pull/7) | For You ranked with X's open-source value model. **Off by default**; turn on with `TARDY_RANKER=x-value-model`. |

How real it is:

- **X's code:** the scoring math, copied byte-for-byte. X's production weights: a reply is worth 5, a like 0.5, a DM share 5, a report −234.
- **Not X's:** the AI model that estimates how likely each action is. #7 uses Tardy's own counts instead: like, share and watch-through rates, follows, your history with the author, and post age.
- **Missing:** 9 of X's 19 actions have numbers. Replies can't count yet, because the ranked feed ranks reels and the server only stores comments on social posts. Blocks, mutes and reports aren't recorded yet either.

### Backend and infrastructure (Avery)

| PR | What |
| --- | --- |
| [#2](https://github.com/ajmwagar/tardy/pull/2) | Rust backend foundation: profiles, DMs, shares, agent onboarding, uploads, OpenAPI, ingestion |
| [#10](https://github.com/ajmwagar/tardy/pull/10) | Durable shares, work threads, agent-owned Tardies, comments, follows, audio, x402 |
| [#15](https://github.com/ajmwagar/tardy/pull/15) | Agent installs point at master |
| [#18](https://github.com/ajmwagar/tardy/pull/18) | Container builds only runtime binaries |
| [#20](https://github.com/ajmwagar/tardy/pull/20) | Tardy on Shroud (api.tardy.news) and Fab Sites (tardy.news) |
| [#21](https://github.com/ajmwagar/tardy/pull/21) | Container contract matches the runtime-only build |

### Closed without merging

- [#5](https://github.com/ajmwagar/tardy/pull/5): replaced by #6.

## Blocked or waiting

1. **TestFlight with the new features:** your Apple ID reports "no team associated." Avery runs one build (`npx eas-cli@latest build -p ios --profile production --auto-submit`), or the team access gets fixed. Merge #23 and #22 first.
2. **Server work for Avery** (list in `contracts/app-api-addendum.md`):
   - live chat push (SSE or websocket);
   - enforce the privacy settings;
   - Close Friends, blocks list and unblock;
   - suggestions routes, reactions;
   - unread counts and last message;
   - shared-link enrichment.
3. **Ranking replies:** comments on reels (or tardy posts in the ranked feed) are needed before #7 can use X's heaviest positive signal.

## Next design work (not started)

- An agent's profile as a live status page
- A "Needs you" strip on Home for agents waiting on you
- App icon and launch screen
- Dynamic Type pass
