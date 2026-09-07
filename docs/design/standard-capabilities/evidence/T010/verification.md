# T010 verification

- Contracts: 2/2 passed, including strict native input/read-only shape and generated Python schema freshness.
- Python new module: 10/10 passed, including two actual input-capable sandbox reads (sync/async), four denied dispatch variants, upstream tool identity and two independent official task calls.
- Existing native factory/graph: 35 passed, 3 explicitly skipped owned-sandbox tests. Existing text-only delegate behavior and startup wiring remain verified; skipped cases are not counted as passes.
- API typecheck: exit 0 after new production source and initial full-chain test were written. Later test organization splits source proof and real-runtime acceptance into separately reported cases; no production TS change followed.
- Final isolated DB/HTTP acceptance: 2/2 passed. Full-chain stdout explicitly reports completedDelegations=2, actualSourceObserved=true, readonlyInput=true, externalModelCalls=0. The second case requires WX_NATIVE_SANDBOX_CONTAINER and is otherwise visibly skipped, never silently treated as a real-runtime pass.
- The source counterexamples use actual object bytes, a private-thread owner update and a parent cancel commit. Changed org/attempt/epoch/path/digest requests also fail. Source lookup and visibility are the existing PgNativeRunInputs implementation.
- First full-chain failure was a missing interjections/poll fixture route. The actual controller and PG queue/grant repositories fixed it. No native middleware or authority was disabled.

Final sandbox image: workspacex-skill-sandbox:w02-inputs
sha256:3ee7f5f51a1f228140da45fd752b6aa6fab7c744fcdb3dfe75d035e9d8952e73

The existing restricted sessions compose profile retained init, network isolation, capability drop and the dedicated socket volume. Only the local test image selection was overridden. The old e003 image's /sessions input fixture returned 400 INVALID_SESSION_INPUT and was replaced; it was not described as input-capable.

Resource cleanup: final DB wrapper9669 exited0 and cleaned (10s, peak3 connections). Owned container wx-t010-delegation-test was removed and wx-t010-delegation_sessions_socket was removed. No other agent resources, production deployment or git state were modified by this worker.

Production composition verified in production-di.txt: the real KernelModule provider and exact injection tokens construct NativeFileDelegationProof, and NativeFileDelegationController is registered. The real HTTP source-proof case uses that production factory. Standard isolated wrapper exited 0 (1 passed, 1 explicitly skipped sandbox-only case); the separate fullchain-final.txt already covers both real sandbox cases. No owned DB stack or sandbox remains.
