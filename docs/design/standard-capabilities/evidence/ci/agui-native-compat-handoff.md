# Native integration AG-UI compatibility regression

Focused standard isolation wrapper: 12 files, 75 passed / 6 failed. The raw output is retained, not overwritten as a green run. After fixing those six, the coordinator owns the standard combined 24-file retry; the six are not claimed verified by the earlier result. API typecheck passed after all fixes. Wrapper resources were released.

## Necessary peer integration changes

- `packages/contracts/src/execution-journal.ts`: optional bounded public `planningNote` on `tool_start`. Existing schema remains the single source.
- `apps/api/src/application/agent-run/execute-run.ts`: forwards the existing visible planning summary through existing public-payload redaction; does not add an event path or journal.
- `apps/api/src/interface/controllers/execution-journal-relay.ts`: restores tool STEP envelopes and non-streamed planning text via the same journal. Real `tool_end` publishes the result. Turn closure closes presentation envelopes for pending HITL without inventing a tool result, preserving AG-UI protocol validity.
- `apps/api/src/infrastructure/agent-run/configured-model-provider.ts`: the single-assistant OpenAI-compatible streaming path explicitly supplies the same `assistant` identity in deltas and completion. This prevents final replay through proven identity rather than guessing identity from text equality.

## Test fixture and assertion changes

`deep-agent-stream` and `deep-agent-model-provider` expect the actual custom stream mode and explicit result success field; `deep-agent-hitl` checks real tool-call identity and argument digest. AG-UI/HITL fake engines expose a real SSE metadata stream and transition to final/interrupted state when that stream closes; they no longer return 404 while claiming a complete required journal. No fake Skill activity is emitted. Tests that intentionally exercise unavailable streams were not changed.

The shared test helper validates every durable execution event against the peer schema, one run, increasing cursor and succeeded status before removing only those known journal events from legacy message-order assertions. Unknown CUSTOM events still fail. `hitl-edit-real-db-e2e` submits the actual pending approval ID. Planning and final streams use distinct real message IDs, each appearing once; no text-dedup heuristic was introduced. Resume assertions reject replay of the old tool-call ID while permitting the next attempt's actual tool execution.

Changed tests: `agui-bridge-hitl`, `agui-bridge-sse`, `agui-bridge-tool-call-events`, `agui-bridge-state-events`, `agui-bridge-planning-note-dedup`, `deep-agent-stream`, `deep-agent-hitl`, `deep-agent-model-provider`, `hitl-edit-real-db-e2e`, `workbench-agui-order`, and new `tests/support/agui-execution-journal.ts`. `agui-bridge-streaming` and `configured-model-provider-stream` were used unchanged as behavioral regressions; both passed in the focused run.
