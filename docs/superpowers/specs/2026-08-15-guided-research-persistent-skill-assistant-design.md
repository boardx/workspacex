# Guided Research Persistent Skill Assistant

## Goal

Make the guided research workspace use the same persistent left-side Skill assistant pattern as the Mock interview workflow. The assistant remains available from research brief through final report.

## Scope

- Render a research-specific assistant beside every non-home guided research step.
- Keep the current right-side step content, step navigation, session loading, and API calls unchanged.
- Match the interview workspace layout: a persistent assistant column on desktop and a usable collapsed presentation on narrow screens.
- Keep the research home/list screen unchanged.

## Component Design

- Add a focused `ResearchSkillAssistant` component under `apps/web/components/research-studio/`.
- It owns only assistant presentation and local conversation input state. It does not alter a guided research session, call an API, or change the active research step.
- `GuidedResearchFlow` becomes the layout owner for non-home steps, composing the assistant and the current step body in a shared flex workspace.
- The assistant copy, quick prompts, input, disclaimer, and visual hierarchy follow the existing interview assistant pattern, with research-specific wording.

## Responsive Behavior

- Desktop: the assistant is a fixed-width left column and remains visible while the right-side research content scrolls.
- Narrow screens: the assistant remains reachable without forcing the research form below a permanently wide column; it collapses into a compact, expandable panel above the step content.

## Error Handling

- Existing session-loading and step-level error states remain in the right-side content area.
- The assistant has no persistence or network dependency, so it cannot block research recovery or submission.

## Verification

- Add a UI test that renders a guided research step and asserts the persistent research assistant is present.
- Retain guided-research flow tests for server-authored state recovery and creation behavior.
- Run the relevant Vitest suite, web typecheck, and design lint.
