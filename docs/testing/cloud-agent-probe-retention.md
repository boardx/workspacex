# Cloud Agent probe evidence retention (#3549)

The probe creates one private thread per invocation. Canonical provisioning calls it once per attempt; its retry helper is used only for readiness. A pass still requires a newly executed terminal successful run and its matching, nonempty durable Agent reply. The result explicitly includes `threadRetained: true` and the thread/run/reply IDs, without reply content.

The private thread and append-only execution history remain as acceptance evidence. Physical thread deletion cascades into append-only run steps and is not a valid probe teardown operation. This change does not repair or relax the general user-facing thread deletion lifecycle. No database trigger, permission, or tenant rule changes.

Failed probes still request run cancellation when the shared signal permits it. Cancellation failure throws; an expired shared deadline issues no further requests. The outer business probe continues to report uncertain remote state as a failure rather than converting it into a pass. Evidence retention does not imply that a failed run terminated.

## Regression evidence

Command: `pnpm --filter @repo/api exec vitest run --config vitest.file-cloud.config.ts tests/files/cloud-agent-probe.test.ts`.

Before the implementation change, a fixture returning HTTP 500 for physical thread deletion failed 6 of the 7 existing cases. After the change and addition of a cancellation-failure case, all 8 cases pass:

- Success retains the private thread and returns evidence IDs without issuing delete.
- Missing, human-authored, wrong-run, and empty replies fail and request cancellation.
- Waiting permission requests are never approved.
- Deadline expiry sends no further cleanup requests.
- Failed cancellation remains a failure and does not delete history.

This fixture proves probe control flow, not production availability. Production acceptance still requires a real canonical provision run for the actual immutable release.
