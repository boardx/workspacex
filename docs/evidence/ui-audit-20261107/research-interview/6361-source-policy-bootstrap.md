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
