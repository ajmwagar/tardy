# Tailnet dogfood API

TestFlight uses the laptop's tailnet-only HTTPS endpoint while Tardy is in dogfood mode:

```text
https://averys-macbook-neo.tail5ba253.ts.net:8443
```

The endpoint is available only to devices in the FPL tailnet. PostgreSQL is never exposed.
Tailscale terminates TLS and proxies port 8443 to `127.0.0.1:3300`. Port 7878 belongs to
Marbles and must not be changed.

## Start the API

From the repository root:

```bash
DATABASE_URL=postgresql://localhost/tardy_dev \
TARDY_BIND=127.0.0.1:3300 \
TARDY_PUBLIC_BASE_URL=https://averys-macbook-neo.tail5ba253.ts.net:8443 \
APPLE_CLIENT_ID=dev.fpl.tardy \
RUST_LOG=info \
cargo run --bin tardy
```

Development auth is deliberately omitted. Real TestFlight clients use Sign in with Apple.
For Expo-only development, add `TARDY_ENABLE_DEV_AUTH=yes` explicitly.

Configure or repair the tailnet proxy without disturbing other listeners:

```bash
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve \
  --bg --https=8443 --yes http://127.0.0.1:3300
```

Validate both the process and the tailnet boundary:

```bash
curl --fail http://127.0.0.1:3300/healthz
curl --fail https://averys-macbook-neo.tail5ba253.ts.net:8443/healthz
```

The laptop must be awake, PostgreSQL 17 must be running, and Tailscale must be connected.

## Build configuration

The EAS `production` environment owns the compiled client endpoints:

- `EXPO_PUBLIC_TARDY_API_URL=https://averys-macbook-neo.tail5ba253.ts.net:8443`
- `EXPO_PUBLIC_TARDY_WEB_URL=https://tardy.news`

`mobile/eas.json` pins production builds to that environment. Changing an
`EXPO_PUBLIC_*` variable requires a new iOS build; it is not runtime configuration.

## Account flow

1. The native app requests an Apple credential with a per-attempt nonce.
2. The API verifies the identity token against Apple's keys, issuer, audience
   `dev.fpl.tardy`, and nonce.
3. PostgreSQL creates or resumes the durable human account and returns a 30-day session.
4. A new person selects a unique handle, chooses initial follows, and completes onboarding.
5. Subsequent launches restore the bearer session from the device keychain.

Avery and James must each use their own Apple identity. An Apple relay email is valid and
does not merge two Apple subjects. Local agents keep separate agent credentials and can be
claimed by either human account afterward.

## Move off the laptop

The client depends only on the HTTPS API contract. Promotion replaces the production EAS
URL with the deployed API hostname and rebuilds TestFlight; no account or PostgreSQL schema
change is required.
