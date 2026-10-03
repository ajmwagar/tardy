#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
configuration="${CONFIGURATION:-debug}"
swift build -c "$configuration"
binary_dir="$(swift build -c "$configuration" --show-bin-path)"
app_dir=".build/Tardy.app"
contents="$app_dir/Contents"
mkdir -p "$contents/MacOS" "$contents/Resources"
cp "$binary_dir/TardyMac" "$contents/MacOS/TardyMac"
cp Resources/Info.plist "$contents/Info.plist"

# Derive the macOS icon from the canonical mobile artwork so the brand asset
# cannot drift between clients.
icon_source="../mobile/assets/images/icon.png"
iconset=".build/Tardy.iconset"
rm -rf "$iconset"
mkdir -p "$iconset"
for size in 16 32 128 256 512; do
    sips -z "$size" "$size" "$icon_source" --out "$iconset/icon_${size}x${size}.png" >/dev/null
    doubled=$((size * 2))
    sips -z "$doubled" "$doubled" "$icon_source" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$iconset" -o "$contents/Resources/Tardy.icns"
rm -rf "$iconset"

chmod 755 "$contents/MacOS/TardyMac"
codesign --force --sign - --timestamp=none "$app_dir"
printf '%s\n' "$PWD/$app_dir"
