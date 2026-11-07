# Exact-source CI wait

A main-cn push can arrive before that exact main commit's CI finishes. The
cloud preparation lane now waits for explicitly pending CI instead of failing
once and requiring a human redispatch. It polls every 30 seconds for at most
95 minutes, inside a separate 100-minute Ubuntu job. Source export runs in
parallel; Devapp gets its own 95-minute budget after CI success.

The installed candidate CI generator remains the single gate definition. Its
default root mode still rejects pending runs. Only the cloud wait opts into a
dedicated pending error, emitted after both workflow families are inspected.
Failure, malformed or foreign identity, incomplete pagination, API errors,
rerun drift, desired main-cn drift and cancellation are not retryable. The
wait issues GET requests only. TERM/INT/HUP abort both the API subprocess and
sleep; root deployment independently repeats strict CI verification.

Frozen increment independent review: ACCEPT. Parent rerun: 56/56 Node cases
(49 exact-evidence plus seven source cases), 10 Vitest cases passed with two
existing Linux-only skips, and 26 identity/promotion cases passed. Reviewer
also checked the actual YAML dependency expression across all success/failure/
skipped/cancelled combinations. These are local orchestration counterexamples,
not live Devapp or production acceptance.

Live CN public Git metadata probe returned exact main
`d1096e3003e35d9eb0a9a446b8a0b0594d32ae3a`, exit zero. A separate root-private
software source mirror download was started under the existing release lock;
its completion, full-object verification and any installation are not yet
established. No production repository/cache/ref or running service was changed.
