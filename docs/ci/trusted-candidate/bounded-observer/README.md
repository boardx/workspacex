# Bounded observer correction

This increment is based on frozen `77700fe5f15eabb4ceeff2bd10a2eed59e2d7178`.
The three earlier shadow PRs stay unmerged. There is no new history index,
durable CAS, fullstack execution platform, permission, required check or reuse
activation. Every report retains `skip=false` and `runFull=true`.

Main discovery formerly called `githubPages` with its unrelated default 20-page
cap and omitted direct latest reads for listed attempt1. It now shares
`readCandidateWorkflowCatalog` and `readRelatedCandidateAttempts` with the
PR A/measurement/B reader. The policy remains an unfiltered observed API view:
100 pages / 10,000 advertised rows, with default200 related IDs. It is not a
complete historical index or an atomic lease. The generic `githubPages` default
for other bounded resources is unchanged.

The entire observer has one stricter operation budget, declared only in
`OBSERVATION_LIMITS`: **200 HTTP attempts, 90 seconds overall, 10 seconds per
request**. Redirects count and receive no Authorization header. Response body
reading and JSON parsing remain inside the request deadline; bodies are limited
to20MB. The first deadline also aborts a redirected transport. Limits cannot be
raised by workflow inputs/environment variables; lower limits are in-process
test seams. Budget exhaustion is latched across all suites and never recovers
using a late response. Source/PR/main consistency observations share that budget.

Both protected observer CLIs start the clock before Git bootstrap. Their read
steps have a3-minute timeout within the unchanged20/15-minute jobs, leaving
headroom for receipt output and `always()` upload. JSON and Markdown receipts
record total requests/elapsed, limits, request families, route timings and the
precise fallback reason. Metrics contain no token, signed URL, query value or
execution authority. Nested redirect timings overlap; their sum is not total
observer wall time.
Route `completed` means the read function returned, not that candidate validation
passed; the returned report's reasons and authority flags remain decisive.

The mock main2,501-row candidate on page26 reproduces the old failure after20
pages. With the shared reader and default200 budget it can finish130 supplied
API calls and still falls back `runtime_not_attested`; its manifest is metadata.
The lower80-request variant completes26-page discovery and then explicitly
falls back during consistency measurement, with no manifest. These are mock
success/refusal paths, not live catalog/protected-main execution or speed gains.
Unknown/multiple associations, foreign rows even on noneligible events,
unrelated catalog state changes, stale latest/exact attempts, pagination drift,
>10,000 advertised rows, HTTP/read errors and all budget failures retain full
execution. Unrelated state changes are deliberately conservative fallbacks.

One bounded read-only Node sample requested only pages1–3 once:5.704/3.948/3.861s,
median3.948s,100 rows each, advertised total9,662. It includes Node fetch,
connection establishment/reuse, bounded body read and JSON parsing; per-request
samples exclude CLI credential lookup. It does not measure full catalog
completeness, observer success or saved time. No repeated full scan was made.
Measured validation saving remains0; no latency extrapolation enables reuse.

The [same-run browser comparison](same-run-browser-design.md) uses one existing
main harness run and its two existing logs. It proposes a CI-only actual-step
consumer after an explicit canonical runtime/credential-profile decision.
Existing executions, geometry, standalone `verify:full`, full base and aggregate
semantics remain unchanged in this increment.

| Item | Owner | Acceptance | Next action |
| --- | --- | --- | --- |
| Route discrepancy | Adapter implementer + independent tests | Old20-page reproducer; shared discovery/A/B policy and direct latest/exact checks | Retain model receipts; review the final frozen diff |
| Request/time budget | Integrator | Shared cap/deadline, redirects/body/hanging API abort, latched failure, persisted CLI fallback | Run combined Node/Vitest and independent review |
| Explicit refusals | Test reviewer | Unrelated drift, foreign eligible/noneligible, unknown/multiple PR, >10k, stale attempt and budget negatives | Verify no case authorizes skip or calls a condition-skip a pass |
| Node timing | Integrator | Three bounded read-only pages, source/limits/latency receipt; no full scan | Publish actual sample separately from estimates |
| Same-run design | Coverage reviewer | Actual149+7 IDs; runtime/profile and blocking differences; base failure preserved | Human chooses canonical profile and whether a later CI-only implementation is wanted |
| Review/delivery | Integrator + safety reviewer | Normal commit, dependency draft PR, exact-SHA review, terminal actual CI steps | Keep prior PRs unmerged; report decision items without architecture expansion |
