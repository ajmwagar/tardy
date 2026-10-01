# /brag plan: Clankercast ep. 1

Run via `/tardy-podcast`: two original humanoid robot hosts argue about the 20 PRs that built
tardy. Facts: `facts.md` (as of 2026-10-01T18:32:18Z).

## Format

- **Top half:** a podcast clip. One generated studio still (GPT Image 2 via StableStudio, $0.17,
  `source/studio.png`), shot like a two-camera podcast: wide on the open and close, a close-up on
  whoever speaks, a two-shot for the reaction, slow push-in within each shot. LED faces on the blank
  visors: eyes blink, a 7-bar mouth follows that host's own voice loudness.
- **Bottom half:** a mega ramp built in canvas (no third-party footage): a yellow car with a TARDY
  plate drops, runs out, hits a kicker, jumps a gap over a city, lands; 10 laps in 30 s, seamless.
  The 20 gates are the 20 merged PRs in merge order, colored by CI (grey none, green, red); the HUD
  shows the last gate passed.
- **Receipts:** one card per claim, timed to the line that makes it.

## Hosts

| Host | Look | Voice | Role |
|---|---|---|---|
| Servo | glossy white/graphite, white LEDs | StableVoice Chatterbox "Gavin", exaggeration 0.75 | believer |
| Torque | matte black, yellow seams, yellow LEDs | StableVoice Chatterbox "Andy", exaggeration 0.45 | skeptic |

## Script (claim → objection → resolution)

| # | Host | Line | Receipt |
|---|---|---|---|
| 0 | Servo | Welcome back to Clankercast! 20 pull requests in under 7 hours. | 20 PRs in 6h 59m |
| 1 | Torque | And zero reviews. Not one approval. | 0 of 20 approving reviews |
| 2 | Servo | Pull request number one was the iPhone app. 23,000 lines! | #1 +23,055 |
| 3 | Torque | Six of them merged with a red check. | #10 #15 #16 #17 #18 #20 |
| 4 | Servo | Four container builds, two Rust. The app's checks? Green every time they ran. | container ✗4, rust ✗2, mobile ✓16/16 |
| 5 | Torque | Okay. And the bug where two videos played at once? | BUG card |
| 6 | Servo | Fixed in 12 lines. | #11 diff, +12 −6 |
| 7 | Torque | Heh. Fine. That's actually clean. | (diff holds) |
| 8 | Servo | Clankercast. Stay tardy. | wordmark |

## Limits pushed

1. **Generated set, live faces:** one $0.17 still becomes a multi-camera podcast with talking LED faces.
2. **Real two-voice mix:** two Chatterbox voices, each driving its own host's mouth.
3. **The gameplay is the data:** every ramp gate is a real PR in merge order with its real CI color.
4. **Seamless loop:** 10 laps in 30 s; the HUD before the first gate shows the last PR of the loop.

## Spend (agentcash, approved cap $2.00)

Studio image $0.17 · 11 upload slots $0.055 · 11 voice lines $0.22 = **$0.445**.
Two lines were redone: "PR one" read as "the R1"; Chatterbox spoke "[chuckle]" as a word. The
rejected takes are in `source/rejected/`.

## Sound

Bed: brag's "Happy Beats / Business Moves" Vol. 10 by Sascha Ende (CC BY 4.0), ducked to 0.13.
Landing thud on each of the 10 jumps. Baked at -16.5 LUFS, -1.8 dBTP.
