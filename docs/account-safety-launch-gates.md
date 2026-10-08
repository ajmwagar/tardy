# Account lifecycle and community safety rollout boundary

This intake slice does **not** satisfy the complete public launch gate.

`POST /v1/account/deletion` requires a bearer token and
`{"confirmation":"DELETE"}`. A human account gets HTTP 202 with a durable request
ID and status `requested`. The transaction revokes human sessions/API credentials,
owned-agent credentials and personal AI consent. The receipt does not claim erasure.
Production data must never be used as integration fixtures.

Intake defaults to HTTP 503 until `TARDY_ACCOUNT_DELETION_INTAKE_ENABLED=true`.
Do not enable this until the completion worker and disclosed deadline are operational.

Before enabling the client deletion flow publicly, provide a deterministic worker
that deletes owned UGC, messages, profile data, private media and cached derivatives,
revokes Apple/provider refresh tokens, cancels applicable website billing and records
completion. Retained financial/security records need an explicit legal basis and
retention deadline; deletion cannot silently transfer agents or private work to someone
else. A person must receive a realistic completion window and confirmation. Revoke
MCP/OIDC connector grants and queued webhook/push work as part of this worker.
Use a recent human authentication assertion for confirmation; a permanent API token
alone must not authorize the production erasure transition.

Operators inspect pending requests with a scoped, audited database capability:

```sql
SELECT id,status,requested_at FROM account_deletion_requests
WHERE status <> 'completed' ORDER BY requested_at;
```

This is a runbook diagnostic, not permission to manually bypass the erasure workflow.
Do not mark requests completed until the required purge and revocation receipts exist.

`POST /v1/posts/{id}/report` accepts `reason` (`spam`, `harassment`, `sexual`,
`violence`, `copyright`, `other`) and optional `details` (at most 2,000 characters).
The existing visibility boundary is checked before intake; hidden/private posts are
not discoverable by reporting. Repeated reporter/post submissions are idempotent.
Reporting is not an automatic ban or permission for operators to read private DMs.

Before public community rollout: implement scoped audited moderator access, content
quarantine enforced on every feed/direct lookup/media path, report UI on posts,
operator response ownership and visible support contact. Verify block/unblock across
DM invitations, mentions, comments, follow requests and search. External AI consent
coverage (`tardy-feft`) remains a separate gate, not solved by a search toggle.

Apple's [account deletion guidance](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion)
requires full account and UGC removal, clear timing and subscription handling;
deactivation alone is insufficient. [UGC guidelines](https://developer.apple.com/app-store/review/guidelines/)
require filtering, reporting, blocking and published contact information.
