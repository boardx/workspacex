# Wave 2 executable verification contract

These commands are the implementation completion contract. Some test files and
the `verify:full` journey runner do not exist yet; their absence is an expected
RED result, never a waiver or a healthy empty result. Child issues own the named
tests. Issue #387 owns the final journey runner.

## Contract packet gate (available now)

```bash
pnpm exec vitest run .harness/scripts/wave2-runtime-design.test.ts
```

Pass means the pending review packet is structurally complete and preserves its
hard boundaries. It does not mean a human approved it or product behavior exists.

## Child implementation gates

```bash
pnpm --filter @repo/api test -- tests/auth/email-verification-public.test.ts
pnpm --filter @repo/api test -- tests/chat/message-write-roundtrip.test.ts
pnpm --filter @repo/api test -- tests/skills/explicit-starter-import.test.ts
pnpm --filter @repo/api test -- tests/agents/explicit-agent-import.test.ts
pnpm --filter @repo/api test -- tests/agent-runtime/no-tool-run-writeback.test.ts
pnpm exec playwright test apps/web/e2e/wave2-runtime.spec.ts
```

The tests must assert, respectively:

1. registration commits a digest-only 24-hour challenge and mail outbox; public
   confirmation consumes once; invalid/expired responses do not enumerate users;
   mail failure remains observable and retryable;
2. POST requires `agentId`; missing/unknown/unpublished Agent returns `422` with
   zero message/run rows; a valid request persists one human message/run across
   identical retries, rejects changed payloads, resolves the exact published
   Agent/Skill/model snapshot, and paginates without duplicate or missing IDs;
3. a fresh production-shaped repository has zero Skills until an administrator
   explicitly imports a verified pack; import provenance, immutable files,
   conflict behavior, mounts, and idempotent retry are durable;
4. a fresh production-shaped repository has zero Agents until an administrator
   explicitly imports Skills and then a verified Agent pack; immutable versions,
   provenance, missing-Skill failure, conflicts, and retries are durable;
5. the fixed Agent/Skill/model snapshot performs exactly one no-tool model call,
   persists ordered steps, writes exactly one assistant message, and exposes
   explicit provider/writeback failure without fallback;
6. the browser completes registration confirmation, explicitly imports Skills
   then Agents, sends a Chat message to a required Agent, sees
   polling progress and the durable reply, and handles an expired link, provider
   failure, and import conflict visibly.

## Release-readiness gate

```bash
pnpm verify:full --journey wave2-runtime
./init.sh
```

The journey must start from isolated storage, capture a real mail link from the
configured staging transport, use the deployed-style HTTP/UI boundaries, inspect
durable state after process restart, and leave redacted artifacts. It fails on
missing mail credentials, unreachable provider, empty test discovery, shared-DB
contention, or any skipped assertion. A failure attributable to #74 remains a
failure with reproduced evidence; it is not verbally waived.
