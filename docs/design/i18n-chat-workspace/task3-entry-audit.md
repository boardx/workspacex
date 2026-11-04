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

## Actual display boundary audit after first provider counterexamples

| Surface | Owned chrome / semantic facts | Protected raw content / current evidence |
| --- | --- | --- |
| ConfirmIntentCard | card title, editor/assumption labels, decided/gated notice and buttons | understanding/assumptions and edits stay raw; form4 provider cases pass; full browser pending |
| FillParamsCard | missing/required/AI-guess/application-mode notices | field names/labels/options/value/rationale stay raw; supportsLedgerOnly gate unchanged |
| ChooseOptionCard | fixed comparison rows and contract effort enum display | model option titles/time/return and optionId stay raw; explicit click only |
| RestoredRunApproval | pending/history/repeat/reopen copy and owned fallback error | raw argument summary and unknown Error.message; canonical DTO/once pending POST/observer tests pass, original regressions pending |
| RunTracePanel | wrapper/status/count/details/source-url labels | journal status wins over message running flag; JSON/progress Markdown/raw results protected; wrapper tests pass |
| RunTraceLiveStrip / Preview | derived running/completed/wait-duration facts and recent-row chrome | original timer effect/status/preview limit and raw argument projections protected; new tests actual RED; render implementation pending fresh GREEN |
| CopilotKitV2ToolRenderers | tool title, plan/status/search/result wrapper controls | registry wire names, SDK parameters/results and authoritative journal outcome protected; actual SDK-renderer tests actual RED; render implementation pending fresh GREEN |
| RunInterjections | receipt/applied/carried-over/not-applied status and explicit resend control | durable event status remains authoritative; user interjection text and resend callback payload stay raw; tests actual RED; render implementation pending fresh GREEN |
| ChildCancellationNotice | no fixed display copy in this projection | supplied text is rendered verbatim; do not translate arbitrary input by matching Chinese substrings |
| FollowUpSuggestions | only the local chip dismissal accessibility label is owned here | generated title/message, supplied local chip label and existing model instructions remain input content; pending dedicated counterexample |

This table is a source/render boundary audit, not real route coverage or a completion denominator. Message-rating/landing/citation wrappers, plan/subtask records, remaining error/status paths and all Task4 inspectors/overlays still need their own executed evidence.


Current validation boundary:all35 new provider cases passed in the25-suite137-case round; sole old static controller/view source-location assertion was corrected without removing order/uniqueness and subsequently the original9-case escalation thread suite passed. The four-file command that included this targeted rerun was later terminated during new suggestion-suite collection; it is not a whole-command GREEN or5semanticRED. Cumulative production typecheck exited0 before this later test-only isolation change; scoped ESLint remains pending. Pending partial-HITL host/rating/suggestion tests must reach actual assertions before any corresponding production edits. Current source remains private uncommitted WIP, no Chat PR/browser acceptance.

## Remaining message-action/reference preparation

New `i18n-chat-landing.test.tsx`3 and `i18n-chat-citations.test.tsx`2 are UNRUN; no production edits to these surfaces. Landing tests exercise the actual canonical message-action context and actual shared landing state hook with only the API edge mocked, including persisted message ID versus a non-rateable wire ID, draft title/body, pending locale and known failure rendering. Citation tests exercise actual persisted scope/Markdown/list with only open-report edge mocked, protecting raw source title/range/code and one open report across locale changes.

Ruling: a generic artifact fallback title is authored UI content; localize it only at explicit open, retaining default-Chinese compatibility for old callers and never rewriting an existing title/draft on locale change. A locale argument may be added to the pure local open/title formatter, not to the asynchronous submit request or its dependencies. Why: the empty-first-line fallback is not model/user text, whereas every nonempty model title stays raw. Cost if wrong: a localized initial fallback could be confused with a user-edit, so tests must prove exact submission and draft continuity.

Ruling: page-number prefixes and citation location-kind labels are owned presentation, while source names/transcript ranges/message IDs are raw. Localize from the structured contract anchor in a pure display projection, never by parsing/translating the existing anchor string. Locale may affect that display memo only; open-report code and its explicit-click/deduplication semantics remain unchanged. Cost if wrong: remapping citation projection could reset an open item or report another open; the new tests explicitly preserve DOM/open state and exact report count.

Shared microphone scope correction:actual `MicDevicePicker` in `chat-composer-pickers.tsx` still has Chinese fixed labels. Task2's verified device cases exercise ChatComposerVoiceControl's internal menu, not this shared exported picker. Firstphase recording issue6214 explicitly requested and received display ownership of MicDevicePicker only (raw devices/labels/IDs/value/onSelect and shared device hook unchanged). This Chat worker will not edit that function concurrently or borrow the other menu's GREEN as its acceptance. After its actual dependency merge, normal develop sync and shared audio-input namespace reuse must remove the private Chat default/anonymous-name duplicate; do not copy unmerged source or invent already-merged status. Record the remaining shared gap until real evidence arrives.

## Post-maintenance closing audit

Independent maintenance #6215→PR6216 published exact26cf with original3casePASS and normalhooks27/27; main owns its CI/queue. Chat66WIP files/modes and18ignored logs restored and verified byte-for-byte. No maintenance source copied into this branch. Latest partial Chat evidence is recorded in progress; earlier UNRUN/diagnostic hypotheses above are historical and do not override the later validRED/GREEN/hook-root-cause corrections.

The final readonly AST pass included StringLiteral/JSXText/NoSubstitutionTemplateLiteral and TemplateHead/Middle/Tail. It found one remaining owned fixed surface in canonical V2AssistantMessage: V2ToolCallsView's collapsed legacy-tool projection (when no durable trace covers the message). It is an actual supported canonical rendering path, not the unrelated legacy composer. New2 real SDK/provider counterexamples are written UNRUN for singular/plural count, accessible region, locale-preserved disclosure DOM/state and raw message/tool arguments. Production remains unchanged before semanticRED. Protected remaining literals: default-Chinese date branch, contract effort values低/中/高, model execution instructions, and legacy landing-error formatter fallback already reprojected at render; do not mechanically translate them. TaskTimeline itself has no fixed Han literals in the inspected source; this is source evidence, not full browser proof.
