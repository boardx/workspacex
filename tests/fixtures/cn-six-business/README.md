# T22 complete-application fixture (not yet Linux verified)

This independent lane reuses the existing chat-read application stack: real Next
**development server**, actual Nest `startApi`, full PostgreSQL migrations and
real Chromium. It does not replace these with static HTML. The API launcher
refuses shared infrastructure and any database other than the isolation wrapper's
`wsx_<20 hex>` database on loopback. It inserts synthetic feedback and grants the
existing synthetic fixture user the admin role in that new database only.

The six discovered tests cover login, hello, microphone/ASR, skill-content
propagation, authenticated GitHub-feedback status, and a persisted PDF run with
actual download magic. Voice and PDF reuse the original browser test files;
no success booleans or intercepted browser responses are injected. PDF tooling
and model behavior still use the existing deterministic provider fixtures.

External boundaries are **model, deep-agent, ASR, skill execution and GitHub
protocol fixtures**, not real model quality, remote ASR, Docker sandbox isolation
or GitHub service acceptance. The new GitHub transport maps only the synthetic
repository's issue-status/timeline GETs to an actual loopback HTTP server; the
application's original GitHub parser, feedback use case, auth and database path
remain in use. Non-loopback HTTP fetches are refused. No real external credential
is required or supplied. This is not a production build/production deployment
acceptance, and it must not set any production six-journey receipt.

Run only on the GitHub isolated Linux runner after frozen dependencies and its
reviewed Linux browser/immutable image setup. The outer owner must supply a new
root-private `/var/lib/.../infra.json` via `CN_SIX_INFRA_RECEIPT`. It owns exactly
two immutable image-ID containers, unique labels and a fresh database; no
floating tags, implicit builds, network objects or persistent Docker volumes.
The fixture does not run Compose, create containers, create the database or
remove any project. Its preflight only reads the private receipt and Docker
inspect, verifying exact container IDs/image IDs/name/labels, host networking,
explicit loopback listen commands with `shared_preload_libraries=age`, and absence of persistent mounts. Before any inspection or connection it requires explicit `PGHOST=127.0.0.1` and the exact isolated database. Before migrate/seed, a read-only SQL query verifies the actual database name, server loopback address/port and AGE preload setting. Separate 5-second connection, server statement and client protocol-response timeouts apply; these are not a 5-second total wall-clock guarantee. Outer process supervision must also bound teardown if the protocol or `client.end()` stalls.

The outer receipt is `cn-six-infra-v1` and binds `ownerToken`, `project`,
`dbName`, `runId`, `roundId`, `sourceCommit`, and `postgres`/`redis` records
with `containerId,imageId,containerName,port,command`. Caller env binds
`GITHUB_RUN_ID,CN_SIX_ROUND_ID,CN_SIX_SOURCE_COMMIT,COMPOSE_PROJECT_NAME`,
`WORKSPACEX_DB,PGDATABASE,PGPORT,REDIS_PORT`, plus the original app/provider
port allocation. The outer owner creates the database before receipt issuance.
It must retain create intents and evidence on unknown outcomes and reconcile only
its own exact resources after timeout/SIGKILL. Empty listings cannot substitute
for terminal creation knowledge. Other projects are never cleanup targets.

After outer setup/readback, run from the repo:

```sh
CN_RELEASE_FULLSTACK_FIXTURE=1 pnpm --filter web exec playwright test --config playwright.cn-six-business.config.ts
```

Do not wrap this command in the original `with-test-isolation.ts`, whose Compose
teardown belongs to a different ownership protocol. The outer may reuse its
pure port reservation library. Setup and cleanup are included in total time.
The configuration has zero retries and a 20-minute whole-test budget; this is a
limit, not measured performance. Missing capabilities fail rather than skip.

**Network scope:** the local fetch restriction applies only to Nest's global
HTTP fetch transport. It does not isolate Next, Chromium, WebSocket clients,
other Node network APIs or the host network. Whole-stack zero egress has not
been proved. All named external providers are explicitly loopback; no real
external credential is passed. GitHub setup owns any permitted dependency/image
downloads before the test.

Evidence is the actual Playwright JSON report at
`apps/web/test-results/cn-six-business.json` plus application/provider logs.
A consumer requires exactly six passing tests, zero skips, no unexpected tests,
and the outer's verified cleanup. Hello/skill additionally parse their exact
SSE run ID, independently read persisted success/resultMessageId, reload and
read again; skill checks paired successful tool ledger results and rendered
skill-content sentinel. PDF retains its original durable-run assertions.

Authoring evidence: the real Playwright loader discovered six tests in three
source files; web typecheck and actual loopback HTTP boundary tests passed.
The updated whole stack has not run on Linux. T22 remains open until complete
execution, report checks and cleanup pass; discovery is not E2E acceptance.

