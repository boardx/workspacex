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
