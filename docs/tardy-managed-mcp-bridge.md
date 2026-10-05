# Tardy-managed MCP Bridge

## Outcome

Tardy users get one consistent connector experience:

- **Connect FPL** links an existing FPL account and immediately discovers every MCP capability already available to that user.
- **Add a connector** gives a non-FPL user the same bridge as an FPL-managed Tardy capability, with provider connections added individually.
- **Bring a bridge** links a supported external broker such as Composio without making Composio the Tardy identity or policy authority.

Tardy owns agent identity, conversation context, grants, approvals, and audit presentation. The FPL MCP Bridge owns provider authentication, credential refresh, capability discovery, and tool invocation.

## Boundary

```text
Tardy client
  -> Tardy API (owner, agent, conversation, grant policy)
    -> short-lived FPL invocation token
      -> FPL MCP Bridge
        -> FPL/Unibus capabilities
        -> Tardy-managed provider accounts
        -> Composio or another external MCP broker
```

Tardy persists only an opaque reference such as `binding://mcp/tardy/<subject>/<installation>`. It MUST NOT persist:

- provider access or refresh tokens;
- Composio consumer/project keys;
- an MCP URL containing credentials;
- FPL OIDC refresh tokens;
- secrets copied into an agent soul, prompt, chat, or client application.

The current Tardy API stores bridge registrations and agent grants in `mcp_bridge_connections` and `mcp_bridge_agent_grants`. Registration is the callback/provisioner boundary after the bridge service has completed authentication; it is not a replacement OAuth implementation.

This slice implements the registry only. References and capability names are owner-supplied metadata, not verified credentials or executable authorization. OAuth linking, broker verification, token exchange, tool discovery, and agent-host invocation are pending the FPL capability below. No registered reference may grant runtime access until the broker independently verifies its owner and scopes.

## FPL capability to add

FPL Cloud needs a project-scoped **managed MCP bridge** capability with two planes.

### Management plane

The management API must:

1. Accept FPL OIDC and identify the human subject and Tardy client.
2. Link an existing FPL MCP installation without reconnecting its providers.
3. Create a Tardy-managed installation for users who do not have an FPL account.
4. Add, relink, list, and remove individual provider connections.
5. Link external brokers, initially Composio, using server-held credentials.
6. Return an opaque `binding://mcp/...` reference plus a sanitized capability catalog.
7. Emit signed lifecycle events for catalog changes, reauthorization, degradation, and revocation.
8. Delete or export a managed installation when its owner requests account deletion.

The management API must never return provider credentials to Tardy. Link and callback requests must use PKCE, exact redirect URI matching, expiring single-use state, and an idempotency key.

### Invocation plane

The invocation API must:

1. Resolve the opaque bridge reference only after validating a short-lived FPL token.
2. Enforce the Tardy user, agent, project/conversation activation, and allowed tool patterns encoded in that token.
3. Discover tools lazily so hundreds of connector schemas do not enter every model context.
4. proxy Streamable HTTP MCP and preserve structured errors and cancellation;
5. enforce provider and tenant rate limits;
6. produce an immutable receipt for every invocation without logging secret arguments or sensitive results;
7. revoke access immediately when either FPL or Tardy revokes the installation.

Tardy should mint or exchange an activation-scoped token only when an agent is summoned. A token should expire with that activation and be narrower than the durable grant stored by Tardy.

## Providers

| Provider | Ownership | Expected behavior |
|---|---|---|
| `fpl` | User's existing FPL account | Import the whole current FPL capability catalog in one consent flow. |
| `tardy_managed` | Tardy tenant in FPL Cloud | Add Spotify, Hue, Google, and other providers individually. |
| `composio` | User or Tardy tenant | FPL Bridge brokers Composio sessions; Tardy never handles its keys or secret MCP URL. |
| `external` | User-controlled | FPL Bridge validates and proxies a supported remote MCP server. |

## Grant and approval policy

Tardy grants are deny-by-default and attach a bridge connection to an owned agent. Tool patterns use provider-qualified names such as `google.drive.search`, `spotify.playback.*`, or `hue.scene.activate`.

- `read_auto`: read-only tools may run without another prompt.
- `ask`: ask for external side effects and any capability whose risk is unknown.
- `always_ask`: ask for every invocation.

The bridge must independently classify tools and may require a stricter approval than Tardy requested. Sending email, changing access controls, spending money, publishing content, and destructive actions should initially require explicit approval. Tardy policy can narrow bridge policy, never broaden it.

## Initial connector order

1. Existing FPL/Unibus capabilities through Connect FPL.
2. Spotify and Philips Hue, whose provider connections already exist in FPL Auth/catalog work.
3. Google Drive, Docs, and Sheets as distinct grants under one Google connection.
4. Gmail as a separate high-sensitivity grant: search/read, draft, and send are separate capabilities; send always asks initially.
5. Composio for long-tail applications while first-party connectors remain owned by their existing FPL services.

## Tardy API contract

- `GET /v1/mcp-bridges` lists the signed-in owner's non-revoked bridge registrations.
- `POST /v1/mcp-bridges` registers an already-provisioned opaque bridge reference.
- `DELETE /v1/mcp-bridges/{id}` revokes the Tardy registration and all grants.
- `GET /v1/mcp-bridges/{id}/grants` lists agent grants.
- `PUT /v1/mcp-bridges/{id}/grants/{agent_id}` grants bounded tool patterns and an approval policy.
- `DELETE /v1/mcp-bridges/{id}/grants/{agent_id}` revokes agent access.

Only the owning human can manage a bridge or grant it to an agent they own. A connection must be healthy before a grant can be created. Database constraints reject raw HTTP endpoints in place of opaque bridge references.

## Manual runbook

Until the management plane is automated:

1. An operator initiates the provider/FPL connection through the managed bridge service.
2. The bridge service completes OAuth and stores credentials in its secret store.
3. It returns an opaque `binding://mcp/...` reference and sanitized capability names.
4. The signed-in owner registers that reference with Tardy.
5. The owner grants selected tool patterns to an owned agent.
6. Summoning that agent causes Tardy to exchange the durable grant for an activation-scoped token.
7. Revoking either the connection or grant prevents the next invocation immediately.

Automation is complete only when it performs these same steps and emits auditable receipts.
