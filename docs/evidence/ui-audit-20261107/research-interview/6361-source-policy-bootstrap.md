# Initial source-policy transport and authoritative state guard (#6361 / PR #6372)

Real CUA found that materials-only research created and associated a session but then failed with HTTP 400 at GuidedResearchController.executeRuntime schema validation. The UI/runtime supported initial source-policy setup while the wire contract admitted steering only at the research node.

The shared contract now admits only a strict initial brief command: expected version/revision zero, policy revision one, mandatory request/idempotency key and no draft/message/proposal/intent/source/conflict/partial overrides. Existing transport patches remain valid.

Independent review then demonstrated that a real legacy directions runtime could also have version zero and brief among its available nodes. A schema-only fix would improperly expand later-stage authority. PgGuidedRuntimeStore.claim now checks the locked persisted state before mutation: actual current node must be brief, only brief is available, and no legacy checkpoint exists. Exact successful/active idempotent replay remains earlier; mismatched replay remains rejected.

- Original wire-contract RED: 5 failed, 65 passed, including the real controller matching the observed UI HTTP 400.
- Wire/controller/runtime/store focused verification: 74 passed.
- Original independent legacy-state counterexample RED reproduced a real store UPDATE through the controller/runtime chain.
- Final focused suite: 81 passed, plus the original independent counterexample now rejects with zero UPDATE.
- Independent review bound to `d301d65cbbeb6ff8e13a8166c29e8edb9d27fc5b`; all five final files matched independently tested bytes.
- Read-only actual local PG confirmed the newly created session `grs_a4034179a79f4d2bbae91db8530364c5` has runtime version zero/currentNode brief/availableNodes [brief]/no generated steps or model calls. Legacy session.stage directions is not the runtime's actual node. The strict guard therefore admits the real fresh scenario and rejects restored legacy progress.

Real CUA project entry and association are verified. The complete post-fix materials-only creation/research path remains pending because the Mac locked again. Do not treat this document or controlled upstream tests as that missing UI pass, real-model quality or production export evidence.

## Real HTTP and PostgreSQL follow-up

The independently created disposable study grs_c9352e5a9ac14b26bcd726c75518c4a2 passed actual login/create/initial materials POST/GET persistence and exact replay. Seven negative requests were rejected and a complete public-state deep comparison remained unchanged after every rejection. PostgreSQL confirmed version and planRevision 1, materials revision 1, exactly one done request and one activity, and zero research model calls/tasks/sources. No existing project content was mutated.

This lane also exposed that stale revision returned HTTP 409 without its canonical reasonCode. The exception filter now consumes executeGuidedResearchRuntime.err directly after the older ResearchError mapping; it does not copy a new enum or expose arbitrary values/details. Author and independent non-PG logging suites each passed 115 tests; five additional independent malformed/coercion/detail probes passed.

After restarting the same owned API with the fix, real HTTP repeated exact replay and all seven negative cases. The stale revision response now contains RESEARCH_REVISION_CONFLICT, with the complete public state unchanged. These are actual HTTP/PG results, not a CUA pass. Complete materials-only browser flow remains pending the Mac unlock; PR stays draft. Local raw evidence is /tmp/http-source-policy-1107/{review-r5.md,counterexamples-r5.log,evidence-r5.json}.

The complete local TypeScript gate also caught a test fixture omitting the required ErrorLogPort constructor argument. The fixture now supplies a typed port and asserts that routine HTTP 409 does not persist error records. The corrected focused file passed 32/32; complete static checks must pass again before push. Production behavior is unchanged by this fixture correction.


## Actual browser follow-up, 2026-11-07

Root used CUA, actual login and the owned isolated API/PostgreSQL. Model/ASR/mail/sandbox upstreams remain explicitly controlled loopbacks, not live-model quality evidence.

- Selecting materials and submitting the original goal now passes wire/controller bootstrap, creates and links grs_f158d03c91f647788ad69610757ec2d7 to the original project. Independent read-only PG/HTTP confirmed materials revision 1 persisted before the first model call; no sources or recorded external search attempts. Screenshot20 retains the subsequent model-quality failure.
- The standard loopback echoed the placeholder topic and lacked the new materials-plan prompt. Two test-only fixture cases were reproduced RED, then repaired without changing provider selection, production adapters, source authorization or report-quality gates. Root and independent reviewer ran the actual design/plan-repair/three-step suites: 79/79 passed. Named/web behavior controls remain unchanged. Same default study resumed via the real Continue retry button and reached plan; screenshot24. This controlled recovery does not erase the prior failure or prove real Qwen quality.
- A separate named study grs_1f7d5a6fe76b416498624f9edb0701d0 exercised the visible intake details/topic field, two plan edits, an unsaved temporary add/remove, explicit save confirmation, and refresh persistence (screenshot22).
- Generating without any authorized sources correctly stops with materials-insufficient / no external supplementation / no formal report. Independent PG/HTTP: RESEARCH_SOURCES_REQUIRED, busy false, two pending tasks with attempts 0, sources 0, recorded search attempts 0, no research/report model calls.
- CUA found a contradictory supplemental running label after this terminal failure (screenshot23). Display-only fix preserves tasks, alert, source/report gates, retry controls and timeline. RED 3 failures / active control passed; root and independent component+timeline regression 45/45 passed, scoped typecheck passed. Root returned to the same report step and confirmed the gap alert and failure timeline remain while the false running label is absent (screenshot25).

### Browser evidence

- [Bootstrap reached model validation](6361-ui/20-research-source-policy-initialized.png)
- [Plan edits survive reload](6361-ui/22-research-plan-edit-persisted.png)
- [Contradictory status before fix](6361-ui/23-materials-gap-contradictory-status.png)
- [Default-name retry reaches plan with controlled fixture](6361-ui/24-research-default-retry-plan.png)
- [Same materials failure after status fix](6361-ui/25-materials-gap-status-fixed.png)

Materials-without-sources is a verified rejection path, not successful formal research generation. Real-model output quality and successful native PDF/Word generation remain separate unverified live lanes. No production deployment was performed.
