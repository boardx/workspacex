# Execution-local negative screening cache (#5387)

A completed run observed 154 research model-call records over approximately 44 minutes, with 40 succeeded and 5 failed tasks. These aggregate records do not establish that all calls were redundant or identify provider failure causes.

Controlled real executeTaskPipeline counterexample: three distinct queries returned the same URL and 60,000-character synthetic body. Reading was already deduplicated; screening made 12 calls before wiring. After wiring, it makes 4, and a new execution makes another 4. The pipeline still rejects RESEARCH_SEARCH_PARTIAL_FAILURE; task/question identity, failed attempt records, empty sources and absent report remain unchanged. No evidence or quality gate is weakened.

Only complete, originally validated negative screening is cached. Repair, malformed output, provider failure, cancellation, incomplete adaptive scans, invalid source policy and inconsistent body hashes cannot admit negative cache entries. Keys include execution/session, confirmed scope/task/questions, policy, validator version, canonical provenance and material hash. The bounded digest set is private to one pipeline invocation and cleared in finally.

Validation: pure research suite 20 files / 481 tests passed; API typecheck and lint exit 0; diff check exit 0. Logs: /private/tmp/research-5387-pipeline-red.log and /private/tmp/research-5387-{full,type,lint}-final.log. Synthetic controlled ports only; no production retry, deployment, real-provider report acceptance or online latency claim.
