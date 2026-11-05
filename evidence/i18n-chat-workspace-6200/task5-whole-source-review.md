# Chat6200 whole source static review — frozen dirty snapshot

## Binding and verdict

Base: ddf28f7e91e5c65bb7f63d1a9bf2c3b82f2f11df.
Durable HEAD: f6957e3177b37b9a03f4f749bf6b2742f05581b3, plus the explicitly captured uncommitted PlanControl work.
Authoritative reviewed manifest **file SHA256**: 1d65af8f5d9317e419c695c2d957372f602a752b3bddfbb3523e7c5b61479e4a.
Request payload SHA b03c7581866143372c0fafdd06e02651f8c64ca497014e2299ff9d2089ef8e19 is a serialization/payload identifier, not a Git SHA; its difference from the LF-terminated file hash was explicitly clarified by coordination. Independently checked all 426 copied file hashes against manifest: zero mismatches. No mutable WT source was substituted. Unchanged dependency context was read at immutable f695/base, except installed package parsing tools.

**Not CLEAN: two grouped P2 findings below. No confirmed P1 or new execution/permission/security regression found.** This is the requested whole-source pass, not a fresh runtime verdict. Subsequent author fixes must be reviewed as their actual source delta; they are not silently included in this frozen verdict.

## Confirmed actionable findings

### P2-1 — canonical run/recovery and related own notices still project Chinese strings in English

Primary locations: apps/web/components/chat/copilotkit-v2-panel-body.tsx:1343–1350; copied view :355 and inspector :677 consume this label verbatim. Trigger: English canonical Chat during active SSE or authoritative reload/run restoration. The controller sets owned Chinese labels for running/queued/plan confirmation/writeback/paused/tool approval and imports fixed RUN_RESTORE_PHASE_LABEL. Neither renderer translates these semantically, so the actual English running/inspector surface still shows Chinese. This is fixed application copy, not a caller/model-generated value. Coordination explicitly confirmed this seam is within Chat i18n scope.

The same producer-to-render audit confirms the following connected fixed-copy seams need the same concentrated pass, rather than another partial locale patch:

| Source / exact location | Trigger / English leak | Provenance-preserving fix boundary |
| --- | --- | --- |
| Unchanged f695 lib/copilotkit-v2-run-progress.ts:123,128,139–143,166,171; lib/agent-run-phase.ts:49–88 and phaseLabelForCallSkillArgs | Accepted/context/model/tool/skill/reply SSE events supply fixed Chinese phase wrappers to the same panel/inspector | Carry semantic phase/tool/skill identity or typed owned-label descriptor. Localize only owned wrappers; real tool name/stable name/server skillDisplayName remain verbatim. Do not localize execution args or resubscribe on locale. |
| panel-body :724,859–865 | Trace rehydration failure and authority-restore auth/stalled/unconfirmed fallback messages stay Chinese | Store structured failure kind/cause and render owned fallback at current locale. Preserve cancellation and raw/custom failure text policy. |
| panel-body :414,459,876,1532,1549; immutable lib/copilotkit-v2-error-copy.ts:76–95 and lib/copilotkit-v2-failure-banner.ts:71,81,155 | Known run error/transport codes and recovered-success notice become Chinese strings stored in error/notice, then view :414/:424 renders strings unchanged | Preserve closed code/reason or owned outcome provenance through state; render translated known messages/advice. Do not turn arbitrary Error/model strings into guessed translations or change retry/reattach/recovered decisions. |
| panel-body :1119,:1121 | Saved real-time call cannot immediately merge / no recognized speech | Owned error/notice still Chinese; use render-only semantic notice while preserving real persistence lifecycle and once behavior. |
| panel-body :1406–1407 | Start/finish/failure accessibility announcements always Chinese | Announce using current display locale with stable transition tracking; do not alter SSE subscription or add resend/retry. |
| panel-body :1762 and :487–489 view; immutable use-template-recommendations.ts:152,160,178–183 | Generated-template/persona suggestion labels and known persona local failures still Chinese | Translate own generate/running/error prefix and fallback; keep t.displayName if caller/model-owned, t.prompt, IDs, message content, and explicit onSelect actions unchanged. |

