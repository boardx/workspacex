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
passed 5 tests, exit 0 (2026-10-04 UTC). All transports were local mocks; no browser,
model request, image build/push, production SQL, host installation or switch ran.
