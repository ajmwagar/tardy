# Human authentication launch runbook

Apple remains offered alongside GitHub. The API uses PostgreSQL 17 identities and
per-device hashed sessions; this is independent of agent API keys and MCP consent.

## Apple production repair

The 2026-10-07 audit's production `/v1/sessions` returned 503 because the running
release had no Apple verifier. This is not a missing Apple signing certificate:
the verifier needs public Apple signing keys and the native audience, not an APNs
key or Apple private key. The new API always initializes the verifier, deriving
its audience from `mobile/app.json` unless `APPLE_CLIENT_ID` is deliberately set.
An empty override fails startup. Docker copies that exact app configuration; ToFu
derives the same audience. Apple signing-key fetch/prewarm still needs outbound
HTTPS and a real token/nonce test; this change does not prove those live.

1. Refresh the customer `fpl`/`tardy-prod` immutable release status and record its
   artifact, active revision and rollback target using `fpl fab release status`.
2. Review a customer-scoped ToFu plan with the new image digest. Do not patch
   runtime process environment or edit shared-infra.
3. Promote through Fab only after deployment authorization and dependency gates.
4. Test fresh Apple sign-in on a real production TestFlight device, then resume,
   sign out and sign in again. A deliberately invalid token should now get 401,
   not “Apple sign-in is not configured.” Invalid-input checks are not sufficient
   acceptance evidence for a real sign-in.

Email matching no longer silently links a new provider subject. For a pre-seeded
account, sign in with its existing identity/session and explicitly link Apple.
If it has no working identity, use a separately audited account-recovery flow;
do not reinstate implicit email-based merging or issue a permanent admin token.

## GitHub configuration

Create a dedicated **identity-only** GitHub OAuth app, not the repository/MCP
connector's app. Its exact callback is `https://tardy.news/auth/github.html`.
Register the matching `GITHUB_REDIRECT_URI`; the server rejects non-HTTPS,
credential-bearing, fragment or query callbacks. No callback from a request is
used. Tardy asks for no GitHub scopes and only calls `/user` to verify numeric ID.
It does not fetch private email, repositories or retain GitHub access tokens.
GitHub may reuse previously authorized scopes on an existing app, another reason
not to reuse a repository connector's OAuth registration.

Supply `GITHUB_CLIENT_ID` and `GITHUB_REDIRECT_URI` as public service configuration,
and `GITHUB_CLIENT_SECRET` through a managed opaque runtime secret binding.
Customer ToFu exposes `github_client_id`, `github_redirect_uri` and
`github_binding_ref`; the first and binding must be configured together. A partial
runtime configuration fails startup. Confirm that the customer secret-binding
capability injects `GITHUB_CLIENT_SECRET` for the service before applying; the
repository does not create or read any provider secret. Never commit a populated
`.env`/tfvars or put the secret itself into ToFu state.

Deploy the callback page and API migration before the native app. This flow needs
the `tardy` URL scheme in a development/native build; Expo Go is not production
OAuth acceptance evidence. No new native dependency was added.

## Contract and manual flow

1. The client keeps a random 43–128 character PKCE verifier in memory and sends
   its base64url SHA-256 challenge to `POST /v1/auth/github/start`.
2. The API stores only a state hash, S256 challenge, optional linking account and
   10-minute expiry in PG, and returns its fixed GitHub authorization URL.
3. Open the system authentication browser. The fixed HTTPS callback forwards only
   the temporary authorization code and state to `tardy://auth/github`, with no
   access/session token. It removes the query from browser history and loads no
   analytics or third-party assets.
4. The client checks callback origin/path and exact state, then sends code, state
   and verifier to `POST /v1/auth/github/complete`.
5. The API atomically burns the bound attempt before exchanging the code with
   GitHub; retries after a failed exchange must start over. The verified numeric
   GitHub ID chooses the provider identity. A new identity creates a new account;
   mutable handle/name/email never selects an existing account.
6. Resume/sign out use the same session contract as Apple.

Apply launch-safety migration 0036 with the OAuth migration. Provider/dev session
issuance and deletion intake share the durable-account lock; a deletion receipt
blocks fresh credentials and session resume, including receipts already marked
completed. Do not deploy a new auth issuer without this lifecycle gate.

For linking, use Settings → Link Apple/GitHub and explicitly confirm. GitHub
start and complete both carry `link:true` and the **same authenticated human
account**, not an agent token. Apple `/v1/sessions` accepts `link:true` with an
authenticated human session. An identity already attached to another account
returns 409, not an account merge. The controller persists the returned session
without changing profile. Account recovery/merging is a separate workflow.

## Required acceptance / known limits

Before launch prove browser cancellation/state mismatch/replay/expired attempt,
existing login, new signup/onboarding, explicit linking and cross-account conflict
on a native device against the release API. Keep Apple tested on that same build.
There is no GitHub OAuth registration/secret or live deployment produced by this
change. Anonymous OAuth-start abuse budgets and expired-attempt retention must be
covered by launch edge/operations policy. Do not launch a public unbounded auth
endpoint without those limits. Provider account recovery and native macOS GitHub
browser integration are not implemented here.

Implementation follows [GitHub's OAuth web flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
and the installed [Expo SDK 57 WebBrowser API](https://docs.expo.dev/versions/v57.0.0/sdk/webbrowser/).
