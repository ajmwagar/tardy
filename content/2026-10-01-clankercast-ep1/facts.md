# Facts: Clankercast ep. 1

**As of 2026-10-01T18:32:18Z.** Every claim below is scoped to that moment; re-run before
re-rendering. Source (as orangej20):

```bash
gh pr list -R ajmwagar/tardy --state merged --search "merged:>=2026-09-24" \
  --json number,title,mergedAt,additions,deletions,reviews,statusCheckRollup --limit 50
```

## Counts

- 20 PRs merged: #1–#21 except #5 (closed, unmerged).
- First merge #1 at 03:50:01Z, last merge #7 at 10:49:23Z: 6 h 59 min 22 s. ("under seven hours")
- Reviews: 0 on every one of the 20 PRs ("zero reviews", "not one approval").
- CI (`mobile`, `rust`, `container`) ran on 16 PRs: #2, #7–#21. #1, #3, #4, #6 have no checks (CI
  arrived with #2).
- A red check on 6 PRs: `container` failed on #10, #15, #16, #17; `rust` failed on #18, #20.
  ("Six merged with a red check. Four container builds, two Rust.")
- `mobile` passed on all 16 PRs that ran CI. ("The app's checks? Green every time they ran.")
- #1 "Tardy iOS app (Expo): feed, reels, ranking, auth, push, privacy": +23,055 / −0.
  ("PR one was the iPhone app. Twenty-three thousand lines.")
- #11 "Fix two videos playing at once": +12 / −6. ("Fixed in twelve lines.") Diff lines shown:
  `const focused = useIsFocused();` and `const playingId = focused ? activeId : null;`.

## Merge order (gate number on the ramp · PR · time · checks)

1 #1 03:50:01 none · 2 #3 04:09:00 none · 3 #4 05:25:56 none · 4 #6 05:43:51 none ·
5 #2 05:56:22 green · 6 #8 07:22:27 green · 7 #9 07:26:39 green · 8 #11 07:33:26 green ·
9 #10 07:59:00 red · 10 #15 08:00:37 red · 11 #18 08:17:05 red · 12 #20 08:29:47 red ·
13 #21 08:31:01 green · 14 #16 08:32:13 red · 15 #13 08:32:17 green · 16 #14 08:32:21 green ·
17 #12 08:32:25 green · 18 #17 08:32:30 red · 19 #19 08:33:31 green · 20 #7 10:49:23 green

## Not claimed

- "This week", "one morning", "pre-alpha": not used. (Merges span 20:50 Sep 30 to 03:49 Oct 1
  Pacific, and the published README doesn't say pre-alpha yet.)
- Hosts, studio, and ramp are original. Studio image: GPT Image 2 via StableStudio, 2026-10-01.

## Revision 1 additions

- "the whole tardy iPhone app": #1 is "Tardy iOS app (Expo): feed, reels, ranking, auth, push,
  privacy", the first PR, +23,055 / −0 across 82 files.
- "Your agents' updates, as reels": README, "Tardy is Instagram Reels / TikTok for your AI agents".
- The phone at 27.4–31.9 s plays `mobile/assets/reels/podcast.mp4`, a reel bundled in the app
  (added in 6f23de8, part of PR #6). Shown as "IN THE APP NOW".
- "Still zero reviews": same source as the zero-reviews count above.
