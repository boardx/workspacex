# Research latency evidence — #6332

Baseline: `748683417501ac13802462e9735d0aeeb367f2dc` (develop). Scope: plan and source acquisition, not model or network speed claims.

## Controlled comparison

Six independent chapters, three unique pages each; identical fixed responses, search delay60ms, read delay20ms, screening delay10ms; no external provider or database. Uses real pipeline, relevance schema/quote validation and checkpoints, with an in-memory persistence boundary. Both versions produced the same18 source URLs and six successful tasks; both used6 searches,18 reads,6 screening calls and peak3 reads.

| Trial | Before ms | After ms | Before writes | After writes |
|---|---:|---:|---:|---:|
| 1 | 600 | 324 | 24 | 32 |
| 2 | 583 | 312 | 24 | 32 |
| 3 | 583 | 314 | 24 | 34 |

The added phase-start checkpoints have a persistence cost. This benchmark does not simulate database latency and does not establish a production SLA or the elapsed time of the user's CN run. Earlier observer-only progress reduced writes but was rejected in review because the normal NDJSON+polling UI could not see it until a later checkpoint; final results above include durable phase starts.

Reproduce from repository root (temporary baseline imports its existing relative dependencies):
```sh
git show 748683417501ac13802462e9735d0aeeb367f2dc:apps/api/src/application/research/guided-task-pipeline.ts > apps/api/src/application/research/.guided-task-pipeline-baseline.ts
trap 'rm -f apps/api/src/application/research/.guided-task-pipeline-baseline.ts' EXIT
pnpm exec tsx docs/evidence/research-parallel-acquisition-6332/benchmark.mts "$PWD/apps/api/src/application/research/.guided-task-pipeline-baseline.ts"
```

## Regression evidence

RED observed for independent section dispatch, named-brief third call, unread shared-tail locking, missing counts, and missing active-read polling checkpoint. GREEN after fixes. No removal of source screening or report quality gates. Named-brief prepare_plan now has directions/outline calls only; default-topic generation remains3 calls to obtain a non-placeholder subject, with full scope retention tests.

API research suite:40files/920tests passed; focused web timelines:2files/36tests passed; API/web typecheck and API lint passed; init.sh quick health and git diff --check passed. Independent reviewer reran33tests green. Review initially found progress observers did not reach default UI, fixed with persisted/coalesced progress. No production config, DB permissions, accounts, fee data or deployments changed. No real-provider benchmark or authenticated CN browser acceptance was available in this execution; deployment and online timing remain separate.