Impact: the requested complete EN canonical Chat language behavior is not met on actual running/reload/error/voice/suggestion states, even though most headings are translated. A provider test using a custom raw phase label should still preserve that label; it does not cover these known fixed producers.

### P2-2 — remaining reachable fixed chrome bypasses the current locale

| Frozen source location | Trigger / visible own copy | Required minimal correction |
| --- | --- | --- |
| apps/web/components/chat/chat-composer-attachments.tsx:817, MessageAttachments | Render an actual skill-draft attachment in a canonical user message: badge is literal 技能草稿 | Consume provider and existing typed skill-draft display copy; keep file name, ID, isSkillDraftFile predicate and preview/upload lifecycle unchanged. ProducedFileInlineCard is translated separately and does not fix this sibling path. |
| apps/web/components/feedback/feedback-dialog.tsx:1031 | Chat-opened global feedback overlay successfully saves a draft: literal Chinese draft-saved receipt | Localize the receipt only; keep saved draft content, ID/route/storage/submit semantics unchanged. No new drafts feature is requested. |
| apps/web/components/chat/copilotkit-v2-plan-control.tsx:511 and :520 | Existing run-controls surface exposes canResume or an action error: resume button / operation-failed wrapper remain Chinese | Reuse typed PlanControl keys at render. Preserve raw error code, actual resume callback and canWrite/busy gates. Pause :518 is likewise untranslated but remains behind disabled CHAT_RUN_PAUSE_ENTRY_ENABLED; do not enable it or treat disabled pause as missing functionality. |

These are direct literal render sites, not translations of user/model/file content. They are inside the requested current Chat reachable nested scope. Fixing them requires copy/ARIA only, not a behavioral refactor.

## Whole-source review coverage and counterchecks

Actual inventory: 426 paths = 222 apps/web source/test/config paths + 10 docs + 194 evidence files; zero deleted rows. The 222 consist of 84 component paths, 27 other product/helper paths, 28 i18n paths, 81 unit/test paths, one E2E spec and one Playwright config. No production API or contracts changes exist in this snapshot. Full path inventory is appended below. Evidence bytes were hash-verified; raw traces/context/private logs were not opened, and not every evidence payload was semantically audited.

