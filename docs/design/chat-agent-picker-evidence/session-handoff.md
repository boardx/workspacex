# Handoff — #6190

Owner: phase-one worker chat 01a19d94-a235-7a11-b5ed-b64d259b49bf. Main coordinator remains the only native queue operator.

Only edit e2e/support/workbench-run-evidence.ts and chat-agent-skill-context.spec.ts, plus focused evidence/docs. #6189 owns HITL spec/next-turn helper; no overlap agreed with its owner. #6182 remains paused. PR #6177 source ce108e29 remains unchanged; do not replace current native candidate results with the earlier bb1 candidate's 57 success/15 skip result.

Raw failing logs: /tmp/6177-61f-chat1.log. Downloaded diagnostics: /tmp/6177-61f-chat1-diagnostics.zip. Extracted trace: /tmp/6177-61f-skill-trace/data. These raw traces contain authentication and must not be committed. The tracked failed-candidate-trace.json contains only selected routing evidence, without credentials.

Validation so far: standard init fast path exit0, exact same-argv/env discovery 3 cases/1 file/1 worker, actual 3/3 browser pass (3.6m; total3m43s), web typecheck exit0. Wrong first command's 134-case attempt was interrupted, does not count, and its owned process trees/compose/listeners were removed. Correct run cleanup1s, no owned containers/listeners remain.

Independent review of 0b31bead8 against b7be8e0 accepted by main. First normal push passed 27/27,25cached,15.981s,exit0. This final follow-up only records evidence/docs and does not alter tested/reviewed helper/spec code.

Next: auto-create separate PR to develop with Closes #6190; follow fresh exact-head CI and native candidate. Main alone handles native queue. Release the heavy window explicitly after the final ordinary evidence push. No active PG/Next stack. #6177 must use its current native candidate, not an old candidate green result.
