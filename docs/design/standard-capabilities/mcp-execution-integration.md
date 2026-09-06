# WX-E005 MCP execution integration — bounded production design

Read-only source audit, 2026-09-07. This is an integration proposal, not a claim that the
execution path exists. Ownership remains governed by `peer-boundaries.md`. No main-run
status, attempt, approval ledger, event writer or UI is introduced here.

## Current real entrances and callers

| Entrance / source | Actual caller and current behavior | Boundary / missing link |
|---|---|---|
| `interface/controllers/mcp-remote-discovery.controller.ts`, POST discover-remote | Authenticated org administrator; `discoverRemoteMcpTools` validates membership and invokes the SDK gateway | Principal supplies org/user; organization kind determines local-only endpoint policy. Credential is supplied for this request, not read back from the vault. Discovery is not execution authorization. |
| `interface/controllers/mcp-servers.controller.ts`, GET list | Authenticated caller through the existing admin list use case | Tenant server metadata only; no secret response and no tools/call. |
| `infrastructure/mcp/http-mcp-gateway.ts` | Discovery composition calls `listTools` using real Streamable HTTP MCP | Existing guarded fetch enforces endpoint/network policy; current `McpGateway` port has only listTools. No production tools/call route was found. |
| `infrastructure/agent-run/deep-agent-model-provider.ts`, `subtaskConfig` | TS model provider sends trusted org/run and callback configuration on fresh/resume | Python receives `org_id`, `parent_run_id`, base URL/key outside messages. text-only mode omits callbacks. This identifies the service/run but is not an MCP permission grant. |
| `interface/controllers/subtask-run.controller.ts`, POST `/internal/subtask-runs` | Python spawn_async_task calls with deployment `DEEP_AGENT_SERVICE_INTERNAL_KEY` | Public-to-session-auth route, shared service key required; missing key fails closed. Parent/org association enforced by store/FK. Reuse the service authentication convention, not this endpoint or its queue for MCP. |
| `application/mcp/authorize-layer1.ts`, `domain/agent/three-layer-permission.ts` | Pure/use-case authorization functions, currently no MCP execution caller found | Layer 1 is insufficient alone. The three-layer intersection requires actual whitelist and task-package decisions, not defaults. |

These observations come from current source call sites, not historical header claims.
Do not expose a direct model-specified endpoint/credential or invent a callTool helper
without provider and Python callers: that would leave the production chain disconnected.

## Facts required before each outbound call

1. Resolve the authenticated callback's org/run in the existing tenant repository; derive
   requester, agent and fixed version from that run. `pg-agent-run-repository.ts` already
   derives requester from the initiating message and loads the run's fixed version.
   Neither requester nor agent/version supplied in model arguments is authoritative.
2. Obtain execution admission from the peer's canonical run/attempt control interface.
   A service-wide key and a run's existence do not prove that an attempt is still active.
   Do not guess acceptable status strings or build an E005 attempt/lease table. The
   peer interface must reject cancelled/stale attempts immediately before dispatch.
3. Read current org server/tool metadata using `PgMcpServerStore` / tenant-bound
   `PgMcpToolStore`: registered endpoint, review and connection states, quarantine,
   server and tool scopes, side effect, complete input schema and current fingerprint.
   Check existing `domain/mcp/server-status.ts` callability as well as layer 1: the
   latter explicitly does not handle all review-state blocks. Apply server and tool
   restrictions together; neither scope can loosen the other. Load identity/group
   membership through IdentityRepository, never Python-supplied platform-group flags.
4. Read the agent whitelist and its reviewed fingerprint for the **fixed version**;
   `agents.tool_whitelist` is persisted and used by `pg-agent-publish-repository.ts`,
   but this audit did not establish an immutable per-version whitelist runtime reader.
   Do not silently substitute the latest mutable agent definition. Require version
   provenance and compare with the current discovered fingerprint (including legacy
   fingerprint migration), even after server/tool scope is reopened.
5. Read a real task permission-package verdict from its owning module and call
   `intersectAgentPermission`. `Layer3Fact` is currently an input to a pure function;
   `requestTaskPermissionGrant` records an application request, not an approved grant.
   No production MCP execution composition reading that grant was found. Missing task
   binding/reader must deny, not become `granted: true` or derive from org membership.
6. A requiresConfirmation result must enter the peer's existing approval mechanism,
   bound to exact tool, arguments digest, schema fingerprint and attempt. No approval
   transport exists in this proposed bridge until the peer contract is supplied;
   confirmation-required tools therefore fail closed instead of executing immediately.

## Credential custody: actual database limit and minimal extension

