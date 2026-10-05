# Follow-up backlog

Dependency: #5400, commit `9225b28b17f634185e795469898b2385546f0284`. Tracking issue: #5403. The root worker is the sole integrator; component owners do not commit or modify the shared main checkout.

| Item | Owner | Acceptance | Current state | Next action |
| --- | --- | --- | --- | --- |
| Isolate and audit concurrent work | root | Separate branch/worktree; existing CI PRs and shared stash audited, no restore/reset | Complete | Recheck before final submission |
| Runtime structure measurement | evidence_design | Actual Docker inspect facts; nonroot/RO/no-socket/no-host-namespace policy; full negative tests | 137 Node tests pass; real native ARM measurements complete | Retain separate emulator and protected-authority limits |
| Whole materialized source | coverage_matrix | Rebuild Git tree; match all bytes/modes/types; reject escapes, missing inputs, dirty/untracked/unsupported inputs | 44 Node tests pass; 17,875 blobs / 802,478,662 bytes materialized and checked | Keep unsupported input types fail-closed |
| Actual isolated execution controller | workflow_tests | Fixed command/image; protected definitions; daemon terminal state; bounded output; controller-only receipts | 49/49 native ARM actual Docker tests, zero skips; all owned resources removed | Verify native AMD64 path in the dependent PR CI |
| Historical observation bracket | observer_adapter | A → fresh measurement → B; all pages and latest attempts; latched fallback | 28 Node/Vitest tests pass | Integrate actual adapter regressions |
| Adapter measurement binding | root | Fresh manifest bound to A's run/attempt/PR/job/step/artifacts; changes and 403 drop manifest | 32 Node tests pass, including bounded binary transport | Repeat with the completed artifact reader |
| Protected manual bootstrap | observer_adapter | API/default-main/controller SHA/attempt/job identity; candidate never executes on host; no self-reported final authority | 14 Node tests pass; bootstrap never asserts completed protected authority | Complete independent final API/artifact consumption |
| Independent completed pilot reader | observer_adapter + root | Main controller closure; latest source history; archive digest; strict bounded ZIP; single supervisor step journal; output and resource facts | 90 Node/Vitest tests pass; full actual ARM local components independently match with authority false | Independent security review and final immutable SHA |
| Actual local receipts | root + workflow_tests | Actual image/container/source/exit/output digests; local scope explicitly marked | Recorded in local-receipt-summary.json with raw receipt digests | Preserve local and protected scopes separately |
| Independent exact-SHA review | security_review | Check final source tree and actual receipts; no authority escalation or false green | Design reviewed | Review final immutable commit |
| Separate dependent draft PR | root | Normal signed-off commits, explicit dependency, readable tests and complete CI terminal receipt | Pending | Create after local tests/review; do not merge |
| Protected-live receipt | root + human approver | Main controller executes and external API verifies completed job/artifact | Blocked: definition is not on main; merge triggers DevApp deployment and CN preparation | Obtain precise approval and production owner's same-host-lock serialization review separately |
| Fullstack/other suite closure | validation owners | Trusted supervisor precedes all candidate execution; service/network/installer/tool/input/test coverage closed | Open | Design service orchestration without candidate host/socket authority; retain every current suite |
| Atomic consumption fence | CI authority owner + human approver | All update/start/rerun/cancel/consume paths share protected epoch and CAS/lease | Open | Specify authority and needed permissions; request approval before any change |
| Operational history enumeration | CI authority owner | Prove complete relevant attempt history under real repository volume, including old-created reruns; budget excess never passes | Open: live API advertises 9,655 harness runs, exceeding current limits and causing fallback | Design complete candidate-scoped enumeration without a created-at window; validate against live read-only APIs; preserve fallback |

This backlog is not an assertion that the overall PR→main reuse goal is complete. No blocked or open item is treated as accepted evidence.
