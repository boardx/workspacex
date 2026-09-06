# Bound UDS file producer

Command (worktree root):
```
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/agent-runtime/native-session-files.test.ts
```
Exit 0, 9 tests passed; raw output: native-session-files.txt. Standard isolation wrapper cleaned its resources. Initial bare Vitest attempt was refused by isolation setup before running tests; the first wrapper attempt hit local IPC EPERM, then the approved socket-capable execution above passed.

Real Node UDS server exercises bound Bearer/session route, encoded Unicode path, collector exact binary object write/readback, non-200 (including redirect) refusal without retries, invalid JSON, response size bound, and wall-clock timeout. The object store is a test memory implementation. This is real transport/component verification, not real sandbox isolation or production object storage acceptance.

Service source inspection: apps/skill-sandbox/src/session/manager.ts get() validates session/token; safe path resolution rejects symlinks/non-files/hardlinks and out-of-root paths; read() rejects directories. This adapter delegates those checks to the service and never supplies identity from read(path). Existing E003 service isolation evidence remains separate; it was not rerun here.

No session creation/destruction, event/attachment writes, main-run lifecycle or production factory wiring is introduced. Credentials remain captured in closure and transport errors contain only fixed messages.