- **Controller/view extraction:** checked retained controller ownership and view props/context boundaries. AST comparison finds exactly 48 original effect/callback/memo calls with the same ordered dependencies; only one callback body changes, storing original history failure cause instead of a formatted string. Session/run/thread registration, hydrate cancellation, SSE, send, queue, voice and attachment callbacks remain in the controller; view is a stable top-level component, not an inline component factory. Locale lives in render-only children. Draft/caret/multibyte text are not rewritten by locale.
- **Across changed components:** static hook dependency audit found no locale added to request/connection/polling/reset effects. Intended exceptions are citation display-map memo [messages,locale] and feedback's explicit user-triggered applyTemplate callback [kind,detail,locale]. Graph adds only [data] kind/relation lookup memos; layout/initial/placed/reset remain locale-independent. No locale-based React key was introduced in inspected paths; semantic row/action/retrieval keys replace translated labels where needed.
- **Permissions/HITL:** forms keep original args/enums/selected values and submission callbacks. Restored and persisted approval retain canWrite/pending/permissionRequestId gates, disabled recorded forms, existing native Radix close/Escape behavior, request keys and decision-once semantics. Changes to min-width/fieldset geometry are rendering only; prior 375 failure still requires actual browser proof. No independent fresh geometry QA was performed.
- **Raw/provenance:** directory name translation uses official catalog provenance and matching requestedLocale projections; raw roster duty/name/abbr and custom names remain unchanged. Execution prompts, model suggestions, authored goals, code/tool arguments, files and IDs are not indiscriminately regex-translated. Known owned errors use typed code/key/cause carriers; unknown callbacks preserve existing raw/fallback policies.
- **Task entry/suggestions:** original TASK_WORKBENCH_TEMPLATES initializer is byte-exact after extraction. zh returns the canonical same reference; English goals are authored prefill on explicit click only. Stable template IDs/tones and no-auto-send remain. Existing generated prompt strings are not translated by locale rendering.
- **Composer/voice/upload/preview:** upload cancellation origins/local IDs/removal identities, limits/retryable classification, raw file metadata and actual bytes remain unchanged. New error-copy descriptors preserve legacy zh text while formatting UI at render. PPTX/blob/fetch/abort/revoke effects keep original dependencies. Voice/real-time callbacks preserve stale generation/run guards and transcript content; locale does not start/stop/reconnect or send.
- **Message/tool/run/queue:** raw message and tool payload paths remain; tool/chunk disclosure chrome and known status keys change display. Queue edits retain exact pending text and IDs; retry/cancel/enqueue callbacks not changed. Live run/trace pages preserve original state derivation, raw results and authoritative terminal facts. Fixed Chinese phase producer omission is P2-1 above.
- **Inspector/artifacts/versions:** canonical tab IDs and loaded-source identity remain; manual tab/collapse state is not keyed by locale. Source effects keep thread/artifact/project/token/refresh identities, cancellation and callback-ref handling. Versions/CAS/read-only gates, download names/bytes and regeneration instruction remain unchanged. Existing generic/security-sensitive artifact failure policy is preserved rather than exposing unknown exception internals.
- **Knowledge/memory:** reviewed canonical graph/list/source/action/promotion/citation parents, raw-error carrier seams and child callbacks. Same claim/object IDs, input statements, scope/owner and write gates, revision/action contracts and source selection remain. Graph nodes/edges get localized display kind/relation via raw canonical IDs; placement/reset data is locale-independent. Callback errors preserve known owned failure class provenance without replacing custom messages.
- **Feedback:** saved-inbox scope/context/memo/encoded link remains; draft/body/structured kind+field serialization remains canonical. Only explicit template application creates localized authored field headings in editable body; ordinary locale changes do not rewrite existing content. Attachment upload/retry/voice/receipt state remains. Missing draftSaved own chrome is P2-2.
- **Default zh / namespace:** extracted AGENT_RUN_ERROR_TEXT and AGENT_RUN_FAILURE_REASON_TEXT initializers are independently byte-exact against base, as is task-template initializer. Compatibility exports and optional-locale defaults remain. No literal-placeholder mismatches were found in paired changed namespace literals. Static relative runtime dependency traversal from i18n/messages covered 78 source modules and found no cycle; type-only imports excluded. This is not a typecheck/bundle execution.
- **Tests/config:** new provider tests exercise actual renderers and raw/focus/no-extra-call boundaries, with relevant existing cases retained. E2E registration exists; config original limits/retries are not relaxed. Existing evidence includes actual Task4 532 and same-round native seven browser passes, but later geometry failure and ENOSPC no-report/zero-PNG attempt supersede any complete acceptance claim. Current PlanControl RED/WIP is explicitly not GREEN. I ran none of these commands and do not infer browser or CI success from filenames/counts.

## Minor / deferred items

- Minor documentation hygiene: comments in plan-confirm-gate.tsx:65, plan-failure-recovery.tsx:18 and several other display files contain mechanically inserted literal t(...) expressions inside Chinese prose. They do not execute, but should read as explanatory prose when next touched; not a release blocker by themselves.
- Runtime checks deferred to the owned serial window: rapid locale+thread switch during active SSE, multipart/file bytes and preview close/revoke lifecycle, inflight approve/deny/Escape/focus return, mobile HITL right edge, permission-denied skill overlay, queue dispatch, generated versions and feedback/knowledge nested overlays. Static effect preservation is evidence of noninterference, not proof of runtime behavior.

## Declined to judge (explicit scope discipline)

