# Educational artifact v1

An educational Tardy is a bundle, not merely a video. `tardy.educational-artifact.v1` identifies
five independently replaceable parts:

1. A sourced long-form overview suitable for the post caption.
2. A visual scene artifact. Manim may render mathematical source; HyperFrames composes the final
   9:16 reel and owns timing, captions, narration, sound, branding, and safe zones.
3. An optional deterministic lab or calculator manifest with explicit inputs and outputs.
4. Tutor context containing learning objectives and bounded source material.
5. Mastery checks and private learner attempts. Misconception state is private and never copied
   into a public post.

Renderers communicate through versioned request/result manifests. The first implemented request is
`tardy.manim-render.v1`; its Rust type in `tardy-agent-host` is the source of truth. A request pins
the renderer, points to workspace-confined scene source, names the scene, bounds dimensions, FPS,
and duration, and records citations. The result is a content-addressed typed media attachment; the
validated request is attached beside it so source and citation provenance survive the render host.

Manim is an invoked third-party renderer. It does not own workflow control, storage, publishing,
or lesson decisions. A human runbook is: author the scene and JSON request, run the pinned Manim
command, inspect the MP4, compose it through HyperFrames, attach the sourced caption and checks,
then publish privately before promotion.
