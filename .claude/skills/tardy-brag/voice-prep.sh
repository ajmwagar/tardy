#!/usr/bin/env bash
# Turn raw voice clips into everything a tardy reel composition needs, in one pass.
#
# Usage: voice-prep.sh <raw-dir> <composition-dir> [gap-seconds] [lead-in-seconds]
#   <raw-dir>  holds raw-NN-<speaker>.wav, one per line, NN = line order (00, 01, ...).
#   Writes into <composition-dir>:
#     assets/vo/NN-<speaker>.wav     silence-trimmed, 24 kHz mono
#     data/NN-<speaker>.words.json   word timings (hyperframes transcribe / whisper)
#     data/voice.js                  window.VOICE = [{id, who, start, dur, words, rms}], rms per 1/30 s
#   and prints the line table (id, start, dur, transcript) so the script can be checked by eye.
# Lines play back to back with <gap> seconds between them (default 0.25), first at <lead-in> (0.3).
set -euo pipefail

raw=${1:?usage: voice-prep.sh <raw-dir> <composition-dir> [gap] [lead-in]}
comp=${2:?usage: voice-prep.sh <raw-dir> <composition-dir> [gap] [lead-in]}
gap=${3:-0.25}
t=${4:-0.3}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$comp/assets/vo" "$comp/data"

shopt -s nullglob
clips=("$raw"/raw-*.wav)
((${#clips[@]})) || { echo "no raw-*.wav in $raw" >&2; exit 1; }

entries=()
for f in "${clips[@]}"; do
  id=$(basename "$f" .wav); id=${id#raw-}
  who=${id#*-}
  out="$comp/assets/vo/$id.wav"
  # Trim leading/trailing silence; a 10 ms fade-in keeps the first sample from clicking.
  ffmpeg -v error -y -i "$f" -af "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.03,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08,areverse,afade=t=in:d=0.01" -ac 1 -ar 24000 "$out"
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$out")

  rm -f "$work/transcript.json"
  npx --yes hyperframes transcribe "$out" --json -d "$work" </dev/null >/dev/null
  cp "$work/transcript.json" "$comp/data/$id.words.json"

  rms=$(ffmpeg -v error -i "$out" -af "asetnsamples=n=800:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-" -f null - |
    awk -F= '/RMS_level/ {v=$2; if (v=="-inf") v=-90; printf "%s%.1f", (n++?",":""), v}')

  printf '%s  start=%6.2f  dur=%5.2f  %s\n' "$id" "$t" "$dur" "$(jq -r 'map(.text)|join(" ")' "$comp/data/$id.words.json")"
  entries+=("{\"id\":\"$id\",\"who\":\"$who\",\"start\":$t,\"dur\":$(printf '%.2f' "$dur"),\"words\":$(jq -c 'map([.text,.start,.end])' "$comp/data/$id.words.json"),\"rms\":[$rms]}")
  t=$(awk -v a="$t" -v b="$dur" -v g="$gap" 'BEGIN { printf "%.2f", a + b + g }')
done

{ printf 'window.VOICE = [\n'; printf '  %s,\n' "${entries[@]}"; printf '];\n'; } >"$comp/data/voice.js"
echo "voice ends at $(awk -v a="$t" -v g="$gap" 'BEGIN { printf "%.2f", a - g }')s -> $comp/data/voice.js"

# HyperFrames reads <audio> timing from static attributes, so write the voice tags into index.html
# between <!-- VOICE:BEGIN --> and <!-- VOICE:END --> when the markers are there.
html="$comp/index.html"
if grep -q '<!-- VOICE:BEGIN -->' "$html" 2>/dev/null; then
  tags="$work/tags.html"
  jq -r '.[] | "      <audio id=\"vo-\(.id)\" src=\"assets/vo/\(.id).wav\" data-start=\"\(.start)\" data-duration=\"\(.dur)\" data-track-index=\"\(if (.id | test("^[0-9]*[02468]-")) then 11 else 12 end)\" data-volume=\"1\"></audio>"' \
    <(sed -e '1s/^window.VOICE = //' -e '$s/;$//' "$comp/data/voice.js" | sed -e 's/},$/},/' | tr -d '\n' | sed -e 's/,]/]/') >"$tags"
  awk -v tags="$tags" '
    /<!-- VOICE:BEGIN -->/ { print; while ((getline line < tags) > 0) print line; skip = 1; next }
    /<!-- VOICE:END -->/ { skip = 0 }
    !skip' "$html" >"$work/index.html" && mv "$work/index.html" "$html"
  echo "voice <audio> tags written into $html"
fi
