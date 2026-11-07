# Incremental source-CI repair review — PR #6203

**CLEAN, including the scoped follow-up through `bfc88e0970c7f08d1a3c83c12aff1c8573c1825e`: no actionable P1/P2. Dynamic verification and CI remain separate gates.**

Reviewed repair `53038714f4ed0a3b925239274a167aa3187bf194` against parent `ca3f9e4482ae84adea3124ef497b2b2da78b0933`, then its preservation in frozen HEAD `820072a38959887f2520c90f096e06ceac18eb03` after merging accepted develop `3644ae2c8213770614866c1c39ac4df2b8920c05`. Reused the prior full integration review; this is not a second whole-product review of PROFILE/HOME or accepted project-workbench changes.

## Repair assessment

The supplied source-CI failure receipt records `AGENT_STARTER_PACK_CONFLICT` on the original attempt and retry, with 201 passing cases and one HOME failure. The unchanged preceding authored-title case installs roles, then explicitly updates display translations in the same tenant. HOME's previous unconditional role installation was therefore not a valid prerequisite operation for that existing state. The patch changes only HOME preparation and the `wave2Runtime` contract import; no API, installer, runtime configuration, timeout or retry behavior changes.

The new setup reads the actual directory and organization-scoped skill library using the logged-in administrator's existing authorization. Both HTTP results require 200 and are parsed through their contract schemas. Sorting stable IDs makes selection deterministic. Reuse requires an official directory card with agent/version identity; the selected skill must be enabled and have a current version. Missing prerequisites produce an explicit assertion failure, not a skip or an accepted conflict.

When an official agent already exists, setup performs no install POST. It rereads and compares the complete sorted directory/library snapshots, preserving every prior visible row and the selected identities. This is appropriate for the shared-tenant authored-state scenario and does not overwrite the prior case's work.

When the official agent is genuinely absent, actual dependency and role installation remain mandatory, each with strict 201 assertions. The role result is parsed through `wave2Runtime.operations.importAgentStarterPack.out`; selected official agent/version IDs must occur in that actual import result. All initial visible rows must survive unchanged after setup. No catch, response interception, permissive 409 branch, synthetic recommendation result or weakened later assertion was introduced. The branch attachment is emitted only after these assertions succeed.

The fixture contract, authentication identity and installation guard remain unchanged. The reuse path is intentionally not a proof of reinstalling or updating authored packages; the fresh path retains the real installation requirement.

## Independent preservation checks

Recomputed the spec sections from Git objects at the exact parent and frozen HEAD. All helpers and preceding cases are byte-identical except the added `wave2Runtime` import. Every HOME statement from `const reads = { config: 0, agents: 0, skills: 0 };` to EOF is byte-identical. The spec SHA-256 independently matches the recorded `d7532231f01ac7b12290965617d9ab52950d074930c93f4859eefdbf4767d366`.

Re-derived the worker/upstream changed-path sets against common base `dc9bc31…` and checked each source/merged Git mode and blob. All **110 worker** and **34 upstream** non-overlapping entries match, with no missing or extra proof entries. The overlap consists only of the two registries. Against repair `53038714…`, each registry adds only the accepted project-workbench import/spread. This validates preservation without reopening the accepted upstream implementation review.

## Dictionary audit and explicit limitation

A nonexecuting TypeScript-AST walk expanded all imported/local dictionary object spreads directly from Git source for repair, upstream and frozen HEAD:

| Source | Chinese keys | English keys | Duplicate keys | Locale key mismatch |
| --- | ---: | ---: | ---: | ---: |
| Repair `53038714…` | 1,243 | 1,243 | 0 | 0 |
| Upstream `3644ae2…` | 1,180 | 1,180 | 0 | 0 |
| HEAD `820072a…` | 1,323 | 1,323 | 0 | 0 |

For both locales, HEAD exactly equals the source union at the literal-value or retained-expression-text level: no conflicting shared source entry, missing key, added unexpected key or changed literal/expression. All **1,257 pairs with string-literal values in both locales** have matching placeholder-name sets.

**This is not a complete evaluated-value/placeholder PASS.** Sixty-six Chinese entries are nonliteral constants/property references or function-derived values: 17 pre-existing entries and 49 project-workbench entries. The AST audit retained their expression text without evaluating them. In particular `tabLabelForKind(...)`, `items.find(...)` and `orgDisabledBanner(...)` exceed the restricted nonexecuting resolver. No module execution, icon stubbing or allowlist expansion was used. Exact source preservation and expression-union checks cover the integration boundary, but do not independently establish runtime values or placeholder parity for those 66 entries. The root VM audit stopping at `lucide-react` is an audit-tool limitation, not product failure or successful validation.

## Remaining evidence boundary

No tests, typecheck, build, database, browser, service, CI dispatch or Git mutation were run by this reviewer. Only this report was written. Concurrent root-owned validation files were not modified or treated as reviewer-run results.

Both fresh runtime scenarios remain required: standalone HOME proving `install-fresh`, and the real two preceding authoring cases followed by HOME in the same tenant proving `reuse-existing`. The old standalone browser PASS cannot establish the repaired shared-tenant path. Fresh relevant static/type/unit gates and source/native-candidate CI must also be recorded against the actual delivered source. This review does not claim those executions passed, the original red CI is repaired in production, or PR #6203 is merged. Separate API #6217 and quota work remain outside this repair.


## Scoped follow-up: stable authored snapshots — `820072a…` → `bfc88e0970c7f08d1a3c83c12aff1c8573c1825e`

**ADDRESSED / CLEAN.** This is the requested single small delta review, not a repeated whole-scope review. The current reviewed source is `bfc88e…`; the earlier sections record the preceding repair and registry audit at `820072a…`.

The new snapshot helpers retain exactly agent `{ agentId, versionId, name, display }` and skill `{ skillId, currentVersionId, name, display }`. Each pre-existing row must still be found by stable ID before comparing the projected snapshot. On reuse, complete sorted projected collections must match, so missing/additional rows and altered authoring identity/content remain detectable. Selected reused entities receive the same projected comparisons. Enabled-skill/current-version requirements, actual imported agent/version IDs, strict HTTP status/schema checks, no-install reuse, and real fresh installation are unchanged.

This intentionally removes whole-object locking of readiness, usage, satisfaction, avatar URLs and other derived fields that can legitimately change during live setup. It follows the main coordinator's explicitly approved boundary for preserving authored state. Earlier descriptions of whole directory/library snapshot equality are superseded by these precise projections; the receipt's `existingSnapshotsPreserved` means these authored projections, not every derived response property. No original HOME behavior assertion was weakened.

Independently compared Git bytes across this exact follow-up: all preceding cases/helpers and all HOME statements from the `reads` marker to EOF remain identical. The only changed paths are the browser spec and `ci-precondition/preserved-assertions.json`. Thus registry and all other product-source bytes remain identical to `820072a…`; the prior 1,323-key union/source-preservation results and the explicit 66-nonliteral evaluated-value/placeholder limitation remain applicable without a new AST or runtime claim.

Root reports web typecheck exit 0 at `820072a…` (37.56 seconds); that precedes this delta and is not represented as validation of the new source. Affected fresh checks and both actual browser branches remain pending for `bfc88e…`. Runtime resource tests may independently validate computed strings/placeholders; this reviewer did not expand the VM allowlist or evaluate icon/application modules. Only this report was amended; no tests, services, browser, CI or Git mutations were performed.
