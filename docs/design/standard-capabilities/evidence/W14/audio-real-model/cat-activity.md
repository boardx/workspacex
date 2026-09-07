# Narrow actual execute read observation

The configured model selected `execute` with `cat /skills/meeting-minutes/SKILL.md` rather than the dedicated `read_file` tool. Its successful tool response contained the complete pinned instruction bytes, but the old observer only tracked `read_file`. This was a real observability gap, preserved in `1.1.1/execute-skill-read-trace.json`.

`native_skill_activity.py` now carries the actual tool-call context through execute. `sandbox_backend.py` only submits successful, nontruncated execute responses to the observer. An event requires both an exact single `cat <trusted SKILL.md path>` (or `/usr/bin/cat`) and SHA-256 of complete UTF-8 stdout equal to that immutable pin's instruction digest. Existing `body_read` semantics and delivery failure behavior are reused. Arbitrary scripts, pipelines, partial output and synthesized echo output do not prove a read and do not produce this event.

The actual owned-container test first failed. After the change, real cat succeeded while a printf emitting identical instruction content and a failed cat did not emit. Unit counterexamples reject truncated, nonzero-exit and incorrect stdout. Existing sync/async read events, native image transport and parallel reads also passed: 48 tests in 10.48 seconds, logs `cat-activity-red.txt` and `cat-activity-green.txt`.

From repository root:

```sh
WX_NATIVE_SANDBOX_CONTAINER=wx-audio-real-model-skill-sandbox-sessions-1 apps/deep-agent-service/.venv/bin/python -m pytest apps/deep-agent-service/tests/test_native_skill_execute_activity.py apps/deep-agent-service/tests/test_native_skill_activity.py apps/deep-agent-service/tests/test_sandbox_parallel_reads.py apps/deep-agent-service/tests/test_sandbox_backend.py apps/deep-agent-service/tests/test_native_image_read.py -q
```

This is deliberately bounded support for one verifiable read form, not general shell/file-access auditing. No graph or global event model is added.
