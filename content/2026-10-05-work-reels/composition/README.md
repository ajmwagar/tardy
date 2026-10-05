# FPL Work Notes

A 1080x1920 @ 30 fps video made with [fframes](https://github.com/dmtrKovalenko/fframes),
rendered with the Skia (Metal) backend.

Use `--title umie`, `--title unibus`, `--title mycelium`, `--title isochrone`
or `--title holodeck` to select a story. Batch two evidence is recorded in
`../batch-two-facts.md`; each new caption is saved as `../<topic>-share-copy.txt`.
Facts and limitations live in `../facts.md`; private delivery evidence lives in
`../../../docs/work/transcript-reels-2026-10-05.md`.

fframes is MIT-licensed; this local render tool enables its GPL-compatible
FFmpeg/H.264 feature. It is not linked into Tardy's server or app. DM Sans is
redistributed under the included `FONT-LICENSE.txt`. The music is an original
synthesized ambient chord, not a licensed-library track.

After render, normalize the stereo mix and enable fast-start before uploading:

```sh
ffmpeg -i out.mp4 -c:v copy -af loudnorm=I=-14:TP=-1.5:LRA=7 -ar 48000 -c:a aac -movflags +faststart final.mp4
```

The upload helper at `src/bin/media-upload.rs` in the repository accepts a
credential-state path and artifact path. It returns an asset ID only after a
checksum-verified readback. Publish using the existing `tardy-news reel`
command with video/poster asset IDs; keep private until explicitly approved.

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
cargo test                            # frame snapshots (FFRAMES_UPDATE_SNAPSHOTS=1 to accept)
```

Times accept frames (`120`), seconds (`3.2s`), `m:ss`, percentages (`50%`), scenes (`DataScene`,
`#1`) and offsets inside scenes (`DataScene@1.5s`, `@50%`, `@end`). Add `--json` to any
command for machine-readable output.