The fixed Next launcher now caps only its Node child heap at 2048 MiB and
rejects inherited conflicting `NODE_OPTIONS`. This leaves part of the unchanged
6 GiB simulation Unit for Nest, Chromium and native allocations; the spare
capacity is a planning allocation, not a per-component reservation or measured
acceptance. Next 14 otherwise defaults to half of host RAM, which can exceed
this Unit's limit. No retries, warmup deadline, business cases or cleanup gates
change. The fixed preload observes only Next's installed `start-server` fork,
retains its original arguments and restart behavior, and saves bounded typed
worker PID/start ticks, cgroup identity, heap option and exit signal receipts.
The first real worker also records V8's actual heap-size limit. Missing receipts
remain unknown. A signal alone does not prove an OOM victim; relate its timing
to warmup/cleanup and the independently observed Unit counters. All six business
journeys and owned cleanup must pass on Linux before calling this fix accepted.

The 2048 MiB candidate follows run 38349940522: the bound Next worker had
about 2.56 GB heap used and 2.35 GB ArrayBuffers before the 6 GiB Unit OOM.
Earlier GC might release short-lived buffers; it might instead expose a real
JavaScript heap exhaustion. Buffer lifetime has not been proven, and this is
not a root-cause fix claim. The previous run completed all owned cleanup.
The actual worker heap receipt, bounded memory samples and original six Linux
journeys must verify this candidate before acceptance. No Unit limit, source,
timeout, business assertion or cleanup gate is relaxed.

Compiler diagnostics keep the 2048 MiB candidate and original resource and
business gates unchanged. Only connected dev fixtures attach hooks. Per fixed
client/server/edge identity, six records are reserved for cumulative actual
buildModule callback milestones 1/512/1024/2048/4096/8192. Two separate records
are reserved for afterCompile and afterDone, once each, only with an available
module Set.size >=1024. Small or empty completions cannot spend either quota.
All records still share eight per compiler and 24 total. Build counts persist
across compilations and cap at 16384 (that maximum is a lower bound thereafter);
moduleCount remains the separately observed Set.size. At most six plugin
instances, 16 compilations per identity and 64 skipped small completions are
observed. No module path/source/buffer/stats or heap dump is requested.

Run 38355123654 showed the initial 717/824-module compiles consumed the previous
event budget before later heap growth. Real installed-webpack counterexamples
now complete two small compiles and prove later 2048/4096 build callbacks still
emit, with both large completion slots independent. Collector validation binds
PID, exact numeric shape, phase enum, each category's quota, ordered milestone
index, monotonic time/callback/skip counters and global event sequence. The full
worst-case worker envelope including memory latest/peaks remains under 16 KiB.

The launcher classifies only fixed ASCII fatal markers across stderr chunks;
it retains booleans/counts and the existing streaming stderr hash, not raw
stderr. SIGABRT alone remains insufficient to prove JavaScript heap OOM.
All six actual Linux journeys and owned cleanup must pass before acceptance.

Existing phase packets also carry nine fixed-position package callback counts:
mermaid, fabric-markdown, copilotkit, monaco, codemirror, mui, other third-party,
other local and unknown. Classification reads only an own string resource data
property (never a getter), at most 4096 characters, normalizes Windows separators
and ignores a query suffix before matching the final node_modules package. No
resource text, module name, source, identifier or stats is retained or sent.
Counters are cumulative actual build callbacks across compilations, not unique
modules or currently retained module totals. Repeated resources count repeatedly;
unknown resources have their own bucket. Each packet's nine nonnegative bounded
integers sum to buildModuleCallbacks, and collector checks every bucket is
monotonic. No extra IPC event or resource/business budget is introduced. Counts
identify graph composition only; they do not attribute any Buffer allocation
or prove that a particular package caused the heap OOM.

## Single-round production artifact experiment

`production-single` is an explicit one-round, one-worker `linux-six-business` mode. It builds the same checked-out SHA using that round's fresh dynamic web/API ports, then starts the verified standalone web closure. API seeding, authentication, the six journey titles, zero retries, and the 300-second business warmup remain unchanged. Cross-round build reuse is not implemented.

Build uses its own owned Domain with a 900-second deadline, a 2048 MiB Node heap, and the existing 6 GiB Unit. Application remains 1200 seconds; prepare/cleanup remain 120/90 seconds. Only this experiment has a 2400-second outer suite ceiling. These are experiment ceilings, not evidence that release completes in 30 minutes.

Scratch, sealed original, and exclusive runtime each have a 2 GiB local bound (6 GiB combined); formal image/save/archive limits are unchanged. Copy bounds are enforced before copying. Scratch and runtime are sampled via anchored directory descriptors with traversal deadlines; sampled peaks do not establish a hard filesystem quota or capture every transient peak.

Source/tree, lock/config/fixture inputs, controlled compile environment, every artifact byte, directories and executable bits are bound to the private manifest. The original is sealed read-only; runtime has an independent copy. Build and verification Domains must all be proved empty before Docker or lease disposal. Unknown cleanup fails and leaves recovery to the independently empty outer Unit. Export contains only bounded summaries, cleanup and digests; no private manifest table, build environment or build log is uploaded.
