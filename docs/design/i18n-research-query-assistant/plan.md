# Research query assistant implementation plan

> Execute natively in this chat using the existing reviewer; no new worktree/chat/agent. Follow the existing TDD and execution-plan skills.

**Goal:** The live query brief assistant follows Chinese/English locale while preserving raw content and its request/state lifecycle.
**Architecture:** Existing useI18n provider and research namespace; display labels are separate from canonical quick-action messages.
**Tech stack:** Existing React/TypeScript, Vitest/Testing Library and registered Playwright fullstack lane.
**Spec:** [design.md](design.md), [issue6253](https://github.com/boardx/workspacex/issues/6253).

## Constraints and review focus

Keep original quick messages, raw typed/model/proposal/modelId values and storage bytes. Keep pending requests and input DOM/focus/selection across locale. Never auto-apply or replay on locale. Explicit apply/undo and controlled failure/retry retain original identity and semantics. No API/contracts/policy/runner/budget change; no new local Next build.

### Task 1 — Fixed copy and continuity

Files: new tests/ui/guided-research-skill-assistant-i18n.test.tsx; existing components/research-studio/guided-research-skill-assistant.tsx and lib/i18n/namespaces/research.ts.

- [x] Write English fixed-control RED, five supported step label/payload cases, same input/focus/selection, held pending turn, explicit apply/undo, raw saved history and error/retry without locale replay. Mock only the existing HTTP adapter boundary.
- [x] Run the new suite at worker1; confirm semantic missing-translation failures, record source/outputs privately with safe receipt.
- [x] Bind minimum render-time resources; preserve original Chinese, event/state/effect/request code. Separate each translated quick-action label from its unchanged canonical message.
- [x] Run new suite plus existing guided-research-skill-assistant, guided-research-skill-state, research-entry-i18n, research-overlays-i18n and resource parity once. Run scoped lint and canonical webtype. Freeze source with normal commits in a fresh sole window.

### Task 2 — Live query acceptance

File: existing e2e/i18n-research-entry.spec.ts; no config registration change.

- [x] Append one separately named original-budget query-entry case; keep the existing whole case byte-identical. Real login, query brief route, same-context locale updates, raw requirements, controlled pending/failure turn and actual contract payload. Explicit apply/undo, no locale-only turn,375/1280 captures and local control bounds.
- [ ] Discover through the canonical existing runner; normal hooks/push, independent bounded review and one PR Closes6253 to develop.
- [ ] Read exact remote native cases/attempts/skips/errors and individually view all actual images. Fix only real findings with RED/GREEN and fresh affected proof. No vendor/PG claim from controlled model interaction.

### Task 3 — Delivery and recorded prior evidence

- [ ] Record the five final safe B6 receipts/review and actual merge docs in this already-planned batch, preserving their exact source/hash and public review boundary.
- [ ] Publish safe current evidence, update issue/progress/handoff, preserve failed attempts separately. Current sourceCI/review green and coordinator actual merge required; no manual passing.
- [ ] Check exact owned resources0 and release each sole source window immediately after actual exit.
