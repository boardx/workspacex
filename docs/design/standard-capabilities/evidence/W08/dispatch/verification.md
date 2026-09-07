# Bound native sandbox consumer dispatch

Production S018 evidence: one AIMessage dispatched document parse for PDF chunks and PNG OCR concurrently. Both TS services use one E003 session, and one real execution returned 409 SESSION_BUSY. The Python backend's existing per-operation RLock cannot cover those independent HTTP consumers or their complete execute/readback lifecycle.

`NativeSandboxDispatch` is an official AgentMiddleware instance bound to the trusted graph's sandbox identity. Queue size and deadline defaults reuse generated sandbox limits. No global queue, database lease, distributed lock, provider retry or model prompt restriction is introduced. There is currently no shared resource declaration covering all tools; this initial implementation conservatively serializes tool handlers, except run cancellation/status. That is a scheduling decision, not a claim that web/SQL tools inherently require serialization.

Official langchain factory `_chain_tool_call_wrappers` / async equivalent explicitly compose the first middleware outermost. The integration order must be `[... snapshot, NativeSandboxDispatch(sandbox.id), NativeToolAuthority(...)]`: slot admission occurs before the existing fresh authority check. The complete handler remains inside the slot, including parent task delegation. Child file-only graphs must not install this gate again.

Async queue cancellation removes its ticket immediately without dispatch. Active outer cancellation waits for the already-started handler to settle before releasing the slot, then propagates cancellation. It does not claim remote process stop, rollback of committed side effects, or termination beyond the handler's own existing transport/operation bounds. There is no background waiting executor thread. Synchronous callers share the same slot and have the bounded queue deadline; they do not gain an invented thread cancellation primitive.

`SandboxDispatchError` inherits existing ToolAuthorityError and therefore the native retry exclusion. Initial module-red evidence proves the new acceptance tests did not preexist. Final 6/6 pass includes an actual E003 private-session counterexample: official agent AIMessage parallel independent HTTP calls produce `[200,409]` without the gate and `[200,200]` with it. The two tool bodies are deterministic transport fixtures, not an external model or the TS document service. The unchanged S018 production case must separately verify that end-to-end consumer path.

Other passing assertions cover true official agent tool dispatch and authority ordering, async queue capacity/timeout/cancel with zero handler calls, revoked authority after waiting, active cancellation settlement before the next call, and synchronous worker serialization.

Command: `WX_NATIVE_SANDBOX_CONTAINER=wx-w08-locators-skill-sandbox-sessions-1 apps/deep-agent-service/.venv/bin/python -m pytest apps/deep-agent-service/tests/test_native_sandbox_dispatch.py -q`.

The fixture destroyed its own session; root's container remains intact. No database stack was needed. The known google.genai DeprecationWarning is unrelated. Production graph wiring and official nested task regression remain pending root integration at this checkpoint.
