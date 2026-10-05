# Supplemental query task attribution (#5394)

Controlled real pipeline RED: sibling-B supplemental material was screened under task-A/question0 and correctly rejected by the strict relevance gate; the same material under task-B/question1 passed. This demonstrates a query attribution defect, not the cause of the original online 44-minute incident.

Derived question queries now carry their corresponding current section/question task. Complete objective equality proves the saved question; missing, stale or ambiguous bindings are skipped. Questions exceeding the contract objective capacity cannot be proven from a truncated prefix, so derived supplements are skipped. Legacy chapter tasks retain their existing chapter-wide scope. General section queries use an eligible section task. Per-task durable attempt deduplication, limits, primary status and failure/report gates remain intact.

Original temporary counterexample is preserved at /private/tmp/research-supplement-scope-counterexample.test.ts and .log. New true RED six failures: /private/tmp/research-5394-red.log. New matrix 12 PASS includes sibling and cross-section identity, changed/missing task scopes, task-A source isolation, duplicate queries, ambiguity, long question tail, legacy behavior and failed-primary preservation. Complete pure research suite: 469 tests passed; API typecheck/lint and diff check exit 0. Final logs /private/tmp/research-5394-{full,type,lint}-identity-final.log.

Fresh main baseline f2f688b98a80b6e01465c6c27a653dcff39becd0. Independent of negative cache PR #5392. No actual-session retry, real model, deployment, online latency or completed report acceptance is claimed. Original five failed-task underlying causes remain unknown.
