# Tardy Session Reel

A 1080x1920 @ 30 fps video made with [fframes](https://github.com/dmtrKovalenko/fframes),
rendered with the Skia (Metal) backend.

This 33-second reel explains the local `feat/codex-session-connect` milestone. It is an
illustrative animation, not a recording of a deployed app. Claims and rollout boundaries
live in `../facts.md`; the complete production caption is `../share-copy.txt`.

The shared `tardy-reel-library` selects the walkthrough format and project theme using
seed 42. The original ambient bed and DM Sans font are embedded for reproducible renders.

| file | what |
| --- | --- |
| `src/lib.rs` | the video: scenes, animation, audio map |
| `src/main.rs` | the command line (`fframes::cli`) |
| `media/` | fonts, images and audio embedded into the binary |
| `tests/frames.rs` | frame snapshots and a check of every frame for problems |

## Work on it

```sh
cargo run --release -- timeline                      # scenes, duration, audio tracks
cargo run --release -- frame 1s,50%,end              # PNGs into frames/ and the problems found in them
cargo run --release -- strip 0..2s -n 8        # contact sheet, writes strip.png
cargo run --release -- onion "0..1.5s"  # motion trail of an entrance, writes onion.png
cargo run --release -- inspect                       # missing media/fonts, clipped text, panics in any frame
cargo run --release -- render 0..2s --draft    # a part of the video, half resolution, fast preset
cargo run --release -- audio analyze --waveform w.png  # loudness (LUFS), peaks, silence per scene
cargo run --release -- render                        # the final video, writes out.mp4
cargo run --release -- preview                       # real-time GPU window with sound (space, h/l, j/k, q)
cargo test --release --locked         # all five scene snapshots + every-frame diagnostics
```

Times accept frames (`120`), seconds (`3.2s`), `m:ss`, percentages (`50%`), scenes (`DataScene`,
`#1`) and offsets inside scenes (`DataScene@1.5s`, `@50%`, `@end`). Add `--json` to any
command for machine-readable output.

For this reel, render with `render -o ../brag.mp4`. Review the strip and full-size settled
frames before extracting `../brag.jpg` from the encoded video. Measure the final encoded
audio and dimensions, not just the source composition. `../job.json` records creative
intent; the resumable upload CLI owns `../publish.json` and its stable request identity.
