# T002 native PNG read: bounded transport correction

## Initial failure retained

2026-09-07: `tests/test_native_image_read.py` uses a deterministic valid PNG (RGB scanlines, zlib IDAT, CRC), uploads it through the real session HTTP adapter, and invokes upstream `read_file` in `create_native_graph`. The scripted model declares `image_inputs=True` and records messages actually presented to `_generate`; no external model is called. The assertion checks that the original PNG base64 reaches an image block, not merely a textual claim that an image was read.

Real run command:

```
WX_NATIVE_SANDBOX_CONTAINER=wx-native-image-test apps/deep-agent-service/.venv/bin/python -m pytest apps/deep-agent-service/tests/test_native_image_read.py -q --timeout=60
```

Result: 16×16 passes; 160×160 (>64 KiB and <500 KiB) fails. See `native-image-read-before.txt`, including the upstream `unexpected server response` error. The PNG is within upstream `MAX_BINARY_BYTES=500*1024`, but base64 JSON exceeds the session execute stdout cap. `BaseSandbox.read/aread` invokes `_build_read_cmd` then `_parse_read_output` on already-truncated stdout, so the JSON envelope is incomplete. At this initial stage large image acceptance was red; the verified correction is recorded below.

Initial proposed minimum integration for review: adapter-specific read/aread executes the unchanged trusted upstream read command with stdout redirected to a randomly named session-local result file, downloads bounded JSON through existing file transport, and calls the unchanged upstream parser. Always delete the temporary result file. Validate upstream helper version/source, transfer limit and execution failure; do not rewrite user commands, the reader/parser or read_file, and do not increase shared execute stdout caps. Concurrency, symlink replacement, cancellation and cleanup must be covered before enabling this path; the result file remains inside the same session's security boundary.

The uniquely owned compose project/container `wx-native-image-test` was stopped and removed with its sessions volume after verification. No peer resources were modified.

## Implemented transport and final verification

The approved adapter now calls upstream `execute_with_offload` on a dedicated `_ReadCaptureSandbox` instance sharing the same trusted session/client. Only that helper instance enables capture; the primary adapter remains `enable_capture_offload=False`. Upstream `_build_read_cmd` and `_parse_read_output` are reused unchanged. The installed upstream sandbox source is pinned to SHA-256 `13c228a22bfd1cf84e9cd1f2f8e4813e710a9fb405de19e189a2f42a3cfe60b6`; constructor compatibility also requires deepagents 0.7.6. Unknown source fails closed before execution.

Inline budget is 8 KiB and complete captured JSON is bounded to 1 MiB. Capture truncation, nonzero/unknown exit, unavailable/oversize download, invalid JSON and cleanup failure cannot report success. `finally` removes both the generated capture path and upstream `.ec` sidecar. Paths are random hexadecimal UUID names under /workspace; no caller path enters cleanup shell interpolation. Model execute still has the existing 64 KiB limit. Large JSON beyond the read-specific capture bound returns an error; this does not promise arbitrary-size preview.

`aread` uses `asyncio.to_thread` over the same synchronous HTTP adapter, reusing the identical upstream capture operation and cleanup. Cancelling the awaiting coroutine does not terminate its worker thread or constitute session cancellation; the trusted lifecycle owner still owns the session cancel primitive, and the worker completes its finally cleanup. No new main-run cancellation behavior is claimed.

Final real container suite: **46 passed** (`native-image-read-after.txt`), covering small/large PNG sync/async with exact image bytes observed by the fake model; missing and over-500-KiB binary errors with cleanup; transport truncation/nonzero/unknown exit/download/JSON failures; unchanged main capture flag; source-change refusal; adapter regressions and all eight existing native file-tool checks including text pagination. The legacy identity assertion was updated because read transport is now explicitly adapted, while read_file and upstream parser/reader implementation remain reused. No external model was called. The owned image-test stack is removed after this verification.

Independent read-only review found no blocking issue. Scope remains transport/image-byte delivery using a scripted image-capable model, not production attachment ingestion or real-model vision acceptance. Each read consumes capture and cleanup executions from the existing session budget.
