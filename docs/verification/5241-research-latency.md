# Research latency and confirmed header — issue #5241

## User-observed failure

Local `/research/grs_13fe9f9ed61748d0b7084446fbaa4b6e` generated a plan in 78 seconds. Source research returned after 24.3 minutes with 25 preserved sources and 7 failed tasks. Header displayed the imported paragraph despite the runtime brief containing the concise confirmed topic.

## Change and limits

- Outline generation and executable research planning share a 55-second local waiting budget (including the executable plan repair). Parent search cancellation takes priority. Provider cancellation is local transport abort, not proof of remote execution cessation.
- Outline receives the confirmed brief/directions and generation instruction, excluding unrelated source bodies and stale conversation. Metadata remains validated; concise output instructions retain three distinct subsections per chapter.
- Header reads current runtime brief topic before stale session title.
- Latest main already provides the 180-second search budget and compact terminal synchronization. Local Web/API were moved to this branch without restarting PostgreSQL, Redis or deleting records.
- A deadline returns an explicit recoverable failure; it does not fabricate a usable plan or claim every external provider can generate successfully under one minute.

## Evidence

- RED: new stalled outline/research planning tests failed before the deadline implementation; header regression failed before topic precedence fix.
- GREEN: API research unit lane 259/259; Web live research 18/18. API and Web typecheck exit 0. API/Web lint exit 0.
- Real provider: existing confirmed Node.js brief/directions, `qwen3.8-max`, five validated outline chapters in **25,855 ms**. Trial store was in memory; existing user plan was not overwritten. Metrics: `5241-real-plan-latency.json`.
- Real local retry: finished with `busy=false`, `errorCode=RESEARCH_SOURCE_RELEVANCE_INVALID`, retaining all 25 sources. Model validation failure remains explicit and is not counted as retrieval success.
- Browser: existing session restored with concise heading and 25 retained sources. Screenshot: `5241-research-header.jpg`.
- Independent review: no actionable findings; reviewer reran 13 plan-repair tests.
- Environment: `init.sh` passed with `pnpm_config_strictDepBuilds=false` because bundled pnpm 11 otherwise rejects ignored dependency build scripts. Installation-generated manifest/lockfile changes were reverted. `harness tick` could not connect because `COORD_GATEWAY_URL` is absent; no coordinator identity was invented.

## Execution plan

```mermaid
flowchart LR
 A[Locate state and latency] --> B[Plan deadline and title] --> C[Integrate retrieval deadline] --> D[Verify runtime] --> E[PR and CI]
 classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
 classDef doing fill:#fde68a,stroke:#d97706,color:#111827
 classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
 classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
 classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827
 class A tested
 class B tested
 class C tested
 class D tested
 class E doing
```
