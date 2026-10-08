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
native_identifier="$(plutil -extract expo.ios.bundleIdentifier raw -o - ../mobile/app.json)"
test -n "$native_identifier"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $native_identifier" "$contents/Info.plist"

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
signing_identity="${TARDY_CODESIGN_IDENTITY:-}"
profile="${TARDY_PROVISIONING_PROFILE:-}"
entitlements=".build/Tardy.entitlements.plist"
if [ -n "$profile" ]; then
    test -f "$profile"
    security cms -D -i "$profile" -o .build/Tardy.profile.plist
    plutil -extract Entitlements xml1 -o "$entitlements" .build/Tardy.profile.plist
    profile_identifier="$(/usr/libexec/PlistBuddy -c 'Print :com.apple.application-identifier' "$entitlements")"
    team="$(/usr/libexec/PlistBuddy -c 'Print :TeamIdentifier:0' .build/Tardy.profile.plist)"
    test "$profile_identifier" = "$team.$native_identifier"
    test "$(/usr/libexec/PlistBuddy -c 'Print :com.apple.developer.applesignin:0' "$entitlements")" = "Default"
    cp "$profile" "$contents/embedded.provisionprofile"
    /usr/libexec/PlistBuddy -c 'Set :TardyAppleSignInConfigured true' "$contents/Info.plist"
fi
if [ -z "$signing_identity" ]; then
    if [ -n "$profile" ]; then
        signing_identity="$(security find-identity -v -p codesigning 2>/dev/null | awk '/\"Apple Development:/ { print $2; exit }')"
        test -n "$signing_identity"
    else
        signing_identity="$(security find-identity -v -p codesigning 2>/dev/null | awk '/\"Developer ID Application:|\"Apple Development:/ { print $2; exit }')"
    fi
fi
if [ -n "$signing_identity" ]; then
    if [ -n "$profile" ]; then
        codesign --force --sign "$signing_identity" --identifier "$native_identifier" --entitlements "$entitlements" --timestamp=none "$app_dir"
    else
        # A previous provisioned build must not leave stale entitlements/profile behind.
        if [ -f "$contents/embedded.provisionprofile" ]; then rm "$contents/embedded.provisionprofile"; fi
        codesign --force --sign "$signing_identity" --identifier "$native_identifier" --timestamp=none "$app_dir"
    fi
else
    echo "warning: no stable code-signing identity found; Keychain may prompt after rebuilds" >&2
    test -z "$profile"
    if [ -f "$contents/embedded.provisionprofile" ]; then rm "$contents/embedded.provisionprofile"; fi
    codesign --force --sign - --identifier "$native_identifier" --timestamp=none "$app_dir"
fi
codesign --verify --strict "$app_dir"
lsregister="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
if [ -x "$lsregister" ]; then
    "$lsregister" -f "$app_dir"
fi
printf '%s\n' "$PWD/$app_dir"
