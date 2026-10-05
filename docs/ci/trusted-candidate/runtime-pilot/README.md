# Isolated execution measurements, still shadow

This follow-up depends on draft PR #5400 at `9225b28b17f634185e795469898b2385546f0284`. It does not change that PR's acceptance boundary or activate reuse. Every existing suite, required check, deployment gate and production check continues to execute. `skip=false` and `runFull=true` remain unconditional.

## What this measures

The new controller runs one fixed, dependency-free Node suite in an isolated container. Protected policy fixes its command, two entry-point Git blob identities, immutable single-platform OCI reference and limits. The controller materializes the entire Git tree directly from objects, then independently compares filesystem bytes, types, modes and closed relative symlinks with that tree. No candidate configuration, install hook or discovery script executes on the host.

The candidate receives read-only source and a limited scratch filesystem. It receives no Docker socket, host HOME/tools, token, secret, host network/IPC/PID namespace or writable controller/output directory. The controller inspects the actual image, container configuration and terminal state, captures bounded output as untrusted bytes and hashes its own receipt. Candidate output is never a workflow command or an authority document. TAP counts are diagnostic; output cannot assert protected execution or authorize reuse.

The source probe separately reports actual input hashes and incomplete inputs. Its `complete` field describes metadata measurement; `verified=false` and `eligible=false` always distinguish it from execution authority. The runtime collector likewise separates actual structure and execution constraints from independently verified protected-supervisor identity. A locally valid isolated execution remains a local measurement.

Actual native ARM local execution passed 49/49 tests with no Docker skips. The fixed core entry point exited zero and reported 175 tests. The entire 17,875-blob source tree (802,478,662 bytes) was materialized and measured. Actual container resource observations before and after execution agree on 512 MiB memory/swap, 128 processes, no automatic removal and no restart. Independent attack runs cover read-only source, no network/socket, forged evidence, fake successful TAP with a failing exit, timeout, oversized output and SIGTERM cleanup. All owned containers and input directories were removed.

The production policy remains the pinned AMD64 image. A separate AMD64-on-ARM run passed its 47 tests, but correctly left `proofComplete=false` because the external emulator bytes are outside the measured image. The native ARM profile is a temporary local test profile. These are local controller measurements, with protected identity and reuse authorization both false. [Local receipt summary](local-receipt-summary.json) records raw receipt digests, measured inputs, terminal state, outputs and controller source byte digests; the full rootfs archive is discarded after measurement.

## Historical rereads

The existing shadow adapter now brackets fresh source measurement with two full workflow-history snapshots. The snapshots include all advertised pages, latest attempts, current PR identity, jobs, numbered steps and artifact identity/digests. Source run and PR are also reread within each snapshot. A changed or unreadable fact, new failed run, older run rerun to failure, pagination shift or callback identity mismatch latches full execution. A retry adds diagnostics and cannot resurrect an older success.

Matching reads prove only `stableDuringRead`. They do not prevent a new run after the last read, ABA changes or eventual consistency. They are never an atomic lease. A future reuse decision needs one protected authority covering candidate updates, validation starts/reruns/cancellation and consumption, with an epoch/CAS fence held across the actual consumption point. Current read-only GitHub APIs do not provide that boundary.

## Independent completed-job consumption

The separate read-only observer authenticates a completed main-dispatch producer through GitHub APIs and matches the source controller's complete `.harness`, `.github` and root input definition closure with its own protected main checkout. It binds the run attempt, hosted job, successful supervisor step, artifact identity and API archive digest before treating JSON as controller data. A strict bounded ZIP reader uses Node builtins; it neither extracts files nor executes artifact content. JSON flags cannot create authority.

The consumer independently checks current candidate base/head, full Git tree and parents, original actual-checkout marker, latest source attempts and full history before and after component measurement. It binds the controller's pre-create/inspect/start/wait/post-inspect journal to the one actual GitHub supervisor step, checks measured resources and image/tool/source bytes, and hashes candidate output as untrusted bytes. A complete match can describe a scoped protected Node receipt; `protectedVerified=false`, `reuseAuthorized=false`, `skip=false` and `runFull=true` still apply to overall CI. Successful API/ZIP fixtures are not a real protected GitHub execution.

Enumeration is bounded and never silently truncated. More than the accepted history budget, incomplete pagination, missing artifacts/digests, expired receipts, permission loss, source changes, newer failed attempts or exceptions retain full execution. A read-only live API snapshot advertised **9,655** harness runs, exceeding the current 20-page/200-original-run limits. The real path currently falls back for this repository: merge approval alone does not remove this operational gap. A complete candidate-scoped history strategy remains in the backlog; no age filter or truncation was introduced to produce a passing example.

## Scope and remaining approvals

The pure Node suite is an execution-measurement pilot, not fullstack, backend, native, meeting or deployed login/core coverage. The existing coverage matrix in the parent PR remains applicable. Existing fullstack runs install candidate dependencies on the host and expose Docker socket, writable source/HOME and host namespaces. Recording more hashes after that execution does not establish a trusted supervisor.

The [36-job coverage matrix](../coverage-matrix.md) is unchanged. `full-regression-core`, chat-read, self-service-profile, Board native/meeting, actual deployment version/health/login/core and migration checks keep their existing execution. The new pilot and its read-only observer supply additional measurements; they cannot replace any row of that matrix.

The separate manual protected job can operate only after its definition/controller enter `main`. A PR/local run cannot supply protected authority. Merging #5400 or this follow-up would trigger the existing `backend-gates` main pipeline, including its automatic DevApp deployment when gates pass and the existing automatic CN preparation chain. Production's preparation and active SOP share host resources and a release lock; the release owner must verify serialization through that same host lock immediately before any approved action. GitHub concurrency does not cover host root commands. Neither merge nor deployment is authorized here; the protected-live step is blocked. The draft implementation and all independent local/PR tests continue.

The pilot uses existing `contents`, `actions` and `pull-requests` read permissions. No OIDC, attestations write, coordinator write, secret, branch-protection or deployment change is requested. Any future permission change requires separate approval.

Measured validation savings remain **zero**. The historical release sample's possible approximately 13-minute gate saving applies only to a future compatible exact-candidate path; it is not a measurement of this pilot and not a claim that all CI or the entire PR is halved.

See [backlog](backlog.md) for owners, acceptance and next actions; receipt files distinguish fixtures, actual local execution, PR CI and protected-live evidence.

The broader Mac harness run passed 2,967 tests and failed four unchanged shell fixtures; under `LC_ALL=C`, the real-model fixture's four tests pass in a targeted reread. The complete `verify:harness` entry also fails at an unchanged vocabulary-lint baseline. [Verification limits](verification-limits.json) preserves those failed commands and their scope. Focused results and later Linux PR CI must be reported separately; these failures are not hidden or converted into passes.
