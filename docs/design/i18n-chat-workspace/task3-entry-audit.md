# Task3 entry audit

Current canonical roots are imported by `copilotkit-v2-panel-view.tsx`; this is a code reachability ledger, not browser acceptance.

| Current root | Next actual display surface | Preserve |
| --- | --- | --- |
| V2AssistantMessage / V2UserMessage | author identity, action chrome, local suggestion dismissal, structured trace chrome | raw Markdown/code/model suggestions/attachments, authoritative run author, message IDs and stable content nodes |
| CopilotKitV2MessageActionsProvider | copy, details, landing form, remember-statement trigger | actual clipboard text, selected/raw message, confirmation requirement, payload and provenance |
| CopilotKitV2ToolRenderers | tool status, empty/failure/approval/result wrappers | tool name/arguments/results, protocol enums and execution prompts |
| CopilotKitV2AgentInterrupts / RestoredRunApproval | pending/restored HITL form, Escape/deny/allow/once outcomes | canonical run/decision IDs, stale guards and exact existing write count |
| QueuedMessagesPanel / QueueNextTurnAction | queued/dispatched/running/completed/error presentation | canonical queue row identity, run completion, actual current reply association |
| TaskTimeline / ChildCancellationNotice | run stages, child cancellation/read-only notices | persisted state and runtime order; no model rerun for locale |

`AgentIdentityRow` already consumes `useAgentDirectoryMap`. That existing shared hook scopes/cache-fetches reviewed entity display by locale and session, independent of this i18n task. Do not silently remove its locale-aware catalog behavior or mistake it for a newly introduced Chat history/run/write refetch. New author-label formatting should use existing approved official-name helper with explicit locale; organization-authored names stay raw. Authoritative run ID remains preferred over current composer selection.

The Chinese instructions passed to `useConfigureSuggestions` and other model/tool execution prompts are protected protocol/input content. Generated suggestions are model content. Translate only owned controls and authored user-editable shortcut examples at their explicit insertion boundary.

Task3 counterexamples must cover raw braced/mixed-language text and IDs, locale changes while a decision/queue request is pending, unchanged message/draft DOM and exact mutation counts. Real provider/model quality remains outside controlled fixture claims. Task2 independent review does not accept these surfaces.
