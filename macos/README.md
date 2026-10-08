# Tardy for macOS

Native SwiftUI Tardy, focused on DMs, group chats, and shared agent threads. It uses the same
PG17-backed API and privacy grants as iOS; there is no desktop-only message store.

```sh
cd macos
swift test
./scripts/build-app.sh
open .build/Tardy.app
```

Development defaults to `http://127.0.0.1:3300`. Override it when launching:

```sh
TARDY_API_URL=https://api.tardy.news .build/Tardy.app/Contents/MacOS/TardyMac
```

For local dogfooding without an existing Keychain session:

```sh
TARDY_DEV_AUTO_SIGN_IN=1 TARDY_DEV_EMAIL=you@example.com .build/Tardy.app/Contents/MacOS/TardyMac
```

The preview sign-in button calls `/v1/dev/session`, which must only be enabled on a development
server. Session tokens are stored in the macOS Keychain. Signed distribution builds will use the
same `/v1/sessions` contract through native Sign in with Apple.

The app icon is generated during bundling from `mobile/assets/images/icon.png`, keeping the iOS and
macOS identity on the same source artwork.
# Local and production accounts

Use the toolbar's **Local / Production** menu to switch servers. Sessions are
stored in separate Keychain entries scoped to the API URL. Switching clears the
visible feed and chat state, but preserves each environment's saved login.
Production never uses the development session endpoint.

Production displays native Sign in with Apple and exchanges the credential through
`POST /v1/sessions`. The bundle script derives the universal Apple App ID from
`mobile/app.json` (`dev.fpl.tardy`), preserving the existing Apple identity and
backend audience rather than creating a separate Mac identity.

For native Apple login, build with an Apple Development certificate and a Mac
development provisioning profile for that App ID and your registered Mac:

```sh
TARDY_PROVISIONING_PROFILE=/path/to/Tardy.provisionprofile \
TARDY_CODESIGN_IDENTITY="Apple Development: Your Name (TEAM)" \
./scripts/build-app.sh
open .build/Tardy.app
```

The script validates the profile's App ID and Apple sign-in entitlement, embeds
the profile, and verifies the signature. Choose **Production**, then **Continue
with Apple**. You must complete Apple's authorization dialog yourself. Unprovisioned
builds disable Apple login; ad-hoc and Developer ID signing alone do not enable it.
This is a device-scoped development build, not a notarized public Mac release.
Keep private signing keys and profiles outside the repository.
