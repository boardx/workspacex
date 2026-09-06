# WX-E005 / W05 — complete discovery schema increment

This increment extends existing MCP discovery and storage. It does not enable tools/call,
credential decryption, a LangChain execution adapter or a new permission system.

## Contract delta

`agent-runtime.McpTool` and discovery records gain optional `description: string`,
`inputSchema: Record<string, unknown>` and `outputSchema: Record<string, unknown>`.
Missing fields remain absent for old records. An absent inputSchema means legacy catalog
metadata only: a future execution loader must reject it until rediscovery supplies the
actual MCP input schema. An absent outputSchema is valid MCP and does not mean incomplete.
No empty schema is invented to upgrade old records.

The SDK gateway returns these fields directly from tools/list. PostgreSQL adds nullable
`description text`, `input_schema jsonb`, `output_schema jsonb` columns to existing mcp_tools.
The tenant-bound store persists and reads these columns without a second catalog.

## Fingerprint and reauthorization

The existing schemaFingerprint remains the single discovery comparison field. Its new
version hashes a canonical JSON payload containing signature, description, inputSchema,
outputSchema and sideEffect. Object keys sort recursively; array order is preserved.
The digest is SHA256, prefixed `v2:` to distinguish the old truncated signature-only hash.
Thus old rows report signatureChanged on the first upgraded rediscovery. Same-name type,
nested constraint, description, output schema or side-effect changes also report change;
object-key reordering alone does not.

A changed fingerprint resets the tool's existing authScope to 未开放, requiring existing
reauthorization. No whitelist or server permission is broadened. Existing side-effect-cap
checks still run; reauthorization is an additional conservative reduction of tool scope.

## Acceptance

- Same tool/parameter names with changed type or nested constraint report signatureChanged.
- Recursively reordered object keys retain the fingerprint.
- Real MCP discovery preserves descriptions and input/output schema.
- Real PostgreSQL roundtrip preserves full JSON and optional-field absence across orgs.
- Changed discovery closes prior tool authorization; identical rediscovery preserves it.

Use the repository isolation wrapper for API tests. This document is design input only;
feature status remains in the existing phase feature list, not here.

## Temporary contract size exception

This bounded increment adds four lines to the already oversized
`packages/contracts/src/agent-runtime.ts` (2,798 lines at this increment). Owner:
WX-E005 module worker, coordinated by this implementation session's main agent.
The exception expires **before the next E005 execution-bridge increment starts**.
That increment must extract the MCP tool contract and necessary MCP-only enums into a
small acyclic contract module, preserving current public exports and proving contract
and MCP discovery regressions. This avoids refactoring shared main-run contracts while
the peer implementation is editing them. This is a temporary exception, not permission
to add further MCP execution fields to the oversized file. Validation evidence for the
current delta is recorded under `evidence/WX-E005/README.md`.
