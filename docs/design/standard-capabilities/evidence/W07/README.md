# W07 trusted context tools and method packages

WX-T016/T017 usable **restricted attachment retrieval**; WX-T027/T028 existing project list/overview thin adapters. S001/S008/S011/S014 complete method packages in `skills/standard-context`, packaged via existing starter source. These are implemented capabilities with explicit scope; **not full W07 catalogue closure**.

## Implementation and honest gaps

- Reuse actual `PgFileRetrieval` scoped FTS SQL; legacy `search` result shape unchanged. New source projection carries actual attachment/landing/thread/message identities internally. Tool output only includes extracted attachment original markdown bytes, fetched from existing immutable ObjectStore; existing exported `extractedObjectKey` binds the object to tenant/attachment. Version is SHA256 of actual full stored bytes, never a title hash or internal object key. Read rejects mismatch, invalid UTF8, missing/oversize source, and changed permissions. Content returned may truncate at the shared char limit; hash covers full bytes.
- Default scope is current personal thread or existing project current/plenary thread scope. Optional projectId uses existing project authorization; source thread gets real `resolveVisibility` before and after content access. Cross-project reads require that projectId again. Current group-private alternatives remain fail-closed. Full organization retrieval, five-route embeddings/rerank, filters/cursor, immutable canvas-original reads remain outside this first adapter; unsupported request keys reject rather than silently disappear.
- Production bridge uses internal service auth + actual ToolExecutionAuthority(run/attempt/lease/name/callId/args), then reads requester from the claimed run's input message and current parent locator. Shared risk registry marks these four read-only tools L0: no invented approval grant. L0 never bypasses source visibility. No model-supplied user ID or tenant override in tool args.
- Projects reuse listProjects/getProjectOverview exactly. Container listing is the existing domain membership/management rule; container existence does not imply content access. Overview keeps canonical fields and observedAt, not a fake immutable project version. Citation anchors preserve user-visible source record/thread/message identity; a new dedicated clickable citation UI is **not** claimed.
- Python StructuredTools validate the generated contract, send trusted callback identity, refuse redirects/oversize/errors, suppress secrets, and do not retry. Root wires factory/profile/kernel and excludes StandardContextError from retry middleware.
- Four Skills reuse fixed upstream OpenAI and Anthropic methods, preserve per-skill license, replace platform-specific actions with real tools, produce drafts by default, and explicitly stop for missing/revoked sources. Their pack requires deployment `SKILL_STARTER_PACK_ROOT` and existing import/pin flow; not automatically installed for all users. Pack validation is not a real-model G-SKILL evaluation.

## Executed commands and boundaries

From repository root:

```sh
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/agent-runtime/standard-context-source.test.ts tests/chat/l3-retrieval-permission-scope.test.ts
apps/deep-agent-service/.venv/bin/python -m pytest apps/deep-agent-service/tests/test_standard_context_tools.py -q
pnpm --filter @repo/contracts exec vitest run tests/standard-context-tools.test.ts
pnpm --filter @repo/api exec tsc --noEmit
node apps/api/scripts/lint-permission-paths.mjs
pnpm exec tsx skills/standard-context/scripts/build.ts
pnpm exec tsx skills/standard-context/scripts/verify.ts
pnpm --filter @repo/contracts exec tsx scripts/generate-standard-context-schema.ts --check
```

`source-first.txt`: first four actual PG/FsObjectStore tests. `http-first.txt`: 13 passed (five new + eight existing retrieval scope regressions), including actual createApp HTTP/run authority, private parent revocation, wrong lease/org/key/user args, project list and overview equality to canonical HTTP. Later source-key guard and bounded object fault cases require final rerun recorded separately; first logs are not evidence for later changes. Fault cases use explicit ObjectStore test doubles to simulate missing/invalid/oversize storage; success tests use real immutable FsObjectStore. No paid/live model or UI E2E is claimed. Each wrapper cleans its isolated DB; no standalone service is retained.

Final verification: `final-api.txt` **14/14 passed** (six W07 + eight legacy scope), including the producer-key guard and source fault cases after their final edits. `python.txt` 7 passed; `contracts.txt` 2 passed; `typecheck.txt` exit 0 (empty output); `permission-lint.txt` green; `skill-pack.txt` four skills/sixteen exact files verified; `schema-check.txt` exit 0. Root independently reviewed source/controller/Skills and found no blocker for this deliberately restricted implementation; the full-org/five-route gap remains open. Final wrapper released its isolated database.
