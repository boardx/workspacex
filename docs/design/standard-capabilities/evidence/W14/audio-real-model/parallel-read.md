# Native concurrent read capture regression

The first configured `qwen3.8-max` S009 run failed during native `read_file` cleanup with HTTP 409. It is a failed acceptance run, preserved in `first-live-failure.txt`.

A separate actual owned-container reproducer issued six concurrent `aread` calls against an agent-authored `SYNTHETIC_ONLY` file. Before the change one succeeded and five returned HTTP 409 (`parallel-read-red.txt`). After the change all six succeeded and no `.native-read-*` captures remained.

The adapter now serializes HTTP operations on its session and holds the same reentrant lock across read capture, optional download and cleanup. The internal capture adapter shares that lock. Acquisition is bounded by the existing maximum execution timeout plus transport margin. No submitted execution is retried, and no server isolation or resource limit changes. Separate adapter instances/processes still depend on the server's exclusive-session rejection; this is not a distributed execution queue. Existing `asyncio.to_thread` cancellation behavior is unchanged.

Command from `apps/deep-agent-service`:

```sh
WX_NATIVE_SANDBOX_CONTAINER=wx-audio-real-model-skill-sandbox-sessions-1 .venv/bin/python -m pytest tests/test_sandbox_parallel_reads.py tests/test_sandbox_backend.py tests/test_native_image_read.py -q
```

Result: 39 passed in 6.76 seconds (`parallel-read-green.txt`). This test uses real sandbox execution and synthetic text/PNG bytes, with no database or external model calls. It does not by itself establish G-SKILL success; the real-model scenario must be rerun.
