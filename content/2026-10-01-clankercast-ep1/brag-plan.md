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
| 2 | Servo | Pull request number one was the whole tardy iPhone app. 23,000 lines! | #1 +23,055 |
| 3 | Torque | Six of them merged with a red check. | #10 #15 #16 #17 #18 #20 |
| 4 | Servo | Four container builds, two Rust. The app's checks? Green every time they ran. | container ✗4, rust ✗2, mobile ✓16/16 |
| 5 | Torque | Okay. And the bug where two videos played at once? | BUG card |
| 6 | Servo | Fixed in 12 lines. | #11 diff, +12 −6 |
| 7 | Torque | Heh. Fine. Still zero reviews, though. | 0 approving reviews (callback) |
| 8 | Servo | That's what we're for! Your agents' updates, as reels. Stay tardy. | the app's real podcast reel in a phone + wordmark |

## Limits pushed

1. **Generated set, live faces:** one $0.17 still becomes a multi-camera podcast with talking LED faces.
2. **Real two-voice mix:** two Chatterbox voices, each driving its own host's mouth.
3. **The gameplay is the data:** every ramp gate is a real PR in merge order with its real CI color.
4. **Seamless loop:** 10 laps in 30 s; the HUD before the first gate shows the last PR of the loop.

## Spend (agentcash, approved cap $2.00)

Studio image $0.17 · 14 upload slots $0.07 · 14 voice lines $0.28 = **$0.52**.
Two lines were redone: "PR one" read as "the R1"; Chatterbox spoke "[chuckle]" as a word. The
rejected takes are in `source/rejected/`.

## Sound

Bed: brag's "Happy Beats / Business Moves" Vol. 10 by Sascha Ende (CC BY 4.0), ducked to 0.13.
Landing thud on each of the 10 jumps. Baked at -16.5 LUFS, -1.8 dBTP.

## Revision 1 (after grade: revise, 65.0)

- Message: line 2 names "the whole tardy iPhone app"; Torque calls back "still zero reviews";
  Servo's answer is the joke and the pitch ("That's what we're for! Your agents' updates, as reels").
- Proof: the app's real bundled podcast reel plays in a phone at the end; the #11 diff is larger.
- Craft: gates are low banners that pass under the cards; the HUD drops PR numbers (merge count + time).
- Sound: bed fades in over 0.15 s (no frame-0 hit); baked to -15.1 LUFS / -1.8 dBTP.
- voice-prep.sh now writes the voice <audio> tags itself between VOICE markers.

## Grades

- Round 1 (first cut): revise, 65.0. Scorecard file was overwritten by round 2; weakest were
  message 2, proof 2, craft 2.
- Round 2 (revision 1): revise, 65.0, `scorecard.json`. All gates pass. Weakest: proof 2 (phone too
  small, diff only ~2 s), type_fit 2 (karaoke up to ~0.9 s late on lines 05 and 07: whisper word
  timings drift on Chatterbox audio), craft 2 ("reels." reaches x≈936 at y≈1170, ramp collapses to
  a grey wedge at 23.6 s). Two-round cap reached; next step is the user's call.

## Revision 2 (after grade: revise, 65.0)

- Proof: a real iOS-simulator recording of the Reels tab (`source/app-reels.mov`) plays in a large
  phone when Servo says "the whole tardy iPhone app" (7.6–10.4 s) and again at the end.
- Captions: word timing now comes from `align.js` (speech bursts from each clip's loudness, script
  phrases mapped onto them, whisper only where it fits), fixing the late highlights on lines 05/07.
- The end card stays left of x=880; the merge counter hides while a phone is up.
- Round 3 (revision 2): revise, 68.75, `scorecard.json`. All gates pass. Weakest: type_fit 2 (line 08 captions up to ~0.37 s off), craft 2 (phone runs into the bottom chrome zone; HUD jumps 20/20 to 1/20 at the loop).
