# W02 native original attachment inputs

The owner derives the current run's original human message, author and thread on the
server. It checks current membership/thread visibility with existing resolveVisibility
before attachment metadata or bytes are read. It verifies ObjectStore head, actual byte
size, canonical Base64 and SHA256. The existing native binding stores an immutable
manifest/digest, not object keys or source bytes. Re-provisioning after source changes
fails; resolving an existing session retains its original snapshot. Legacy empty-input
calls remain compatible. Production DI supplies the real reader.

Original filenames are metadata only. Actual paths are deterministic ASCII names under
`/inputs/<SHA256 attachmentId>/`. The sandbox mounts `/inputs` read-only; only `/workspace`
accepts writes. The factory advertises actual paths and instructs copying before editing.
No Docker isolation, resource limit, main-run lifecycle or legacy execution change exists.

## Verification and evidence

The two new session tests initially failed: `/inputs` reads returned INVALID_SESSION_PATH
and supplied input files were silently ignored. After implementation the four session test
files passed 27 tests. The real container test additionally proved DOCX/CSV reads, workspace
copies, OS-level original write/unlink rejection and unchanged SHA256 (container.txt).

`source-auth-final.txt` is the final authoritative DB run: owner/output 14/14 plus native
fullchain 1/1 passed after the source-visibility review fix. It tests membership removal,
private owner change, source loss/oversize/same-size corruption, restart and fixed bindings.
The earlier `db-first-run.txt` preserves a test-fixture failure: a guessed filesystem object
path was a directory. The fixture now uses the existing resolveObjectPath helper.

The fullchain uses the real uploadAttachment application, real identity/chat repositories,
FsObjectStore, PG metadata, UDS, official Python factory, isolated execution and artifact
writeback. Attachment linking to the input message is fixture SQL; this is not a browser
or multipart HTTP upload test. Scripted model responses assert verified paths in the actual
model system prompt, then read DOCX text and CSV sum 50, reject original writes/deletes,
verify unchanged hashes and complete the existing output writeback exactly once.

```sh
pnpm --filter @repo/skill-sandbox exec vitest run tests/session-inputs.test.ts tests/session-manager.test.ts tests/session-paths.test.ts tests/session-http.test.ts
pnpm --filter @repo/contracts exec vitest run tests/sandbox-session.test.ts tests/native-input-binding.test.ts
node --test apps/api/scripts/tests/workbench-repository-boundary.test.mjs
pnpm --filter @repo/api typecheck
WX_NATIVE_SANDBOX_CONTAINER=wx-native-inputs-skill-sandbox-sessions-1 pnpm exec tsx .harness/scripts/with-test-isolation.ts -- bash -ec 'pnpm --filter @repo/api exec vitest run tests/agent-runtime/native-session-owner-real-db.test.ts tests/agent-runtime/native-output-staging-real-db.test.ts
pnpm --filter @repo/api exec vitest run --config vitest.native-chain.config.ts tests/agent-runtime/native-full-chain.test.ts'
docker build -t workspacex-skill-sandbox:w02-inputs apps/skill-sandbox
docker exec -i wx-native-inputs-skill-sandbox-sessions-1 node --input-type=module < apps/skill-sandbox/tests/session-inputs-container.mjs
```

Contracts passed 5 tests; precise permission-boundary checks passed 49 tests. API typecheck
passed. The captured full API lint passed its permission checks then stopped at peer-owned
register-run-artifacts.ts stepId naming findings, assigned to root. Sandbox-wide typecheck
retains unrelated tests/input-files.test.ts import-extension failures; actual image TS build
succeeded. The independent w02-inputs image tag did not overwrite other test images.
The wrapper cleaned its DB stack; the wx-native-inputs container and volume were explicitly
removed when this task resumed after interruption. No task resources remain running.

## Limits and remaining boundaries

Count/per-file size reuse sandbox-session limits (256 / 8 MiB). Combined skills and inputs
must fit the existing 24 MiB serialized transport budget, not a new product storage quota.
ObjectStore get returns a whole buffer; head plus post-read size checks do not constitute
a streaming byte limit. Attachments have no prior content digest on first read: the owner
computes the initial digest from actual bytes, then compares future bindings against it.
Source revocation prevents new reads/provisioning; previously disclosed model context is
not erased. This task does not redesign ongoing parent dispatch/cancellation authority.
No passing feature or production deployment is claimed solely from these tests.

## Changed files owned by this task

- packages/contracts/src/{sandbox-session,native-session-binding}.ts and tests/native-input-binding.test.ts
- generated sandbox-session-schema.json (sandbox) and sandbox_session_schema.json/native_session_binding_schema.json (Python)
- apps/skill-sandbox/src/session/{http,manager,paths,provider}.ts
- apps/skill-sandbox/tests/session-inputs.test.ts and session-inputs-container.mjs
- apps/api/src/application/agent-run/{native-run-inputs,native-session-owner}.ts
- apps/api/src/infrastructure/agent-run/{pg-native-run-inputs,pg-native-session-owner,native-session-transport}.ts
- apps/api/migrations/20260909030000_native_session_inputs.sql
- apps/api/scripts/lib/workbench-repository-boundary.mjs and its tests/workbench-repository-boundary.test.mjs
- apps/api/tests/agent-runtime/{native-session-owner-real-db,native-output-staging-real-db,native-full-chain}.test.ts
- apps/deep-agent-service/tests/native_full_chain_runner.py
- this evidence directory

Root owns the corresponding kernel constructor injection and Python factory prompt wiring.
