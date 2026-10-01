# Tardy customer infrastructure

This root is Tardy's complete infrastructure intent as an FPL customer. It must not import `shared-infra`, use Cloudflare/DigitalOcean providers, or receive vendor credentials.

`fpl_fab_site.landing` registers the static agent-first site from `web/public` at `tardy.news`. Fab owns build/promotion and `fab-sites` serves the immutable artifact; Palisade and the existing Cloudflare zone own verified ingress. `api.tardy.news` remains the separate Shroud service domain.

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

`fpl_shroud_service.api` consumes both opaque bindings, exposes port 3000 as `api.tardy.news`, and promotes only after `/healthz` returns 200. `api_image` is required and must be pinned by OCI digest; image construction and publication are release-pipeline responsibilities, not OpenTofu side effects.

Applying is intentionally blocked until the hosted FPL API implements these two project-scoped endpoints and managed customer state is available:

- `PUT/GET/DELETE /v1/projects/{project}/storage-buckets/{name}`
- `PUT/GET/DELETE /v1/projects/{project}/postgres-databases/{name}`

Both APIs must authorize project membership and scopes, meter usage, preserve deletion protection, store provider credentials operator-side, and return only opaque `binding_ref` values plus non-secret metadata.

The hosted service facade must also accept typed `bindings` on `PUT /v1/projects/{project}/services/{name}`, reject cross-project references, and expand them only inside the workload runtime. Tardy must not use the operator-only `fpl_shroud_deployment` resource as a shortcut.
