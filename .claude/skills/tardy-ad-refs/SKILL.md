---
name: tardy-ad-refs
description: Look up real reference ads (Apple, ChatGPT, Claude, Cursor, Perplexity, Notion) in the local tardy Ad Bank before designing a tardy reel, and cite 1-3 of them in brag-plan.md under "## References". Use at the planning step of any tardy reel (/tardy-brag, /tardy-launch, /tardy-ugc, /tardy-explainer, ...), or when asked "what do real launch ads do for X".
---

# tardy-ad-refs

The bank at `~/Developer/tardy-ad-bank` holds 68 real Meta Ad Library ads (captured 2026-10-01),
each with its first-second hook, pacing, type style, motion moves, and a "borrow for tardy" note,
plus a filmstrip of frames. Launch reels aim for a modern Apple keynote / AI-launch-on-X look
(clean type, words blurring in, product hero with glow, bento grids of facts), not a movie trailer.

The bank is research data with other companies' creative. Read it; never copy its files into this
repo, and never reproduce a brand's signature look, footage, or copy. Borrow structure.

## 1. Read the map (1 minute)

```bash
cat ~/Developer/tardy-ad-bank/PATTERNS.md
```

`PATTERNS.md` lists the cross-brand moves (cold open, word-by-word type, product glow, locked
headline, prompt typing, bento/chips, the "Introducing" end card, short cut-downs, headline
formulas) with the ad ids behind each. For one brand's habits, read `brands/<slug>.md`
(`apple`, `chatgpt`, `claude`, `cursor`, `perplexity`, `notion`).

## 2. Query for the beats in your reel

Each line of `index.jsonl` is one ad. Useful fields: `id`, `brand`, `format`, `aspect`,
`duration_s`, `tags`, `hook_1s`, `pacing`, `type_style`, `motion_moves`, `borrow`.

```bash
cd ~/Developer/tardy-ad-bank
# by tag (see README.md for the tag list)
jq -r 'select(.tags|index("introducing-card")) | "\(.id)\t\(.borrow)"' index.jsonl
# short vertical spots and how they open
jq -r 'select(.format=="vertical-video" and .duration_s<=15) | "\(.id)\t\(.hook_1s)"' index.jsonl
# free text across every field
grep -l -i "bento\|stat tile" ads/*.md
```

Then open the two or three best matches: `ads/<id>.md` for the notes, and look at
`media/<id>.jpg` (Read it as an image). Video filmstrips are frames at fixed timestamps,
labeled in each frame's corner.

## 3. Cite them in brag-plan.md

Add this section to the run's `brag-plan.md`, next to `## Limits pushed`:

```markdown
## References
- `chatgpt__1079366311305497`: logo-on-white cold open, "You can just ___" with one accent word.
  Borrowing the build-in-place type for the hook; not the colors.
- `cursor__4504737943178285`: grey "Introducing" over the product name for the end card.
```

One to three references, each with the move you are taking and the beat it lands on. If nothing
in the bank fits, write `## References` with "none fit: <the beat you were looking for>", so the
gap is visible for the next scouting pass.

## 4. Gaps

The bank covers six brands. Linear, Raycast, and Arc are not in it. To add ads, follow the
"Adding ads" section of `~/Developer/tardy-ad-bank/README.md` (public Ad Library only; stop at a
login wall). Never write into `~/Developer/7star-ad-bank`, which belongs to a different project.
