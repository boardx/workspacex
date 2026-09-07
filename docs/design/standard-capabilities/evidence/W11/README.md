# W11 versioned canvas adapter

WX-T029 `wx_canvas_read`, WX-T030 `wx_canvas_update`, WX-S012 `diagram-and-canvas`.

## Reuse and behavior

The tools reuse existing `getCanvasSource`, `renderCanvas`, `updateCanvasSource` and the existing PG canvas instance/version repository. No second Fabric/Mermaid parser, version table, event source or renderer. Read returns the source, real immutable version/revision/hash and existing render-source projection for **the same version**, even if the head advances. The server projection is not a rendered screenshot or a full DiagramModel.

Update supports only `replace-source`, using the existing SQL compare-and-swap on `expectedHeadVersion`. Stable idempotency key binds tenant, real requester and canvas to a deterministic version ID. Same key/different content or expectedRevision fails with conflict. Concurrent identical requests converge on the same stored version. A known completed immutable version can resolve acknowledgement loss; no second write or blind retry is issued.

The existing write group predicate was narrowly extracted to `authorizeCanvasSourceUpdate`; original update and adapter replay both reuse it. Original cross-group read remains valid, while moved-group write/replay is refused. Tool authority is checked using actual run/attempt/lease/toolCallId/args; the requester is resolved from the run. Read is shared L0, update retains L2 authorization. Parent/source membership checks still apply. This check-time authority does not promise remote cancellation of a write already in flight.

Python uses actual LangChain StructuredTool and the generated shared JSON schema, passes trusted runtime identity, bounds response bytes/deadline, rejects redirects/errors and exposes no credentials in model arguments/errors. Unknown or conflicted outcomes are not success. Root integrates factory/profile/kernel and excludes StandardCanvasError from retry middleware.

S012 is a complete three-file existing starter-pack method, preserving IDs/template keys, source coordinates boundary, CAS/conflict workflow and honest render/export limitations. Deployment requires `SKILL_STARTER_PACK_ROOT` and normal import/pin flow. No paid-model G-SKILL, browser screenshot, file export or all-users rollout is claimed.

## Verification commands

```sh
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/agent-runtime/standard-canvas-tools.test.ts tests/canvas/instance-source-chain-http.test.ts
apps/deep-agent-service/.venv/bin/python -m pytest apps/deep-agent-service/tests/test_standard_canvas_tools.py -q
pnpm --filter @repo/contracts exec vitest run tests/standard-canvas-tools.test.ts
pnpm --filter @repo/api exec tsc --noEmit
node apps/api/scripts/lint-permission-paths.mjs
pnpm exec tsx skills/standard-canvas/scripts/build.ts
pnpm exec tsx skills/standard-canvas/scripts/verify.ts
pnpm --filter @repo/contracts exec tsx scripts/generate-standard-canvas-schema.ts --check
```

Python six, contracts two, actual starter-source three files, typecheck and permission lint passed in adjacent logs. API new/legacy tests currently pending; `api-first.txt` is the live captured output and is not a success assertion until its completion is recorded below. The lost-ack test uses real PG append followed by an explicit simulated exception; it is not a network outage claim.

Final API result: `api-first.txt` **19/19 passed** (three new actual HTTP/PG tests plus sixteen existing instance source-chain regressions). New tests verify canonical source/render equality, real L2 denial before authorization, current lease/tenant checks, one durable version for simultaneous same-key updates, payload/revision conflicts, moved-group replay denial with preserved cross-group read, membership withdrawal and durable acknowledgement-loss resolution with only one append. Runtime was 3m34s under elevated host load; no timeout was widened. Wrapper cleanup completed (8s), database slot released. No renderer/browser or real-model verification is implied.

Independent review fix: Python now projects HTTP 409 to the fixed safe `StandardCanvasError('canvas_revision_or_idempotency_conflict')`, without parsing or exposing the remote body. Other failures remain generic and non-retryable. The actual StructuredTool coroutine with HTTP MockTransport failed before the fix (`conflict-before.txt`: 1 failed) and all seven Python tests passed after (`python.txt`). This is transport/error projection verification, not a new PG concurrency run; the existing actual HTTP/PG 409 tests remain in the 19 passing API group.
