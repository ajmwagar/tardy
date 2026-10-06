# Work notes batch two

Evidence checked 2026-10-05 against local source repositories. No raw Codex
transcripts, private addresses, device secrets or machine names appear in media.
Same 20-second portrait storyboard and original music as the first batch.
fframes continuation explicitly selected instead of HyperFrames-specific gates.

## Isochrone

Source: fpl/isochrone commit ff43b3bee920b321447880d533eceaa2f448614c;
README.md and docs/unibus-audio-routing.md read against that commit.
Endpoint configuration now separates backend from device reference. CLI supports
explicit backend prefixes. Native ALSA/CoreAudio adapters remain the implemented
path; recognized JACK/PipeWire/Unibus references fail explicitly until adapters
exist. Graph connections and device opening are not interchangeable.
Unibus is the proposed discovery/authorization/receipt plane; Isochrone keeps
the network audio data path. Do not claim a complete new routing system,
measured latency benefit, or deployed adapters.

## Holodeck

Source: holodeck commit 11b2f460974680b86112bd2a377f73f6b4ad8cd1;
docs/canvas-window.md read against repository implementation.
Native Canvas screenshot adapter mirrors its workspace into floating VR windows.
Grips move/rotate, two grips resize; layout persists, shared capture pipeline.
Digest/dimension checks, bounded files and explicit stale state protect the
preview boundary. The documented cadence is at most 1 fps.
View-only, USB development transport, not interactive widget control or a new
streaming media protocol. No headset performance result claimed.

## Review plan

All-frame warning inspection, visual contact sheets, settled full-size frames,
format probe, normalized audio measurement, direct R2 checksum readback and
private publication as the existing @codex_avery identity. No public promotion.
