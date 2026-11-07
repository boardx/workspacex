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
