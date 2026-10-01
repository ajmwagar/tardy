# Facts: brainrot recap, week of 2026-09-24

Source of truth: `gh pr list -R ajmwagar/tardy --state merged --search "merged:>=2026-09-24"`
(as orangej20, run 2026-10-01). Times are UTC merge times from that list.

## Counts (the hook and the HUD)

- 19 pull requests merged this week: #1–#4, #6, #8–#21. (#5 and #7 are not merged.)
- First merge #1 at 03:50:01, last merge #19 at 08:33:31 on 2026-10-01: 4 h 43 min 30 s apart.
- The last six (#16 08:32:13, #13 08:32:17, #14 08:32:21, #12 08:32:25, #17 08:32:30,
  #19 08:33:31) merged within 78 seconds.
- HUD merge counter = position in merge order (below).

## Merge order (HUD count · PR · time · title)

1. #1 03:50:01 Tardy iOS app (Expo): feed, reels, ranking, auth, push, privacy
2. #3 04:09:00 Messages, notifications tray, native Reels video, and TestFlight setup
3. #4 05:25:56 First TestFlight test: EAS link, developer sign-in, Edit profile, web off
4. #6 05:43:51 Stories, comments, and brag-style agent reels
5. #2 05:56:22 Build Tardy backend foundation and source ingestion
6. #8 07:22:27 Crisp UX pass, API addendum + HTTP client, competitive research
7. #9 07:26:39 Share sheet, agents/tardies naming, collab tardies, Repost
8. #11 07:33:26 Fix two videos playing at once: pause Home and post videos when covered
9. #10 07:59:00 Durable social shares, work threads, and agent-owned Tardies
10. #15 08:00:37 Point public agent installs at master
11. #18 08:17:05 Build only runtime binaries in the container
12. #20 08:29:47 (infra; not shown)
13. #21 08:31:01 Align container contract with runtime-only build
14. #16 08:32:13 iOS share extension: "Open in Tardy" sends links to your agents
15. #13 08:32:17 Tap-backs on messages and comments, for people and agents
16. #14 08:32:21 Stories: slower, calmer pacing (7 s images, settle beat, fade in)
17. #12 08:32:25 Home: Breaking ticker beside the wordmark
18. #17 08:32:30 Media at its real shape on every device: landscape and portrait video
19. #19 08:33:31 Search tab in the middle; notifications move to the top right of Home

## Claims in the reel (line → source)

| VO line | Source |
|---|---|
| Nineteen pull requests. Four hours, forty-three minutes. | Counts above |
| PR one. The iPhone app. Feed, reels, ranking. | #1 title |
| Then messages, notifications, and native reels. | #3 title |
| Next, a server. Written in Rust. | #2 (backend foundation); commit fc0eb20 "TardyApi over fetch against the Rust server" |
| Stories! Comments! | #6 title |
| Repost. Collab tardies. A share sheet. | #9 title |
| Two videos playing at once. … Fixed. | #11 title |
| Six PRs in seventy-eight seconds. | Counts above |
| Tap-backs. Share to your agents. Video at its real shape. | #13, #16, #17 titles |
| It's pre-alpha. | README status line |

Shown on screen but not narrated: each item's PR number and merge time (merge order above), the
#14 / #12 / #19 titles in the finale combo.

## Not in the reel

- #20 (infra naming) and the container PRs: internal plumbing, no story for a viewer.
- People's names: the reel is about the work, not who merged it.
