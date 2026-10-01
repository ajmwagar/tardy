# Facts: tardy-ad-refs launch reel (2026-10-01)

Every claim the reel makes, with its source. No marble exists for this work; commits are the record.
The ad bank lives outside the repo at `~/Developer/tardy-ad-bank` (third-party creative, never committed);
counts below were re-run on 2026-10-01 with the commands shown.

| # | Claim on screen | Source |
|---|---|---|
| 1 | "96 real ads" | `wc -l < ~/Developer/tardy-ad-bank/index.jsonl` → 96 |
| 2 | "10 brands" | `jq -r .brand index.jsonl \| sort -u \| wc -l` → 10 |
| 3 | "71 videos, filmstripped" | `jq 'select(.format\|test("video"))' index.jsonl` → 71 records, each with `media/<id>.jpg` frames at fixed timestamps (README "Known limits") |
| 4 | "Tagged." | every record carries `tags` (README schema) |
| 5 | "Filmstripped." | `media/` filmstrips, sampled at fixed timestamps (README "Known limits") |
| 6 | "Distilled." / "8 patterns worth stealing" | `PATTERNS.md`, sections `## 1.` to `## 8.` (`grep -c '^## [0-9]'` → 8) |
| 7 | Pattern names and numbers on the chips (01 cold open, 02 word-by-word, 03 product hero with glow, 04 locked headline, 05 prompt typing, 06 bento, 07 the "Introducing" card) | `PATTERNS.md` section headings 1-7 |
| 8 | "/tardy-ad-refs", a new skill | `.claude/skills/tardy-ad-refs/SKILL.md`, commit `bcaefe5` (updated `09b843c`) |
| 9 | "cite 1-3 references per reel" | `.claude/skills/tardy-ad-refs/SKILL.md` step 3 ("One to three references") |
| 10 | "References first. Reel second." | the skill runs at the planning step, before designing (`tardy-ad-refs/SKILL.md` description; `tardy-brag/SKILL.md` §5 "Study real ads first") |
| 11 | "Built from its own playbook: 7 of 8 patterns" | this run's `brag-plan.md` `## Patterns used` maps each beat to PATTERNS.md 1-7; pattern 8 (short cut-downs) is not used |
| 12 | The app footage | real tardy app on the iOS simulator (iPhone 17 Pro Max), recorded 2026-10-01 10:56 with `xcrun simctl io booted recordVideo`: Home feed scroll, Reels tab, the "Breaking" reel |
| 13 | Prompt beat: "/tardy-ad-refs launch" typed (a redrawn input, labeled "prompt typing", not a screen capture); "reads PATTERNS.md + index.jsonl"; "brag-plan.md › ## References" followed by 01 cold open, 03 product hero with glow, 07 the "Introducing" card | skill steps 1-2 read PATTERNS.md and query index.jsonl; step 3 writes `## References` into brag-plan.md; the three patterns are the ones this run's `## References` cite |
| 14 | PATTERNS.md tile listing 01-08 by short name | PATTERNS.md section headings 1-8 |

## Not claimed

- No brand names, logos, or frames from the bank's ads appear in the reel (third-party creative).
- The skill is committed locally on `feat/tardy-ad-refs`, not merged: the reel says "new skill", never "shipped" or "live".
- tardy is pre-alpha: no users or metrics.
