# Tardy customer infrastructure

This root is Tardy's complete infrastructure intent as an FPL customer. It must not import `shared-infra`, use Cloudflare/DigitalOcean providers, or receive vendor credentials.

## Identity

Humans keep using the existing `prod` CLI profile. A second `fpl profile` is unnecessary because profiles select an FPL environment/issuer, not a customer or project.

The control plane must provide:

- company `tardy` with Avery as initial owner;
- projects `tardy-dev`, `tardy-staging`, and `tardy-prod`;
- a short-lived human apply token derived from the current `prod` session;
- a separate CI service principal scoped to the selected Tardy project and only `storage:manage`, `postgres:manage`, `deployment:manage`, and `state:read/write`;
- managed encrypted state and locking for this root.

Do not mint a general FPL long-lived personal API key for CI. Do not put `FPL_TOKEN`, database URLs, R2 keys, or state credentials in tfvars or GitHub repository variables when an FPL workload/CI identity can provide them.

## Provider contract

`fpl_storage_bucket.media` returns an opaque binding reference. At deployment, FPL resolves it into `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET` without placing their values in customer state.

`fpl_postgres_database.primary` returns an opaque binding reference. At deployment, FPL resolves it into `DATABASE_URL`; the URL and password never appear in customer state or outputs.

Applying is intentionally blocked until the hosted FPL API implements these two project-scoped endpoints and managed customer state is available:

- `PUT/GET/DELETE /v1/projects/{project}/storage-buckets/{name}`
- `PUT/GET/DELETE /v1/projects/{project}/postgres-databases/{name}`

Both APIs must authorize project membership and scopes, meter usage, preserve deletion protection, store provider credentials operator-side, and return only opaque `binding_ref` values plus non-secret metadata.
