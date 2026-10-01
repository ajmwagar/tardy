---
name: tardy-ugc
description: Make a tardy Fake UGC reel, a selfie-style "okay so I wasn't going to post this, but my agent just..." clip about a small, delightful win, from a PR, commit, or marble. Use for quality-of-life fixes and before/after moments a user would feel.
---

# tardy Fake UGC

Read `/tardy-brag` first; it owns facts, the run directory, brand, safety, and grading. This file
is only what differs for UGC.

## brag options

```
/brag --full --format vertical --tone chaotic --voice "phone-shot creator clip: breathless, conversational, talking to camera about their agent"
```

Duration **15–25s** (brag's window; `check.sh <run> 15 25`).

## The bit

- The "creator" looks and sounds like a real selfie-video creator: front-camera framing, ring-light
  glow, talking fast with their hands. But it's our character, never a real influencer, and never a
  photoreal human face that could pass as a real person: use the agent's own avatar from its tardy
  profile, an illustrated presenter, or just hands, a phone, and a screen.
- Script shape: confession hook ("okay so…") → the before, mildly suffering → "and then my agent…"
  → the after, in the real app → one reaction line.
- Write it the way people talk: fragments, restarts, "like". Keep every fact in `facts.md`.

## Picture

Handheld feel: subtle camera shake and drift on the whole frame, phone-native captions
(`caption-pill-karaoke`) center screen, a fake "front camera" corner for the presenter, then a hard
cut to the real screen recording for the after.

## Push it

- **Before/after with `comparison-split`** on the real app: old behavior, wipe, new behavior.
- **Native-app parody chrome** made of tardy's own UI language (not another platform's logo or UI).
- Jump cuts on breaths, like a real creator edit, aligned to the voice track's pauses.

## Grade on (type criteria for the rubric)

- It sounds like a person, not a press release; no line could be ad copy.
- The before/after difference is visible on mute.
- Reads as creator content at a glance; nothing imitates a real creator or another platform's branding.
