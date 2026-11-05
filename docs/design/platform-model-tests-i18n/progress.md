# Model testbench i18n progress

## 2026-11-05 - source verified, cloud acceptance pending

Issue #6246. Production source394283d; test/config source b8005f. The complete page now uses a typed namespace, render-time semantic errors and translated aria labels. Existing requests, effects, guards, financial helpers, raw input/results and all23 legacy cases are preserved.

Focused tests at58f602:88/88 passed (60 SDK-mocked cases,23 legacy,5 resources). A subsequent type check found the cancellation error fixture missing its required raw argument. Only that third argument changed in b8005f; its affected case passed with59 filtered, scoped lint and web type passed. Init, raw-error/testid/wiring checks,20 fullstack configuration tests and exact discovery of one browser case passed. See evidence/platform-model-tests-i18n-6246/source-gates.json for exact commit/exit/duration/hash receipts, including the retained earlier type failure.

Independent source reviews cleared Task1 and Task2 after the temporary grant cleanup marker moved before fallible response parsing. These are static conclusions only. No native browser case or PNG has run. Main approved explicit Draft publication and existing cloud CI; no further local Next build is planned.

## 2026-11-05 - actual cloud prerequisite failure and minimal fixture delta

Cloud run41917734613 attempt1 at43f9 executed the new case. Initial2.467s and canonical retry1 2.808s both failed on the actual organization GET503 PLATFORM_CATALOG_UNAVAILABLE. Historical protected POST201 and independent GET200 succeeded before that. The actual page showed its service error, but no planned recovery/history capture was reached:0/20 planned PNGs,2 diagnostic failure images. See evidence/platform-model-tests-i18n-6246/cloud-attempt-1.json; authenticated raw artifacts remain private.

The fullstack startup lacked separate readonly catalog credentials. Existing repository behavior deliberately returns503 when that connection is absent; prior members/telemetry journeys do not read this endpoint. Only test startup changed in51e5899, reusing existing readonly SQL/fixture facts with a dedicated scoped LOGIN. Production page/source/DI/provider/accounting and200 assertion are unchanged. Independent candidate review and exact applied binding are clear. API type/lint,20 configuration cases,init and exact1case discovery passed; source receipts are in catalog-fixture-source-gates.json and catalog-fixture-source-review.md.

Ruling: support only the canonical fresh owned PG-stack lifecycle; retained-PG API restart fails closed rather than adopting authority. Whole cluster disposal is required. If that assumption is wrong, retained-stack startup will fail and requires a separately reviewed reuse design. No local PG/Next/native run occurred. Normal publication and new cloud native acceptance remain pending; Draft/nonREADY.

## 2026-11-05 - second cloud attempt and concentrated driver correction

Run41929967004 at99c69f verified the readonly catalog prerequisite: real organization/candidate200, original recover/query/history200 and ordinary403 flows passed their assertions. Initial run then failed32.802s on a driver expecting TEST_NOT_FOUND in a public404 body containing only not_found+traceId; cleanup revoke200 completed. Canonical retry1 failed2.792s when login JSON was read after hard navigation.16 planned375/1280 PNGs plus4 automatic failures were produced. Root individually inspected all16 planned images without actionable owned-copy/layout findings; foreign UI404 and revoked403 image pairs remain absent. See cloud-attempt-2.json and partial-attempt-2-png-qa.json. Raw media/authenticated reports remain private; these partial images do not establish final acceptance.

Concentrated audit covered all remaining404/status/locator expectations. Source90f7d10 changes only the native spec: all three404 sites require exact canonical public fields while keeping status/owner equality checks, and actual signed login JSON is consumed concurrently with the real submit. Recovery ownership locks,role cleanup,UI/API/fixture/budgets and request semantics remain unchanged. Scoped original-reviewer re-review marks both source findings ADDRESSED/no newP1/P2. Spec lint,web type,testid and exact1case discovery pass; see driver-round3-source-gates.json and driver-round3-source-review.md. Fresh complete native execution and all20 final images after this correction remain pending. Draft/nonREADY.
