# Apple builds on FPL-owned Macs

## Boundary

Expo cloud builds are optional. Tardy can build a signed production IPA on a
Mac and upload it directly to App Store Connect. Keep Expo's existing native
generation and build tooling; do not reimplement signing or app compilation.

Fab should own queueing, immutable source selection, runner admission, and
release receipts. As inspected on 2026-10-06, Fab's `PipelineSpec` supports
static sites, workflows, and OCI images, but its dispatcher launches Shroud
guests. There is no verified Mac runner enrollment/dispatch path. A workflow
recipe alone does not make an Apple build runnable. Do not add an unsupported
`macos` pipeline to `.fab/pipelines.json` or bridge this with privileged SSH.

## First production build

1. Use a clean checkout of the approved commit, with its lockfile.
2. Verify full Xcode, accepted license, CocoaPods, Node, Fastlane and sufficient
   free disk space. Prefer at least 40 GB of headroom; this is an operational
   target, not an Apple requirement.
3. Recover the existing Apple Distribution signing identity and App Store
   provisioning profile for `dev.fpl.tardy`. A Developer ID Application
   identity is not an iOS distribution identity. Do not revoke or duplicate
   existing certificates without checking their owner and consumers.
4. Supply production environment values explicitly. Local builds do not
   inherit all EAS cloud secrets. Require
   `EXPO_PUBLIC_TARDY_API_URL=https://api.tardy.news` and reject mock/local
   release configuration.
5. From `mobile/`, use the existing production profile with
   `npx eas-cli@latest build --platform ios --profile production --local`.
   This is the manual candidate path, not an implemented Fab recipe. EAS
   authentication and its remote version/credential management are still
   dependencies of this path.
6. Validate signature, bundle ID, entitlements, production API configuration
   and a unique build number before uploading the exact IPA through Apple's
   supported upload tooling. Use a scoped App Store Connect API key.
7. Record commit, build number, artifact checksum, upload receipt and Apple
   processing status. Only mark TestFlight available after Apple reports it
   and the intended testing group can access the build. App Store release is
   separate from TestFlight submission.

## Fab capability request

Provide a project-scoped Apple runner interface in Fab rather than a Tardy
daemon polling GitHub or a second CI scheduler:

- Outbound authenticated enrollment and job leasing from macOS hosts.
- Capability selection (`macos`, architecture, Xcode/SDK version), health,
  concurrency limits, cancellation and expiring leases.
- Immutable commit jobs, fresh workspaces and bounded artifact/log delivery.
- No signing grants for pull requests or untrusted forks. Release jobs only
  run approved repository revisions with project-scoped authorization.
- Separate build and upload capabilities. Signing uses a dedicated Keychain;
  credentials are not committed, logged, or passed to arbitrary workflows.
- A single atomic build-number allocator across all Macs, with retry-safe
  upload receipts. Do not use independent per-machine counters.
- Cleanup and credential-access revocation after each job. Persistent secrets
  on a family computer require an explicit enrollment/security decision.

## Machines checked

On 2026-10-06, this laptop had Xcode 26.6 and about 45 GB available. Its
accessible Keychain showed only Developer ID Application signing.

The Studio was reachable through Tailscale SSH. Xcode.app exists, but the
active developer directory was Command Line Tools; root-volume free space
was about 8.6 GB. Its accessible Keychain also showed only Developer ID
Application signing. Interactive shell tool availability and locked
Keychains must be checked separately; an SSH check is not proof that no
other credentials exist.

The proposed M4 mini has not been identified or enrolled. Obtain its hostname
and login, enable Remote Login/Tailscale, install full Xcode, and use a
dedicated build user. Start it as a non-signing runner until release access
is deliberately granted.

## References

- https://docs.expo.dev/build-reference/local-builds/
- https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/
