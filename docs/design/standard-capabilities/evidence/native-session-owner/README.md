# E004 persistent native session owner component

Commands from worktree root:
```
node --import tsx packages/contracts/scripts/generate-native-session-binding-schema.ts --check
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/agent-runtime/native-session-owner-real-db.test.ts tests/agent-runtime/native-session-transport.test.ts
pnpm --filter @repo/api exec tsc --noEmit
```
Test command exit 0: 2 files, 9 tests. Actual isolated PG uses PgParentRunControlReader for active/attempt/lease validation, stores AES-256-GCM encrypted token bound with org/run/binding/session AAD, and verifies restart reuse, expiry refusal, cross-org refusal, stale epoch/attempt refusal, failed DELETE preventing resolution, confirmed/idempotent release, unknown creation without replay, twice-replayed migration and FORCE RLS. Transport create/delete uses an actual UDS HTTP server fixture. Controller authentication/strict-body/error sanitation is a direct controller test, not HTTP E2E. Fixture transport is not sandbox isolation evidence.

Configuration: NATIVE_SESSION_SOCKET is server-selected UDS; NATIVE_SESSION_BINDING_KEY is a dedicated 32-byte lowercase hexadecimal AES key. Missing configuration keeps owner DI null; malformed key fails configured startup. Existing DEEP_AGENT_SERVICE_INTERNAL_KEY authenticates resolve. Configurable native_runtime carries only bindingId/profile/policy. Resolver returns token solely to trusted Python infrastructure. No vault reuse and no token in graph identity.

Provisioning reserves unique org/run before external creation. A crash/unknown result leaves provisioning/failed and rejects another create; a possible orphan relies on session TTL. Expired sessions never regenerate on resolve. Release_pending blocks resolution; confirmed DELETE clears stored token. Parent deletion cascades binding metadata; physical session cleanup remains TTL if terminal hook was not observed. Terminal invocation and native remote-thread identity are root integration scope; this component alone does not claim them deployed.

Shared package-set digest sorts ASCII stableName tuples [stableName,skillId,versionId,packageDigest], each package digest reuses canonicalSkillPackageManifest. Generated artifact includes algorithm version and Unicode fixture golden. ToolAuthorityReader accepts ExecutionAuthorityContext with optional toolName for lease-only consumers; native owner does not invent a tool name or consume one-time approval.

Initial seed failures (missing ended_at and restrictive cleanup FK) were corrected before the passing run. No production data or existing main-run status semantics were changed. The migration also adds nullable remote_thread_id at root integrator request.

## Independent-review corrections

The final PG/UDS suite now passes 9 tests, including cancellation between create and ready (authority is rechecked), an injected ready-write failure after known creation, and failed compensation retaining encrypted release_pending credentials. Known sessions are physically destroyed on setup failure; unknown create outcomes still never replay.

Actual SessionManager + real UDS transport verifies a DELETE whose resource cleanup succeeded but HTTP response was lost, followed by duplicate/concurrent DELETE. Only the same token hash may retrieve the confirmation; wrong tokens remain 404. A bounded tombstone registry retains the shared cleanup promise through original TTL. Total live/creating/tombstone capacity is bounded by existing maxSessions * maxExecutionsPerSession; no unexpired proof is evicted. Expired settled tombstones are reaped. A failure after TTL or service restart is still unconfirmed, not blindly treated as deletion.

`pnpm --filter @repo/skill-sandbox exec vitest run tests/session-manager.test.ts` passes 13 tests, including expiry/reap and capacity counterexamples (capacity metadata is injected in the test, not 2048 real containers). This remains source/UDS component evidence, not a newly built production container image.

## Native recovery profile

`runtime_profile` defaults to legacy and is set to native-v1 in the same transaction that marks the binding ready. PgRunRecovery passes this persisted value as the fifth reconciler argument alongside the actual remote_thread_id. Only native-v1 bypasses the legacy script-candidate guard (which otherwise treats every tool text as a candidate); no execution is replayed.

Command: `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/agent-runtime/native-session-owner-real-db.test.ts tests/agent-run/run-recovery-unit.test.ts` — exit 0, 15 tests across 2 files; raw recovery-tests.txt. Real PG confirms profile publication and recovery forwarding; unit HTTP fixture confirms native ordinary tool text recovery and unchanged legacy refusal. Output staging remains a separate integration step.

`releaseForRun(orgId, runId)` is an internal trusted lifecycle port. It resolves the tenant/run binding and calls the same authenticated release operation; a missing binding throws unavailable. The two-file owner/transport suite passes 10 tests after adding this route, including successful repeat release and unknown-run rejection; see release-for-run-tests.txt. No public HTTP release endpoint was added.

## Recovery staging and terminal cleanup

`pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/agent-runtime/native-session-owner-real-db.test.ts` exits 0 with 12 tests; recovery-staging-tests.txt. Five new cases use actual PgRunRecovery, PgAgentRunRepository, PgNativeOutputStaging and isolated PG. A seeded staged RunOutputFile survives recovery into model_output_files/writeback_pending; the stager has no usable sandbox/object ports, proving this path only reads its persistent metadata. Missing stager stays running/uncertain, fifth uncertain attempt fails and calls releaseForRun, paused/approval do not release. Remote result is a controlled fixture; this does not claim live model execution or object-byte validation, which belong to staging's separate tests.
