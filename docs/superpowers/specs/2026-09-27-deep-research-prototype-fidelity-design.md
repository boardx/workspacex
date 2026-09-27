# Deep Research Prototype-Fidelity Design

## Goal

Rebuild the desktop `/research` experience to match the approved six-screen
Deep Research reference in composition, hierarchy, density, and interaction
affordances. This corrects the previous structural-only implementation: a
screen is not accepted merely because its named regions exist.

## Visual Contract

- Keep the existing WorkspaceX global product rail. Do not add a second,
  research-specific left navigation menu.
- Use the reference's blue-led Deep Research visual language through existing
  semantic design tokens: compact branded header, clear active-step treatment,
  light-blue panels, bordered cards, and primary action emphasis.
- Match the reference's desktop information architecture at 1440px: a compact
  research home; a top six-step progress rail; a main work canvas; and a
  contextual right rail only on stages where it supplies a decision.
- The reference is the source of truth for page composition, not merely labels.
  Each stage must visibly use its specified structure:
  1. searchable/filterable card grid and primary create action;
  2. three equal import routes plus an editable brief;
  3. structured topic/scope workspace beside an assistant;
  4. plan, key questions, methods, and source scope cards;
  5. task progress, activity timeline, source/evidence work, and risk rail;
  6. contents, document, report actions, and quality/source metrics.
- Continue using canonical Markdown plus structured runtime commands. The
  Markdown editor may not replace the visual stage composition with a generic
  full-width document card.

## Product Constraints

- Preserve routing, permissions, graph/version checks, evidence provenance,
  citation validation, conflict resolution, and resumable runtime behavior.
- Preserve truthful unavailable states for upload and live voice entry.
- Preserve loading, empty, error, saved, disabled, and responsive states.
- Existing WorkspaceX global chrome may differ from the reference; all visual
  comparisons judge the Deep Research content region, not browser or product
  chrome.

## Acceptance

- Browser-rendered screenshots at the same desktop state and viewport as the
  supplied reference demonstrate no actionable P0/P1/P2 composition, hierarchy,
  spacing, color, typography, or interaction-affordance differences.
- Stage contract tests assert structural compositions rather than only labels
  and `data-testid` presence.
- The six-stage journey works with real existing session data and Markdown
  persistence; no visual mock-only route is introduced.
- A project-root `design-qa.md` records source/implementation screenshots,
  comparison findings, fixes, and `final result: passed`.