- Non-i18n preexisting execution/queue/permission/polling races: no independently introduced regression identified; latest main ruling explicitly defers behavioral fixes outside this batch.
- Disabled pause entry, unmounted PlanStaleBanner/direct-auto exports and legacy-only ComposerSettings/AgentToolChain: do not infer a new-feature requirement from exported code. Existing reachable resume/action-error copy is assessed above without enabling pause.
- Execution instruction strings such as follow-up generation prompt and “记住：{statement}”: intentional raw/canonical input, not UI translation targets.
- Real-time discard audit reason, role status enum literals, raw custom label/error/model/organization/file names: preserve semantic wire or authored text, not translate by Han substring.
- MessageLanding's default-zh compatibility error string and CitationDetail's undefined-callback rejection: first is superseded by rendered raw-cause formatting; second is guarded out by correctable=false. Not counted as reachable UI omissions.
- Feedback attachmentBadge fallback 文件 is not reached for the typed nonempty MIME split path; not claimed as an observed gap.
- PNG/image quality, model vendor semantics, server/API authorization implementation, raw-artifact historical safety audit and all CI/merge/publication status: not independently accepted here. No private raw image/trace was opened. Latest image QA belongs to author and retains known failure boundaries.
- Later owner work (including newly prepared restore provider test and three-file neighbor fix mentioned after snapshot freeze): outside this manifest; review only its true delta later.

## Source inventory