`20260824090000_i1928_mcp_server_persistence.sql` forces tenant RLS on
`mcp_server_secrets`; app_rw has SELECT only on org_id, server_id, algorithm, key_id,
sealed_at, plus writes. It has **no SELECT on ciphertext**. `pg-mcp-server-store.ts`
returns configured-presence metadata only. `domain/model/credential-vault.ts` deliberately
exports encrypt-only `CredentialCipher`; transcript decryption is a separate purpose and
must not be reused for MCP credentials.

Consequently, adding a decrypt method to the current app_rw repository cannot work and
would weaken the custody contract. Add an infrastructure-only outbound credential
capability, with a separately configured least-privileged DB role that may read only the
required secret columns, remains subject to tenant RLS and has no BYPASSRLS/superuser
rights. Explicit role provisioning/migration and a distinct connection configuration are
required; no admin DB fallback or broad app_rw grant. Its only consumer is the controlled
MCP outbound transport: resolve/decrypt by org/server with supported algorithm/keyId,
attach the credential for the bounded request, and discard it. The inward port returns
an execution result, not a plaintext secret. Keep domain CredentialCipher encrypt-only.

Unknown key/algorithm, unavailable reader or decrypt failure must prevent the network
call. Errors, HTTP logs, traces and model results must not contain secrets. Update the
existing credential-never-echoed regression deliberately to assert this narrowly scoped
reader and no domain/API reader; do not remove that protection. Anonymous servers need
no secret reader and can form the first vertical slice after all three grants are real.

## Minimal complete production chain

`execute-run / resume` → trusted provider configuration → Python LangChain MCP adapter
→ internal TS MCP facade → canonical run admission + live three-layer policy → existing
SSRF-guarded MCP SDK transport → registered upstream tools/call → bounded MCP result
→ native LangChain ToolMessage. No main-run queue or event writer is added.

Use an official LangChain MCP adapter against a TS-owned, run-scoped MCP facade so
upstream credentials and endpoints never enter Python/model arguments. The facade must
implement both authorized tools/list and tools/call; list emits only granted, complete,
fingerprint-pinned schemas, and call rechecks live policy and argument validation.
Provider injects facade URL and authentication into trusted runtime configuration on
fresh/resume; text-only has no facade/tools. The adapter must use request-scoped headers
and not reuse another run's session. A static preloaded tool list does not authorize a
later call. Reject schema drift and unauthorized tools before opening upstream transport.

A tool call carries the framework-issued call ID, not a model-invented identifier. Use
peer execution/journal identity for retries and admission; do not blindly retry outbound
writes after a timeout or ambiguous response. Result limits, transport deadline, schema
validation and MCP isError handling are explicit. Tool return content remains untrusted.
Progress/events/results go through the peer's existing interfaces, not a second writer.
The initial narrow supported transport remains Streamable HTTP; stdio and arbitrary
local executables are not silently admitted by using an adapter library.

## Missing shared contracts and ownership handoff

| Needed contract | Owner / required semantics |
|---|---|
| Run-scoped tool admission | Peer: authoritative org/run/attempt/requester/agent-version binding and cancellation/stale-attempt rejection; actual symbol must be agreed before wiring. |
| Fixed-version whitelist reader | Agent runtime: immutable whitelist plus reviewed tool fingerprint, explicit missing-data refusal. |
| Task-package authorization reader | Existing task/permission owner: task binding and live granted/revoked verdict, not a new E005 grant store. |
| Confirmation and replay-safe call identity | Peer: exact argument/schema binding, durable decision, replay behavior and uncertain outbound outcome; no new approval ledger. |
| Internal MCP facade configuration | E005 contracts: trusted URL/auth, run-scoped identity, tools/list and tools/call limits/errors; extract MCP contracts before adding to oversized agent-runtime.ts. |
| Outbound credential connection/capability | Infrastructure: separate restricted DB role, RLS, key configuration, no plaintext outward interface. |

## Acceptance gates

Run a real model/tool graph through the provider facade configuration and real MCP SDK
server, with a real isolated PostgreSQL catalog and authorization fixtures. Observe the
upstream call and returned ToolMessage, not merely adapter construction. Demonstrate
fresh/resume routing and no MCP tool in text-only. Negative cases must assert **zero
upstream requests**: forged service key/run/org, stale attempt, missing version grant,
revoked task package, server quarantine/review block, missing schema, changed fingerprint,
confirmation absent, invalid args and forbidden endpoint. Include schema drift between
list and call, tenant-isolated credential reads (app_rw denied), credential failure/no
leak, and ambiguous write timeout without automatic duplicate dispatch. Shared peer
admission/approval integration must be tested before claiming the production chain done.

Until those shared interfaces exist, preserve the completed schema increment and report
execution as not wired. Do not pretend that a permissive placeholder is an integration.
