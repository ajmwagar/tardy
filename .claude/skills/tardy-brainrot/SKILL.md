---
name: tardy-brainrot
description: Make a tardy Brainrot reel, a split-screen recap (gameplay on the bottom, two cartoon hosts summarizing your sprint on top) for a busy stretch of work, from a commit range, a week of PRs, or a set of marbles. Use for sprint recaps, "what happened this week", and many small updates at once.
---

# tardy Brainrot

Read `/tardy-brag` first; it owns facts, the run directory, brand, safety, and grading. This file
is only what differs for brainrot.

## brag options

```
/brag --full --format vertical --tone chaotic --voice "split-screen brainrot recap: two cartoon hosts rapid-fire summarizing a sprint over gameplay"
```

Duration **20–35s** (`check.sh <run> 20 35`). Past brag's cap because it's a list; each item gets
2–4s. 6–10 items from `facts.md`, nothing padded.

## Layout

- **Top half:** two cartoon hosts in the classic brainrot setup (a clueless big guy and a scheming
  small one bickering over the recap), drawn fresh in flat tardy-palette style, with their own names
  and Kokoro voices. Karaoke captions between them. The setup is the genre; the character designs
  and voices are ours.
- **Bottom half:** gameplay that looks like the real thing at a glance, **generated in the
  composition** (HTML/canvas/three.js): a three-lane runner over train roofs, a first-person block
  parkour course, or a third-person city driving loop. Genre-accurate camera, speed, and HUD; our own
  character, world art, and no game's name or logo.
  The world is themed on the repo: jump over commit hashes, dodge red CI blocks, collect PR coins.
- Divider in Tardy yellow.

## Push it

- **The gameplay is the data.** Each obstacle or pickup is a real item from `facts.md`: a merged PR
  is a coin, a revert is a crash, a blocked marble is a wall. The run *is* the sprint.
- **Counter HUD** in the gameplay corner: PRs merged, tests added, computed from git and listed in
  `facts.md`.
- Item transitions on the beat grid (`npx hyperframes beats`), hosts alternate per item.
- **Seamless loop:** the runner's last frame matches its first.

## Grade on (type criteria for the rubric)

- Every item is a real, sourced event; a viewer could reconstruct the sprint from the captions.
- Reads as brainrot in one glance; nothing is lifted from a specific game or show (none of its
  characters, art, names, logos, or voices).
- Readable at speed: each item's caption holds at least 0.3s per word.
