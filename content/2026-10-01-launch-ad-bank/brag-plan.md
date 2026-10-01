# /brag plan: tardy-ad-refs launch, keynote style

Run via `/tardy-launch` → `/tardy-brag`, composed directly in HyperFrames (`--full` path: `composition/`
exists). Tone: **keynote / AI launch on X**, by the user's direction, overriding tardy-launch's default
trailer tone. No voice: on-screen type carries everything (mute-safe).

## Inspect

- **What it is:** a bank of 96 real ads (10 brands) distilled into 8 patterns, plus `/tardy-ad-refs`, the
  skill that makes reel sessions look them up first.
- **Most impressive claim:** 96 ads → 8 patterns → a skill (`facts.md` 1, 6, 8).
- **Visual hook:** a single point of Tardy-yellow light on black at frame 0, "96 real ads." blurring in by 0.6s.
- **Real thing shown:** the real tardy app (feed → Reels → Breaking reel), recorded from the simulator.
- **The joke:** the reel is built from its own playbook, and says so: every beat wears a chip naming the
  PATTERNS.md pattern it uses.

## References

- `google__2891189821229289`: one point of light on black that stretches into a line and becomes the product's
  glowing edge. Borrowed for the cold open and the phone reveal, in Tardy yellow; not their colors or shapes.
- `chatgpt__1079366311305497`: the sentence builds in place with one accent-colored word. Borrowed for
  "Tagged. Filmstripped. **Distilled.**"
- `cursor__4504737943178285`: grey "Introducing" over the product name for the end card.

## Patterns used (PATTERNS.md numbering)

| Beat | Time | Pattern |
|---|---|---|
| Cold open | 0.00–2.65 | 01 cold open (one thing, light) |
| Build | 2.65–5.80 | 02 word-by-word, one accent word |
| Bento | 5.80–10.01 | 06 bento of real numbers |
| Prompt | 10.01–13.70 | 05 real prompt typing |
| Reveal | 13.70–18.96 | 03 product hero with glow + 04 locked headline |
| End card | 18.96–22.60 | 07 the "Introducing" card |

Pattern 08 (short cut-downs) is not used: 7 of 8.

## Storyboard (22.6s, 1080×1920, 30fps; cuts on vol-11's beat grid, 114.84 BPM, beat 1.60 + 0.5225k)

| Time | On screen |
|---|---|
| 0.00 | Black. A yellow point of light at center. Chip `01 · cold open`. |
| 0.15–0.60 | "96" / "real" / "ads." blur in, word by word (hook by 0.5s). The point stretches into a horizontal line under the words. |
| 2.65 / 3.18 / 3.70 | "Tagged." "Filmstripped." "**Distilled.**" (yellow) build in place on the beat. Chip `02 · word-by-word`. |
| 5.80–8.44 | Bento tiles land on six beats: 96 real ads · 10 brands · 71 videos, filmstripped · 8 patterns worth stealing · a procedural filmstrip tile · `/tardy-ad-refs`, new skill, cites 1–3 refs per reel. Chip `06 · bento`. |
| 10.01–11.60 | Macro, tilted prompt box with a yellow halo; `/tardy-ad-refs launch` types itself, keypress per character. Chip `05 · real prompt`. |
| 12.12 / 12.65 / 13.18 | Results drop in: `01 cold open` · `03 product hero with glow` · `07 the "Introducing" card`. |
| 13.70–18.96 | The line returns and becomes the glowing edge of a phone; the real app plays inside. Locked headline above: "References first." / "Reel second." (grey). Chips `03 · glow` + `04 · locked headline`. |
| 18.96 | Grey "Introducing" over "/tardy-ad-refs". Chip `07 · introducing`. |
| 20.02 | "Built from its own playbook: 7 of 8 patterns." |
| 20.54 | `tardy` wordmark with the red dot; sign-off "Real followers, real friends. Stay Tardy." |
| 22.00–22.60 | Fade to black; the yellow point returns to center: last frame matches frame 0 (loop). |

## Layout

Readable content stays in y 236–1420; below y=1000 nothing readable past x=890 (the action rail).
Pattern chips sit top-left at y≈250.

## Limits pushed

1. **Study real ads first:** three references cited above; the whole reel is the playbook made visible.
2. **Real motion from the app:** a simulator recording, not screenshots, inside the hero device.
3. **Beat sync:** every beat change lands on vol-11's beat grid (from brag's bundled cue preset).
4. **A loop:** the final frame returns to frame 0's yellow point on black.

## Sound

brag's `happy-beats-business-moves-vol-11` (114.84 BPM) as the bed. A soft bong as the light appears,
keypresses under the typing, a select blip per bento tile and per search result, a bell on "Introducing".
Music license: CC BY 4.0, Sascha Ende.
