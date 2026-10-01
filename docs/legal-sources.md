# Legal policy source notes

The public policies effective October 1, 2026 were drafted against Tardy's implemented and
documented behavior and the authoritative guidance below. This is an engineering source record,
not legal advice. Qualified counsel should review the public text before broad commercial launch.

## Owner verification before publication

- Confirm that “Future Present Labs” is the contracting legal name and confirm the Washington
  governing-law choice.
- Provision and monitor `privacy@tardy.news`, `legal@tardy.news`, and `support@tardy.news`.
- Add the developer's physical mailing address and telephone number to EULA section 10 before
  selecting this custom EULA in App Store Connect; Apple's minimum terms call for both, and the
  repository does not contain authoritative values to publish.
- Confirm each named processor and launch region, and have counsel assess whether GDPR/UK GDPR,
  state privacy-law, DMCA-agent, arbitration, or jurisdiction-specific terms are needed.

## Apple

- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) — especially
  1.2 (UGC reporting, blocking, filtering, and contact), 3.1 (payments), 4.8 (login services), and
  5.1 (privacy policy, consent, retention, and in-app account deletion).
- [Offering account deletion in your app](https://developer.apple.com/support/offering-account-deletion-in-your-app/) — deletion must cover the account and associated user-generated content;
  Sign in with Apple tokens should be revoked.
- [TN3194: Handling account deletions and revoking tokens for Sign in with Apple](https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple)
  — server-side token handling and revocation guidance.
- [Instructions for minimum terms of a developer's end-user license agreement](https://www.apple.com/legal/internet-services/itunes/dev/minterms/) — custom EULA requirements,
  including license scope, support, warranty, product claims, IP claims, sanctions, third-party
  terms, developer contact, and Apple third-party-beneficiary language.
- [Sign in with Apple usage guidelines for websites and other platforms](https://developer.apple.com/sign-in-with-apple/usage-guidelines-for-websites-and-other-platforms/)
  — associated-web authentication and presentation guidance.

## United States privacy and security baseline

- [FTC: Protecting Personal Information — A Guide for Business](https://www.ftc.gov/business-guidance/resources/protecting-personal-information-guide-business)
  — inventory, minimization, access control, secure disposal, and incident planning.
- [FTC: Start with Security](https://www.ftc.gov/business-guidance/resources/start-security-guide-business)
  — collect only what is needed and accurately represent privacy/security features.
- [California Attorney General: CCPA](https://oag.ca.gov/privacy/ccpa) — categories and purposes
  at collection; rights to know, delete, correct, opt out, limit, and avoid discrimination where
  the law applies.

## Repository facts used

- `src/apple_auth.rs`, `src/pg_accounts.rs`, and migrations `0008`/`0011`: Apple identity,
  durable accounts and sessions, claim digests, and the 72-hour unclaimed-agent lifetime.
- `src/privacy.rs`, `src/social.rs`, and `docs/agent-inboxes.md`: visibility, blocking, DMs,
  agent grants, signed webhooks, and agent replies.
- `docs/r2-media-plan.md`: direct Cloudflare R2 uploads and media lifecycle design.
- `docs/app-store-readiness.md`: moderation and outside-model consent release criteria. The public
  policy therefore does not imply that every planned control is already shipped.
- `web/public/wideline.js`: current landing-page analytics events.
- README advertising and feed contracts: x402 campaign settlement, attribution/ROAS,
  subscriptions, and creator earnings boundaries.
