# /brag plan: tardy brainrot recap, week of 2026-09-24

Run via `/tardy-brainrot` → `/tardy-brag` → `/brag --full --format vertical --tone chaotic --voice`.

## Inspect (brag's rubric, short)

- **What it is:** a recap of the week tardy went from an empty repo to an app: 19 PRs.
- **Most impressive claim:** 19 PRs merged in 4 h 43 min; the last six in 78 seconds (`facts.md`).
- **Visual hook:** the tardy alarm-clock mascot sprinting over train roofs; each PR is a coin.
- **Real thing shown:** the real PR numbers, titles and merge times, and the real app icon as the runner.
- **Tone:** `chaotic`; direction "split-screen brainrot recap".

## Angle

The run *is* the sprint. The runner moves through the actual merge timeline: the HUD clock is the
merge time, each coin is a merged PR, the one bug PR (#11, two videos at once) is a red block the
runner crashes into and then smashes. The last six PRs arrive as a coin shower.

## Layout (1080×1920)

- Top half (0–950): the hosts. **Chonk** (big, slow, delighted, `am_michael`) left; **Pip** (small,
  scheming, fast, `af_nova`) right. Their mouths move with their own voice tracks' loudness.
  Karaoke captions between them (word timings from `hyperframes transcribe`).
- Yellow divider at y=950.
- Bottom half (950–1920): three-lane runner over train roofs, drawn in canvas from one GSAP proxy.
  HUD top-left of the gameplay: `MERGED n/19` and the merge clock. App chrome covers y > 1440, so
  nothing readable sits there.

## Storyboard (32.0s; voice drives timing)

| # | Time | Host | Line | Game |
|---|---|---|---|---|
| 0 | 0.30–3.93 | Pip | Nineteen pull requests. Four hours, forty-three minutes. Watch. | Runner already sprinting; big "19 PRs · 4h43m" card |
| 1 | 4.08–8.19 | Chonk | PR one. The iPhone app. Feed, reels, ranking. | Coin #1 03:50 |
| 2 | 8.34–11.07 | Pip | Then messages, notifications, and native reels. | Coin #3 04:09 |
| 3 | 11.22–13.66 | Chonk | Stories! Comments! Like a real app. | Coin #6 05:43 |
| 4 | 13.81–16.37 | Pip | Next, a server. Written in Rust. Obviously. | Coin #2 05:56 |
| 5 | 16.52–19.00 | Chonk | Repost. Collab tardies. A share sheet. | Coin #9 07:26 |
| 6 | 19.21–21.29 | Pip | Uh oh. Two videos playing at once. | Red block "2 videos at once" ahead |
| 7 | 21.44–22.47 | Chonk | Bonk. Fixed. | Crash, block shatters, coin #11 07:33 |
| 8 | 22.62–25.03 | Pip | Then six PRs in seventy-eight seconds. | HUD ticks #10, #15, #18, #20, #21 (07:59 → 08:31); stopwatch card "08:32:13 → 08:33:31, 6 PRs · 78 s" |
| 9 | 25.18–28.91 | Chonk | Tap-backs. Share to your agents. Video at its real shape. | Six-coin shower #16 #13 #14 #12 #17 #19 |
| 10 | 29.06–30.83 | Pip | It's pre-alpha. Stay tardy. | Wordmark over the run |
| — | 30.83–32.00 | — | — | Runner returns to frame-0 pose: seamless loop |

Coins run in merge order, so the HUD counter only goes up (#6 merged before #2). Final timings are
the trimmed voice clips; see `composition/index.html` `LINES`.

## Limits pushed

1. **The gameplay is the data:** coins, the crash, and the HUD clock come from `facts.md`.
2. **Two voices with audio-driven mouths:** per-frame RMS from each voice track drives that host.
3. **Word-level karaoke** from real transcription, not even spacing.
4. **Seamless loop:** the last frame matches the first.

## Sound

brag's `happy-beats-business-moves-vol-9` (114.8 BPM) as the bed, ducked to ~0.14 under the voices.
Coins on `bong`, the crash on a heavy soft impact plus an error blip, the finale on a bell.
Music license: CC BY 4.0, Sascha Ende (same series as the app's bundled reels; see
`mobile/assets/reels/CREDITS.txt`). Credited in `share-copy.txt`.

## Revision 1 (after grade: revise, 68.75)

- Proof: the real brainrot reel #6 shipped plays in a phone card (11.6–14.6s); PR #11's real fix
  diff shows after "Bonk" (21.6–23.6s).
- Combo titles only the three PRs Chonk names, each while he says it.
- Readable "BUG: 2 videos playing at once" callout (19.35–21.45s).
- Loudness normalized to -14 LUFS at the poster bake.
- Captions kept full width: the app's action rail is bottom-anchored (from about y=1000), so the
  top-half captions never sit under it; the skill's safe-zone wording was corrected.

## Share caption

See `share-copy.txt`.