- apps/web/components/agent-interrupts/choose-option-card.tsx
- apps/web/components/agent-interrupts/confirm-intent-card.tsx
- apps/web/components/agent-interrupts/fill-params-card.tsx
- apps/web/components/agent-kernel/risk-badge.tsx
- apps/web/components/agent-kernel/tool-permission-card.tsx
- apps/web/components/chat/agent-escalation-card.tsx
- apps/web/components/chat/agent-plan-panel.tsx
- apps/web/components/chat/attachment-extraction-notice.tsx
- apps/web/components/chat/capability-edition-note.tsx
- apps/web/components/chat/chat-artifact-view.tsx
- apps/web/components/chat/chat-artifacts-panel.tsx
- apps/web/components/chat/chat-attachment-preview-modal.tsx
- apps/web/components/chat/chat-attachment-slides-preview.tsx
- apps/web/components/chat/chat-attachment-view.tsx
- apps/web/components/chat/chat-composer-attachments.tsx
- apps/web/components/chat/chat-composer-current-status.tsx
- apps/web/components/chat/chat-composer-status-bar.tsx
- apps/web/components/chat/chat-composer-voice-control.tsx
- apps/web/components/chat/chat-materials-panel.tsx
- apps/web/components/chat/chat-realtime-voice-entry.tsx
- apps/web/components/chat/chat-roster-panel.tsx
- apps/web/components/chat/chat-skill-mount-panel.tsx
- apps/web/components/chat/chat-task-inspector.tsx
- apps/web/components/chat/chat-task-workbench-capability-picker.tsx
- apps/web/components/chat/chat-task-workbench-empty-state.tsx
- apps/web/components/chat/copilotkit-v2-agent-identity.tsx
- apps/web/components/chat/copilotkit-v2-agent-interrupts.tsx
- apps/web/components/chat/copilotkit-v2-assistant-message.tsx
- apps/web/components/chat/copilotkit-v2-message-actions.tsx
- apps/web/components/chat/copilotkit-v2-panel-body.tsx
- apps/web/components/chat/copilotkit-v2-panel-view.tsx
- apps/web/components/chat/copilotkit-v2-plan-control.tsx
- apps/web/components/chat/copilotkit-v2-shell.tsx
- apps/web/components/chat/copilotkit-v2-tool-renderers.tsx
- apps/web/components/chat/document-generation-auto-approve-toggle.tsx
- apps/web/components/chat/knowledge/answer-knowledge-footer.tsx
- apps/web/components/chat/knowledge/answer-memory-line.tsx
- apps/web/components/chat/knowledge/citation-detail.tsx
- apps/web/components/chat/knowledge/claim-action-dialog.tsx
- apps/web/components/chat/knowledge/claim-edit-menu.tsx
- apps/web/components/chat/knowledge/claim-source-drawer.tsx
- apps/web/components/chat/knowledge/claim-time-badges.tsx
- apps/web/components/chat/knowledge/conflict-prompt-card.tsx
- apps/web/components/chat/knowledge/extraction-feedback-chip.tsx
- apps/web/components/chat/knowledge/knowledge-graph-canvas.tsx
- apps/web/components/chat/knowledge/knowledge-graph-view.tsx
- apps/web/components/chat/knowledge/knowledge-list.tsx
- apps/web/components/chat/knowledge/knowledge-panel.tsx
- apps/web/components/chat/knowledge/memory-card.tsx
- apps/web/components/chat/knowledge/memory-overview-card.tsx
- apps/web/components/chat/knowledge/nomination-card.tsx
- apps/web/components/chat/knowledge/promotion-result-list.tsx
- apps/web/components/chat/knowledge/session-briefing.tsx
- apps/web/components/chat/knowledge/supersede-notice-line.tsx
- apps/web/components/chat/knowledge/turn-memory-line.tsx
- apps/web/components/chat/knowledge/use-promotion-flow.ts
- apps/web/components/chat/message-citations.tsx
- apps/web/components/chat/message-landing.tsx
- apps/web/components/chat/message-rating.tsx
- apps/web/components/chat/plan-step-action-list.tsx
- apps/web/components/chat/produced-file-inline-card.tsx
- apps/web/components/chat/produced-file-pdf-preview.tsx
- apps/web/components/chat/project-chat-context-bar.tsx
- apps/web/components/chat/realtime-voice-session.tsx
- apps/web/components/chat/subtask-run-panel.tsx
- apps/web/components/chat/thread-list-shell.tsx
- apps/web/components/chat/workbench/agent-artifact-versions-panel.tsx
- apps/web/components/chat/workbench/interrupt-decision-dialog.tsx
- apps/web/components/chat/workbench/queue-next-turn-action.tsx
- apps/web/components/chat/workbench/queued-messages-panel.tsx
- apps/web/components/chat/workbench/restored-run-approval.tsx
- apps/web/components/chat/workbench/run-interjections.tsx
- apps/web/components/chat/workbench/run-trace-live-preview.tsx
- apps/web/components/chat/workbench/run-trace-live-strip.tsx
- apps/web/components/chat/workbench/run-trace-panel.tsx
- apps/web/components/feedback/feedback-dialog.tsx
- apps/web/components/feedback/feedback-provider.tsx
- apps/web/components/feedback/feedback-structured.tsx
- apps/web/components/plan-control/plan-confirm-gate.tsx
- apps/web/components/plan-control/plan-failure-recovery.tsx
- apps/web/components/plan-control/plan-panel-edit.tsx
- apps/web/components/plan-control/plan-panel-readonly.tsx
- apps/web/components/plan-control/plan-phase-indicator.tsx
- apps/web/components/plan-control/plan-run-progress.tsx
- apps/web/e2e/i18n-chat-workspace.spec.ts
- apps/web/lib/agent-directory.ts
- apps/web/lib/agent-escalation.ts
- apps/web/lib/agent-kernel-risk.ts
- apps/web/lib/agent-run-error-labels.ts
- apps/web/lib/agent-run.ts
- apps/web/lib/capability-picker-model.ts
- apps/web/lib/chat-failure-copy.ts
- apps/web/lib/chat-task-templates.ts
- apps/web/lib/chat-workbench/agent-artifacts.ts
- apps/web/lib/chat-workbench/artifact-failure.ts
- apps/web/lib/chat-workbench/plan-failure-shape.ts
- apps/web/lib/chat-workbench/tool-label.ts
- apps/web/lib/chat/subtask-run.ts
- apps/web/lib/i18n/chat-task-copy.ts
- apps/web/lib/i18n/messages/en.ts
- apps/web/lib/i18n/messages/zh-CN.ts
- apps/web/lib/i18n/namespaces/artifact-versions.ts
- apps/web/lib/i18n/namespaces/capability-edition.ts
- apps/web/lib/i18n/namespaces/chat-attachments.ts
- apps/web/lib/i18n/namespaces/chat-composer.ts
- apps/web/lib/i18n/namespaces/chat-entry.ts
- apps/web/lib/i18n/namespaces/chat-errors.ts
- apps/web/lib/i18n/namespaces/chat-escalation.ts
- apps/web/lib/i18n/namespaces/chat-inspector.ts
- apps/web/lib/i18n/namespaces/chat-interactions.ts
- apps/web/lib/i18n/namespaces/chat-interrupts.ts
- apps/web/lib/i18n/namespaces/chat-knowledge.ts
- apps/web/lib/i18n/namespaces/chat-landing.ts
- apps/web/lib/i18n/namespaces/chat-message-failures.ts
- apps/web/lib/i18n/namespaces/chat-permissions.ts
- apps/web/lib/i18n/namespaces/chat-picker.ts
- apps/web/lib/i18n/namespaces/chat-plan-control.ts
- apps/web/lib/i18n/namespaces/chat-realtime.ts
- apps/web/lib/i18n/namespaces/chat-restored-approval.ts
- apps/web/lib/i18n/namespaces/chat-roster.ts
- apps/web/lib/i18n/namespaces/chat-runs.ts
- apps/web/lib/i18n/namespaces/chat-skills.ts
- apps/web/lib/i18n/namespaces/chat-tools.ts
- apps/web/lib/i18n/namespaces/chat-trace.ts
- apps/web/lib/i18n/namespaces/chat.ts
- apps/web/lib/i18n/namespaces/feedback-overlay.ts
- apps/web/lib/knowledge-graph-citation.ts
- apps/web/lib/knowledge-graph-copy.ts
- apps/web/lib/knowledge-graph-failure.ts
- apps/web/lib/knowledge-graph-labels.ts
- apps/web/lib/knowledge-graph-recall.ts
- apps/web/lib/live-chat.ts
- apps/web/lib/live-omni-conversation.ts
- apps/web/lib/plan-control-copy.ts
- apps/web/lib/plan-control-display-labels.ts
- apps/web/lib/plan-control-display.ts
- apps/web/lib/plan-control-owned-status.ts
- apps/web/lib/session-briefing-view.ts
- apps/web/lib/tool-result-eviction.ts
- apps/web/lib/workflow-catalog-title-copy.ts
- apps/web/playwright.chat-read.config.ts
- apps/web/tests/chat-agent-name-i18n.test.ts
- apps/web/tests/chat-failure-i18n.test.ts
- apps/web/tests/chat-message-failure-i18n.test.ts
- apps/web/tests/chat-picker-copy-i18n.test.ts
- apps/web/tests/chat-recall-legacy-name-i18n.test.ts
- apps/web/tests/chat-tool-label-i18n.test.ts
- apps/web/tests/plan-control-summary-i18n.test.ts
- apps/web/tests/ui/chat-task-inspector-artifact-in-panel.test.tsx
- apps/web/tests/ui/copilotkit-v2-live-failure-cause-banner.test.tsx
- apps/web/tests/ui/escalation-thread-record.test.tsx
- apps/web/tests/ui/i18n-chat-answer-knowledge-footer.test.tsx
- apps/web/tests/ui/i18n-chat-answer-memory-line.test.tsx
- apps/web/tests/ui/i18n-chat-artifact-detail.test.tsx
- apps/web/tests/ui/i18n-chat-artifact-source.test.tsx
- apps/web/tests/ui/i18n-chat-artifact-version-progress.test.tsx
- apps/web/tests/ui/i18n-chat-artifact-version-surfaces.test.tsx
- apps/web/tests/ui/i18n-chat-artifact-versions.test.tsx
- apps/web/tests/ui/i18n-chat-attachment-preview.test.tsx
- apps/web/tests/ui/i18n-chat-attachment-surfaces.test.tsx
- apps/web/tests/ui/i18n-chat-attachment-view.test.tsx
- apps/web/tests/ui/i18n-chat-attachments.test.tsx
- apps/web/tests/ui/i18n-chat-canonical-chrome.test.tsx
- apps/web/tests/ui/i18n-chat-capability-edition.test.tsx
- apps/web/tests/ui/i18n-chat-capability-picker.test.tsx
- apps/web/tests/ui/i18n-chat-citation-detail.test.tsx
- apps/web/tests/ui/i18n-chat-citations.test.tsx
- apps/web/tests/ui/i18n-chat-composer-continuity.test.tsx
- apps/web/tests/ui/i18n-chat-entry.test.tsx
- apps/web/tests/ui/i18n-chat-escalation.test.tsx
- apps/web/tests/ui/i18n-chat-feedback-attachments.test.tsx
- apps/web/tests/ui/i18n-chat-feedback-chrome.test.tsx
- apps/web/tests/ui/i18n-chat-feedback-dialog.test.tsx
- apps/web/tests/ui/i18n-chat-feedback-draft-quota.test.tsx
- apps/web/tests/ui/i18n-chat-feedback-final-chrome.test.tsx
- apps/web/tests/ui/i18n-chat-feedback-history-preview.test.tsx
- apps/web/tests/ui/i18n-chat-feedback-receipt.test.tsx
- apps/web/tests/ui/i18n-chat-feedback-voice-host.test.tsx
- apps/web/tests/ui/i18n-chat-inspector-lists.test.tsx
- apps/web/tests/ui/i18n-chat-inspector.test.tsx
- apps/web/tests/ui/i18n-chat-interjection.test.tsx
- apps/web/tests/ui/i18n-chat-interrupt-forms.test.tsx
- apps/web/tests/ui/i18n-chat-interrupt-host.test.tsx
- apps/web/tests/ui/i18n-chat-knowledge-actions.test.tsx
- apps/web/tests/ui/i18n-chat-knowledge-conflict.test.tsx
- apps/web/tests/ui/i18n-chat-knowledge-graph.test.tsx
- apps/web/tests/ui/i18n-chat-knowledge-list.test.tsx
- apps/web/tests/ui/i18n-chat-knowledge-menu-time.test.tsx
- apps/web/tests/ui/i18n-chat-knowledge-panel-actions.test.tsx
- apps/web/tests/ui/i18n-chat-knowledge-panel.test.tsx
- apps/web/tests/ui/i18n-chat-knowledge-promotion.test.tsx
- apps/web/tests/ui/i18n-chat-knowledge-source.test.tsx
- apps/web/tests/ui/i18n-chat-landing.test.tsx
- apps/web/tests/ui/i18n-chat-materials-notice.test.tsx
- apps/web/tests/ui/i18n-chat-memory-api-failure.test.tsx
- apps/web/tests/ui/i18n-chat-memory-cards.test.tsx
- apps/web/tests/ui/i18n-chat-memory-notices.test.tsx
- apps/web/tests/ui/i18n-chat-memory-parent-errors.test.tsx
- apps/web/tests/ui/i18n-chat-message-actions.test.tsx
- apps/web/tests/ui/i18n-chat-message-identity.test.tsx
- apps/web/tests/ui/i18n-chat-message-queue.test.tsx
- apps/web/tests/ui/i18n-chat-permission-display.test.tsx
- apps/web/tests/ui/i18n-chat-plan-display.test.tsx
- apps/web/tests/ui/i18n-chat-plan-nested.test.tsx
- apps/web/tests/ui/i18n-chat-produced-file.test.tsx
- apps/web/tests/ui/i18n-chat-rating.test.tsx
- apps/web/tests/ui/i18n-chat-realtime-entry.test.tsx
- apps/web/tests/ui/i18n-chat-realtime-session.test.tsx
- apps/web/tests/ui/i18n-chat-restored-permission.test.tsx
- apps/web/tests/ui/i18n-chat-roster.test.tsx
- apps/web/tests/ui/i18n-chat-run-trace.test.tsx
- apps/web/tests/ui/i18n-chat-session-briefing.test.tsx
- apps/web/tests/ui/i18n-chat-shell.test.tsx
- apps/web/tests/ui/i18n-chat-skill-mount.test.tsx
- apps/web/tests/ui/i18n-chat-slides-preview.test.tsx
- apps/web/tests/ui/i18n-chat-subtasks.test.tsx
- apps/web/tests/ui/i18n-chat-suggestions.test.tsx
- apps/web/tests/ui/i18n-chat-supersede-parent-errors.test.tsx
- apps/web/tests/ui/i18n-chat-tool-disclosure.test.tsx
- apps/web/tests/ui/i18n-chat-tool-renderers.test.tsx
- apps/web/tests/ui/i18n-chat-trace-live.test.tsx
- apps/web/tests/ui/i18n-chat-voice-control.test.tsx
