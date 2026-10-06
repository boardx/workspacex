# Model response body deadline (#5419)

A real owned socket with headers immediately and heartbeat-only SSE every 25 ms outlived the configured 100 ms + 2000 ms grace deadline. Before repair it returned success with zero text after 3513 ms. The deterministic regression failed (4 existing controls passed). The deadline now stays alive through full JSON or SSE consumption, with reader cancellation and lock release in finally.

Validation: from apps/api, run `pnpm exec vitest run --config ../../docs/verification/model-body-deadline-5419/vitest.config.mjs`. This socket-only configuration does not connect to a database. It includes the configured-provider suites: response headers timeout, successful streamed content/usage, caller cancellation, disconnected reader, heartbeat stream deadline, and slow JSON body deadline, plus existing privacy/provider/model/output controls. `pnpm run typecheck` also passed.

The owned real report trial on f9a40ba725aee1f3a423e1e3a1c4ab79d13c35df took 1023180 ms with one attempt, zero deltas and AI_GENERATION_UNAVAILABLE. This is consistent with the deadline defect, but its upstream HTTP/transport status remains UNKNOWN. This repair does not claim normal real report output; real-model/browser multi-round validation remains pending. No additional retries, fallback model or report quality gate changes.
