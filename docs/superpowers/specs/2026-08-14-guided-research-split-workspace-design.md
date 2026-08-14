# Guided Research Split Workspace Design

## Goal

Make the guided research workflow follow the established interview workspace pattern: a complete AI conversation workspace on the left and a compact step workspace on the right, while giving the final report the full content width needed for reading.

## Scope

- Keep the research home and history list unchanged.
- Apply the split workspace to `brief`, `directions`, `outline`, and `search`.
- Render `report` in a dedicated full-width reading mode without the AI conversation column.
- Preserve the existing guided-research state machine, API calls, session restoration, checkpoint behavior, Skill suggestion semantics, and test IDs unless this design explicitly adds a layout contract.
- Do not change the global product navigation rail or introduce new routes, dependencies, persistence, or backend behavior.

## Layout

### Guided steps

At the large-screen breakpoint, the step workspace uses a three-part grid expressed as a one-third/two-thirds relationship:

- Left: the research Skill conversation occupies one third of the available research content width.
- Right: progress, heading, forms, cards, sources, and primary actions occupy the remaining two thirds.
- The two columns share the full available height below the product header.
- The layout must not reintroduce a separate research navigation menu between the product rail and the research content.

Below the large-screen breakpoint, the existing collapsible Skill-first ordering remains: the Skill section is available above the step workspace and the step content stays usable without horizontal scrolling.

### AI conversation workspace

The left column is a complete conversation surface rather than a small card:

- Header and explanation at the top.
- Step-specific quick prompts below the header.
- Scrollable conversation history consumes the flexible middle region.
- Pending suggestion and undo controls remain inside the conversation history flow.
- Composer stays at the bottom of the visible workspace.
- Existing send, apply, undo, message persistence, step isolation, and session isolation behavior remains unchanged.

The assistant surface visually follows the interview Skill assistant: a full-height bordered workspace with no nested floating-card impression.

### Compact right workspace

The right column keeps all existing content and interactions but reduces unnecessary vertical expansion:

- Progress uses a compact single-row treatment.
- Heading-to-content, card-to-card, and content-to-action spacing are tightened.
- Cards use compact padding where doing so does not reduce form readability or target size.
- Primary actions stay easy to find and remain at the end of the step flow.
- Form controls, source rows, and outline/direction editors retain their current accessible labels and interactive states.

## Full-width report mode

The final report hides the Skill conversation column and uses the entire guided-research content width.

- Progress and report heading remain visible at the top.
- The old `14rem / article / 19rem` three-column layout is removed because it compresses the article.
- The table of contents becomes a compact horizontal navigation block above the report body.
- The main report article receives the dominant width.
- Sources and citations use a secondary right column on wide screens and move below the article on narrower screens.
- The report keeps existing navigation actions, citations, source filtering, headings, and semantic anchors.

## Component Boundaries

- `guided-research-step-layout.tsx` owns the responsive one-third/two-thirds shell and full-height Skill placement.
- `guided-research-skill-assistant.tsx` owns conversation height, scrolling, and composer placement; it does not own page navigation or research state transitions.
- `guided-research-flow.tsx` chooses split mode for the first four steps and full-width mode for the report, and owns the compact step/report composition.
- Existing mock/state/API modules remain unchanged unless a test reveals an existing layout-independent bug.

## States And Accessibility

- Loading, restore failure, empty history, disabled primary action, pending Skill suggestion, and undo states retain current behavior.
- Keyboard users can reach quick prompts, message actions, composer, progress navigation, form controls, and report anchors in a logical order.
- The Skill conversation and right workspace each avoid nested page-level horizontal scrolling.
- The mobile disclosure summary remains keyboard accessible.
- Existing semantic colors and spacing tokens are reused; no hard-coded colors, pixel styles, or new token copies are introduced.

## Verification Contract

Automated tests must prove:

1. `brief`, `directions`, `outline`, and `search` render the split workspace contract.
2. The desktop split layout exposes a one-third Skill column and two-thirds main workspace through a stable layout attribute or class assertion.
3. The Skill assistant is a full-height conversation surface with a scrollable message region and bottom composer.
4. `report` does not render the Skill assistant and renders a full-width report layout.
5. The report no longer uses the narrow three-column `toc-report-citations` contract.
6. Existing guided flow, checkpoint, Skill apply/undo, typecheck, and design-lint tests remain green.

Visual verification must compare the implemented research step at a desktop viewport with the supplied interview reference, then compare the full report with the supplied narrow-report screenshot. The result passes only when the conversation column visibly occupies about one third on steps and the report article is no longer compressed.

## Risks

- A viewport-height calculation that ignores the product header can create double scrollbars; the shell should reuse the existing header offset and keep only the conversation history scrollable.
- Making the assistant width literal rather than proportional would drift from the approved one-third layout on larger screens.
- Reusing the split wrapper for the report would preserve the current narrow-reading defect; report mode must be selected explicitly.
- Tightening all padding indiscriminately could reduce editor usability; compactness applies primarily to page rhythm and summary cards, not minimum interactive target sizes.

## Confirmed Follow-up: Single-page Step Navigation

The guided workflow remains one `/research` page. `brief`, `directions`, `outline`, `search`, and `report` are component states, not separate browser navigations.

- Moving between checkpoints updates React state without `window.location.assign`, a Next.js route transition, or a document reload.
- The address is normalized to `/research`; `flow` is not rewritten for every checkpoint.
- A browser refresh returns to the research home. Persisted sessions remain resumable from the history list through the existing API state.
- Initial legacy `flow` and `session` query values may still be read for backward-compatible entry, but the first in-page transition normalizes the address.

The desktop composition also changes at the page-shell level:

- The guided flow uses the full available content width rather than a centered `max-w-6xl` island.
- On guided steps, the Skill assistant occupies the left third from the content area's left edge.
- The five-step progress control and current step content share the right two-thirds column.
- On the report step, the progress control keeps the right-column alignment while the report body remains full width below it.

Automated tests must prove that an in-page checkpoint click changes the rendered step while preserving the document and calling `history.replaceState` rather than a navigation API.
