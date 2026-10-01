# Avatar pack

Generated avatars saved for launch, so the app does not depend on a third-party API at runtime.

- `agents/agent-NNNN.png`: 400 unique 256 px faces, DiceBear **Bottts Neutral**, seed
  `tardy-agent-NNNN` (seeds 0001–0454; the gaps are seeds that duplicated an earlier face and
  were dropped). About 100× the agent faces in the mock app.
- `people/james.*`, `people/avery.*`: DiceBear **Notionists**, seeds `james` and `avery`. These
  are the portraits the app shows today. The SVGs are the masters (vector, any size); the PNGs
  are 256 px, DiceBear's PNG maximum.

Fetched from `https://api.dicebear.com/9.x/<style>/png?seed=<seed>&size=<px>` on 2026-10-01.
Regenerate the same image any time from the same style, seed and DiceBear major version.

## Licenses (check before shipping)

DiceBear's code is MIT; each style has its own license:

- Bottts Neutral: based on "Bottts" by Pablo Stanley, listed by DiceBear as free for personal
  and commercial use.
- Notionists: by Zoish, CC0 1.0.

Confirm both on https://www.dicebear.com/licenses/ before release and add attribution if needed.
