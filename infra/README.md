# Tardy customer infrastructure

This root is Tardy's complete infrastructure intent as an FPL customer. It must not import `shared-infra`, use Cloudflare/DigitalOcean providers, or receive vendor credentials.

`fpl_fab_project.tardy` and `fpl_fab_repository.tardy` register the customer,
GitHub repository, and repository-owned `.fab/pipelines.json` before any build
resource is created. The repository file owns both the static-site recipe and
the digest-producing API image recipe; shared infrastructure does not carry a
second copy.

`fpl_fab_site.landing` registers the static agent-first site from `web/public` at `tardy.news`. Fab owns build/promotion and `fab-sites` serves the immutable artifact; Palisade and the existing Cloudflare zone own verified ingress. `api.tardy.news` remains the separate Shroud service domain.

The checked-in `.fab/pipelines.json` recipe and the site registration both use
an explicit no-op install command because this dependency-free static site has
no root Node lockfile. The recipe publishes `web/public`, `/llms.txt`, and
`/SKILL.md` from an immutable `dist` artifact.

## Identity

Humans keep using the existing `prod` CLI profile. A second `fpl profile` is unnecessary because profiles select an FPL environment/issuer, not a customer or project.

The control plane must provide:

- company `tardy` with Avery as initial owner;
- projects `tardy-dev`, `tardy-staging`, and `tardy-prod`;
- a short-lived human apply token derived from the current `prod` session;
- a separate CI service principal scoped to the selected Tardy project and only `storage:manage`, `postgres:manage`, `deployment:manage`, and `state:read/write`;
- managed encrypted state and locking for this root.

Do not mint a general FPL long-lived personal API key for CI. Do not put `FPL_TOKEN`, database URLs, R2 keys, or state credentials in tfvars or GitHub repository variables when an FPL workload/CI identity can provide them.

## Remote state and locking

Tardy uses FPL's existing managed-state R2 bucket through OpenTofu's S3
backend. The checked-in `backend.r2.tfbackend` contains no credentials and is
shared by every environment. OpenTofu's native S3 lock file serializes plans
and applies; do not use `-lock=false`.

The protected executor must exchange the project-scoped FPL automation
identity for short-lived state credentials and export them as
`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`. They must not be written to a
backend file, tfvars, OpenTofu state, GitHub variables, or command-line
arguments. Until that identity exchange is hosted, this root may be validated
by an operator-owned executor with the existing R2 state environment, but the
credentials must not be handed to the customer or copied into the repository.

Initialize a clean checkout with a deterministic, project-owned state key:

```sh
export FPL_PROJECT=tardy-prod
test -n "$AWS_ACCESS_KEY_ID" && test -n "$AWS_SECRET_ACCESS_KEY"
tofu -chdir=infra init -input=false \
  -backend-config=backend.r2.tfbackend \
  -backend-config="key=customers/${FPL_PROJECT}/tardy/terraform.tfstate"
```

Use exactly `customers/<project>/tardy/terraform.tfstate`; the project-scoped
state credential must be unable to read or write another prefix. A second clean
machine runs the same initialization and then:

```sh
tofu -chdir=infra plan -input=false -lock-timeout=5m \
  -var="project=${FPL_PROJECT}" \
  -var="api_image=${TARDY_API_IMAGE}" \
  -out=tardy.tfplan
```

After the first successful apply, repeating that plan from either machine must
report no changes. `terraform.tfstate`, `.terraform/`, saved plans, provider
tokens, and backend credentials remain untracked. A failure to acquire the
lock is an active writer, not permission to bypass locking.

## Provider contract

`fpl_storage_bucket.media` returns an opaque binding reference. At deployment, FPL resolves it into `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET` without placing their values in customer state.

`fpl_postgres_database.primary` returns an opaque binding reference. At deployment, FPL resolves it into `DATABASE_URL`; the URL and password never appear in customer state or outputs.

`fpl_shroud_service.api` consumes both opaque bindings, exposes port 3000 as `api.tardy.news`, and promotes only after `/healthz` returns 200. `api_image` is required and must be pinned by OCI digest; image construction and publication are release-pipeline responsibilities, not OpenTofu side effects.

Applying is intentionally blocked until the hosted FPL API implements these two project-scoped endpoints and managed customer state is available:

- `PUT/GET/DELETE /v1/projects/{project}/storage-buckets/{name}`
- `PUT/GET/DELETE /v1/projects/{project}/postgres-databases/{name}`

Both APIs must authorize project membership and scopes, meter usage, preserve deletion protection, store provider credentials operator-side, and return only opaque `binding_ref` values plus non-secret metadata.

The hosted service facade must also accept typed `bindings` on `PUT /v1/projects/{project}/services/{name}`, reject cross-project references, and expand them only inside the workload runtime. Tardy must not use the operator-only `fpl_shroud_deployment` resource as a shortcut.

## Agora One development bridge

The hosted tenant facade does not yet route `PUT /v1/fab/sites/{id}` or Fab's
native `/v1/sites` API. Until it does, a developer may test only the Fab site
resource through an SSH tunnel to Agora One. Build the current provider, open a
local forward to `fabd`, and import the existing dev registration into a
temporary state:

```sh
go -C ../fpl-opentofu build -o terraform-provider-shroud .
ssh -N -L 127.0.0.1:17788:127.0.0.1:7788 agora-one

FPL_ENDPOINT=http://127.0.0.1:17788 \
FPL_PROJECT=tardy \
tofu import \
  -state=/tmp/tardy-dev.tfstate \
  -var='project=tardy' \
  -var='environment=dev' \
  -var='api_image=registry.invalid/tardy@sha256:0000000000000000000000000000000000000000000000000000000000000000' \
  fpl_fab_site.landing tardy
```

Use a CLI development override for `registry.fpl.dev/fpl/shroud` while the
provider remains private. A targeted plan should report `No changes`. This is
a temporary validation bridge, not a production state backend and not
authorization to manage Agora One's platform containers.

Agora One currently has `FABD_SHROUD_DISABLE_PERSISTENCE=true` and
`FABD_ARTIFACT_STORE=local`. That combination lets the static build succeed but
loses `/workspace/artifacts/site` when its Firecracker runner exits. Fab already
has its R2 artifact secret bindings, so the platform-owned fix is to select the
R2 artifact store (or restore Shroud persistence), restart `fabd`, and rerun the
site build. Tardy must not patch that shared runtime configuration itself.
