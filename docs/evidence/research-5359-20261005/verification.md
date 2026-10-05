# Remove round-level research deadline (#5359)

The user clarified that approximately ten minutes is a whole-report performance goal, not a deadline that fails a run. Search and report source preparation no longer share an execution-wide 180-second abort. Each external call remains bounded: search 45 seconds, document read 10 seconds, source/report model 90 seconds, plan 55 seconds. Pause, durable steering, claim/version/checkpoint and quality checks remain authoritative.

## Verification

- Research pure tests: 16 files / 416 tests PASS; API typecheck and scoped lint exit 0.
- Web research tests: 37 files / 364 tests PASS; Web typecheck and scoped lint exit 0.
- Counterfactual: restoring the old shared 180-second budget makes both service tests that advance past 600 seconds fail. Virtual time verifies semantics, not real performance.
- Parent abort during a blocked search/read rejects the pipeline wrapper immediately. Late uncooperative provider results cannot read response bodies or write state. Admission after abort creates no timer or provider call.
- Owned browser fixture: at 266 seconds after generate_report, reload restored an active search with 16 saved sources. The subsequent pause settled with busy=false, controlStatus=paused, errorCode=null, completed=false, 18 successful/2 interrupted/4 pending tasks, 18 sources and two commands (generate plus pause). This was memory storage, synthetic authentication and controlled model/search, not PostgreSQL, a real source corpus or report-quality acceptance. The temporary tab and ports 34363/34364 were closed. No fixture screenshot is presented as a user report.

## Real search baseline, separate from report acceptance

The production GoogleGuidedSearch adapter was called once with the same 22 public Node.js documentation questions used in the earlier benchmark, concurrency 2, explicit real Google proxy endpoint. No model, private body, document reading, database or report generation ran. Result: 31.374 seconds total, adapter p50 2.819s / p95 3.527s. All 22 HTTP/schema calls returned successfully, but only 19 returned nonempty hits; timers/util/module returned none. All returned hosts were nodejs.org. Adapter duration includes retries, parsing and deduplication. See google-search-baseline.json for queue wait and each result count. This single baseline does not establish a ten-minute report SLA or justify changing concurrency.

The reference boardx-backend implementation uses the same Google proxy and concurrent tasks, but its webpage-body extraction is commented out. Its snippet-only output is not equivalent to this repository's question-specific body/hash/quote/quality requirements. Search optimization remains #5306; those gates were not weakened here.

Local raw logs and the controlled screenshot are retained in the private evidence archive. PR CI and final independent SHA review are required before delivery. No automatic merge or deployment.
