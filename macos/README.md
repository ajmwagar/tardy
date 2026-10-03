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
