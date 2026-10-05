# Step 7 — core browser / CAS / open / observe

## Source backlog and boundaries

The existing `cn-maintenance-browser.cjs` executes six real journeys (login,
hello, ASR, GitHub feedback read, skill/tool and PDF download). The existing
canonical consumer requires eight stages while retaining the canonical lock.
The A-route adapter owns hold generation/device/inode/hash CAS clear and readback.
`cn_maintenance_hold.py` gates ordinary release admission, not HTTP routing;
therefore public acceptance after candidate writer resume and before hold clear
remains valid. Do not move browser before writer resume or fake real providers.

New `public_acceptance.ts` composes those consumers, checks public candidate
identity before and after browser work, and separately checks opened-candidate
observations. Root integration must call `observeOpenedCandidate(identity)` after
`clearAndVerifyMaintenanceHold` readback, while retaining the release lock. An
observation failure requires reacquiring/verifying hold and blocking candidate
writers, then recovery/reconciliation according to A-route; never resume baseline
runtime after possibly committed migration.

## Inputs and outputs

Inputs: exact maintenance identity, deployment marker, bounded sample count
(2–60), outstanding-run bound, and four compiled transport callbacks. Callbacks
must produce independently collected identity, canonical, browser and observation
results. Observation includes exact identity, marker, hold absent, queue/running/
writeback counts, zero failed owned runs and zero unhealthy services. No production
transport or execution authorization is supplied by this package.

Outputs: fulfilled promises only after all strict schemas and identity checks
pass; rejection otherwise. The adapter never performs pointer promotion, hold
clear, browser interception, restore, provider substitution or traffic mutation.
Sample pacing and time-window evidence belong to the host transport: immediate
mock samples prove schema/order only and are not production observation evidence.

## Idempotency, failure and rollback

Repeated acceptance reruns fresh evidence; callback implementations and policy
are snapshotted before reads. Caller identity changes reject before I/O. Partial
browser booleans, canonical lock loss, changed deployment identity, held traffic,
unhealthy services, failed owned runs or exceeding the configured backlog reject.
The adapter has no rollback authority; A-route owns stop/re-hold/recovery and must
keep unknown writer state locked. Never interpret rejection as rollback proof.

## Local evidence

`pnpm exec vitest run packages/cloud-deploy/src/cn-maintenance-host/public_acceptance.test.ts --maxWorkers=1 --minWorkers=1`
passed 6 tests, exit 0 (2026-10-04 UTC). All transports were local mocks; no browser,
model request, image build/push, production SQL, host installation or switch ran.

Final review added `public_acceptance_clear_unknown_test.ts`: two local A-route
regressions for clear committed with response/readback loss require candidate stop
attempt despite hold read failure and retained lock. Root owns the shared catch fix.
Default production consumers still reject activation capability and do not supply
`aRouteInputs`; adapter availability is not production transport readiness.

## Source-owned public/host observation transport

`public_observation_transport.ts` pins the exact APP 9b25/base ba63 maintenance
release and the two fixed public endpoints. A compiled reader must stamp local
observation times, enforce response bounds, disallow redirects/cache, and provide
actual host evidence. Fresh identity-bound cleared hold CAS metadata, safe queue
counts, nonempty unique successful owned runs and four actual healthy services
are mandatory. Retained host/socket observation runs first and cannot be replaced
by public samples. Derived zero failure counts follow these validated records;
there is no plan boolean or zero-default admission. Marker maps to source through
the reviewed binding; endpoints themselves do not establish a source revision.

Five local Vitest tests pass; public/host readers remain compiled dependencies,
not an assertion of available production transport. No network or model ran.

## Fixed public JSON reader and remaining actual operations

`fixed_public_json_reader.ts` implements fixed HTTPS public endpoint requests
with no redirects/cache/credentials, bounded streamed UTF-8 JSON object responses,
and a single fetch/body time budget with abort and stream cancellation. Three
reader tests plus six public-observation tests pass using injected local Response
objects. Observation now verifies retained host state before and after public
samples; final retained failure rejects even when both public endpoints pass.

An actual opened host evidence operation is still absent: existing
`readRunDrain` requires `writesHeld=true`; `candidateOperation('observe-opened')`
returns validated operation summary, not the actual queue/owned-runs/services
record required here. Bind that operation to both retained checks, but do not
relabel it as `readHostEvidence` or use zero defaults. Source-owned host producer
must collect the missing actual fields before production factory can bind this
transport. Public reader implementation is complete; host producer is a blocker.

## Fixed APP services and source-owned acceptance receipts

`opened_service_health.py` runs a fixed read-only Docker exec Node probe inside
the already identity-bound API container: web marker at service `web:3000`, local
API `/healthz` at `127.0.0.1:3200`, agent `/healthz` at `agent:8000`, sandbox
`/healthz` through `/run/sandbox/skill-sandbox.sock`. These routes exist in APP 9b;
there is no Docker Health requirement, Running-to-healthy conversion, model run,
new DB connection or Compose change. Actual responses generate service health
evidence; missing endpoint/network/socket rejects. Each health HTTP request has
a 5s timeout and 64KiB response bound.

`acceptance_receipt_producer.cjs` wraps the existing real six-journey browser
source and extracts the three actual finished SSE run IDs matched against the
same persisted successful reads. It never accepts a supplied passed object.
`canonical_acceptance_receipt.py` invokes existing eight-stage canonical source.
Canonical read-only checks produce no runs: canonical IDs must be empty; browser
IDs must be nonempty. `acceptance_receipt_store.py` is only protected fsync/hash
storage, not an evidence verifier. Root must wire browser fixed launcher and
receipt publishing into actual admission; the real source was not executed here.

Raw local mock log: `/tmp/step7-source-tests.log`, UTC 2026-10-04T17:38:11.581002
through 17:38:11.974682, HEAD c0ec7a078d7eb826c65de96e0279d485890499a5 plus
uncommitted independent producer changes. Opened producer 4, services 3, browser
extraction 2 and clear-unknown 2 tests passed. These are source/transport tests,
not business acceptance. Root owns test-page screenshot and Library upload.

## Candidate browser entry and fixed command authority

candidate_browser_acceptance.py exports
persist_candidate_browser_receipt(transport,data). Data is exact identity,
browserPlan hashref and profile-bound nodeBinary. Existing retained transport
identity/lock/guard is checked before and after. The entry reuses compiled
maintenance activation protected/source/pinned Node helpers, checks actual
Playwright closure, audio and Chromium, then executes profile-pinned
acceptance_source_closure.cjs once. That closure compiles the real browser and
receipt extractor; there is no second six-journey execution, legacy container
layout, new DB client or supplied passed input. Strict result has three actual
persisted SSE IDs, six journey proofs, same marker/identity and fresh timestamp.
Only then does immutable protected receipt storage publish a FactoryRef.

candidate_readonly_docker.py owns fixed health source and both readiness scripts
plus network inspect. Canonical and opened services use its pinned binary FD
invocation, actual socket/profile before-and-after checks and fixed offline socket
configuration. Raw Docker exec is removed. Four helper, four browser entry, six
canonical, four opened evidence and three health local mock tests passed; source
Python compile passed. Dependency/source producer fixtures are explicitly mocked
and prove wiring/failure handling, not real provider/business acceptance. Latest
raw output with full HEAD and UTC range is appended to /tmp/step7-source-tests.log.
