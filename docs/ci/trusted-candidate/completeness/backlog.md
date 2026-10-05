# Completeness backlog

Owner assignments are execution responsibilities, not product feature passing
state. [#5405](https://github.com/boardx/workspacex/issues/5405) tracks this shadow
increment; the overall trusted reuse objective remains open.

| ID | Owner | Acceptance | Current state / next action |
|---|---|---|---|
| C01 | Integrator | Fresh exact-head/order/deployment/CN-lock impact package for #5400/#5404; no unapproved effects | Prepared directly in task receipts; require owner lock/candidate confirmation and explicit staged approval before effects |
| C02 | History implementer | Exhaust unfiltered <=10k catalog; every relevant known ID direct latest + exact latest attempt; no old-green recovery | Implemented; Node/Vitest 61 each pass. Independent review and final PR CI |
| C03 | History test reviewer | 9659/10000 success, 10001 failure; stale attempt1, old-head PR and same-head other PR veto; unknown association/paging/budget/403/429 latch | Tested with mocks only; retain live index/unknown-association fallback and request cost boundary |
| C04 | Integrator | Remove duplicate global200 reader cap without weakening fresh A/measurement/B or outer pilot/source before/after binding | Implemented; combined reader/adapter Node129 pass. Independent exact-tree review and Linux CI |
| C05 | Fullstack inventory owner | Single metadata observation of 149/53/7 + geometry7/5/1; stable full identities/DAG, existing fixme explicit | Implemented; Node/Vitest96 each pass, including setup/teardown order and Proxy negatives. Actual prior logs compare only; no execution authority |
| C06 | Protocol model owner | Epoch/generation/CAS, all simulated producer bundles, ABA/expiry/double consume/bypass/crash negatives; every real-authority flag false | Implemented; Node/Vitest113 each pass; complete catalog binding and Proxy review fixes; 9/9 targeted mutations rejected. Real effect remains open |
| C07 | Independent safety reviewer | Frozen tree/normal commit exact SHA; no permission/workflow/deploy/required-check change; positive metadata/model never claims real green | Review complete increment after tests; fix findings before draft PR |
| C08 | Integrator | Normal signed-off commit, dependency draft PR, all CI terminal, actual step outcomes/counts retained | Push after review; attach PR and inspect job steps including continue-on-error |
| C09 | Main owner + integrator | Default-main immutable controller, exact candidate source, API latest/attempt/job/step/artifact + actual runtime receipt | BLOCKED on reviewed main integration and explicit protected pilot dispatch; unit/local/PR pilot is not this receipt |
| C10 | History architecture owner | Complete protected history bootstrap and all start/UI/manual/rerun/cancel events, ambiguity/permission/recovery fail closed | OPEN. Observed API view cannot prove unseen index IDs; new storage/write permissions require separate approval |
| C11 | Fullstack execution owner | Actual service/build/browser/dependency bytes; fresh data/migrations/roles; fixture/module/import/network closure; all149+7 terminal identities | OPEN. No actual trusted fullstack service closure was implemented or trialled; metadata is not a substitute |
| C12 | Coordinator/consumer owner | Durable all-path invalidation and real consume/effect atomicity, including crash/recovery and bypass handling | OPEN. Model is not a real coordinator or atomic effect; production integrations/permissions require approval |
| C13 | Release owner | Frozen SOP and automatic CN prepare/source/tool-cache writers obey canonical host release.lock and exact candidate provenance | BLOCKED on fresh owner/host-lock confirmation before any approved main merge effects; GitHub concurrency is insufficient |
| C14 | Integrator | Preserve main-only matrix and independent manual revalidation; compare measured costs without global speed claim | Existing matrix retained; measured skip saving0, ~13min compatible-gate estimate only |

Protected live execution and permission changes are approval boundaries. C10–C12
also need substantive implementation independently of approval: a permission
alone does not make their completeness or atomicity true. Retaining full-run is
the viable default until those properties have actual evidence.
