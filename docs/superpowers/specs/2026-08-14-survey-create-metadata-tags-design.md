# Survey Creation Metadata and Tag Filtering Design

Date: 2026-08-14
Status: Awaiting human review
Scope: Survey resource library and new-survey creation flow

## Goal

Make blank-survey creation and module-based creation explicit before entering the survey designer. Every new survey receives a required name and optional tags. Module-based creation additionally requires exactly one existing question module. The survey list exposes tags and supports tag filtering.

## Confirmed product decisions

- A survey can have multiple tags.
- Tags are optional.
- When multiple tag filters are selected, a survey matches when it contains any selected tag (OR semantics).
- Module-based creation selects exactly one question module as the starting point.
- The selected module is copied into the new survey. Later edits do not mutate the source module.
- A blank survey starts with no questions.
- A created survey opens the full survey workflow, including the timeline. It does not open the question-module editor.
- The persistent global rail and the three Survey secondary navigation entries remain visible.
- All work for this feature is isolated in one dedicated Survey worktree.

## Interaction design

### Blank survey

1. The user clicks `新建问卷` on the survey list.
2. A modal opens with:
   - required survey name;
   - optional multi-tag input;
   - cancel and create actions.
3. Tags are committed with Enter or comma, are removable individually, and duplicate normalized values are ignored.
4. Create is disabled until the trimmed name is non-empty.
5. On create, the app opens the full survey designer with zero questions.
6. The workflow header immediately shows the entered survey name.

### Survey from a question module

1. The user clicks `从问卷模块新建`.
2. The same metadata modal opens for the required name and optional tags.
3. After valid metadata is submitted, the modal advances to a question-module selection step.
4. Exactly one module can be selected. Continuing is disabled until a module is selected.
5. Confirming opens the full survey designer with a copied question set from that module.
6. The workflow header shows the entered survey name; the user can edit copied questions independently.
7. Back returns to metadata without losing the entered name or tags. Cancel closes the flow without creating anything.

### Survey list tag filtering

- Survey cards display their tags.
- The filter row contains a tag multi-select alongside text search and sort.
- Selecting zero tags applies no tag restriction.
- Selecting one or more tags uses OR semantics.
- Text search and tag filtering combine with AND semantics: a card must match the text query and at least one selected tag.
- The user can remove individual selected filters or clear all tag filters.
- Switching between Survey secondary sections clears Survey-list-only text and tag filter state so it cannot leak into modules or reports.

## State and data boundaries

- A single creation-draft object is the authority for `name`, `tags`, and optional `sourceModuleId` while the modal is open.
- The creation flow must not declare the same values independently in both path and query parameters.
- Navigation to the mock designer may serialize the draft once at the route boundary, but the workflow model must consume one authoritative decoded draft.
- Survey tags live on the survey resource model and are reused for card rendering and filtering; no separate filter-only tag catalog is maintained.
- Module questions are cloned at the model boundary, including their options arrays.
- Closing a creation modal resets its draft state.

## Error and edge behavior

- Whitespace-only names are invalid.
- Tags are trimmed; empty tags are discarded.
- Duplicate tags compare by their normalized display value and render once.
- An unknown or missing module identifier cannot create a module-based survey; the picker remains open and shows a recoverable validation message.
- Read-only workflow mode must not expose creation or editing actions.
- Browser back from the designer follows normal routing and returns to the Survey resource library.

## Accessibility

- The modal uses the repository's accessible dialog primitive with title and description.
- Name and tag controls have programmatic labels.
- All chips expose a named remove action.
- Template/module cards are keyboard selectable, have visible focus, and expose selected state.
- Validation messages are associated with their controls and announced when possible.

## Verification contract

- Component tests cover blank creation, required-name validation, multi-tag entry/removal/deduplication, and modal cancellation/reset.
- Component tests cover the two-step module flow, exactly-one selection, back-state preservation, and independent cloned questions.
- Resource-library tests cover visible card tags, OR tag filtering, combined text-plus-tag filtering, clearing filters, and section-switch reset.
- Workflow tests prove the entered title is shown, blank creation has zero questions, and module creation enters the full workflow rather than module mode.
- A route-level test verifies the persistent global rail and Survey secondary navigation remain around both list and designer routes.
- Targeted Survey tests, non-incremental TypeScript checking, design lint, and `git diff --check` must pass before review.

## Out of scope

- Persistence to a backend or database.
- Creating, renaming, or deleting the global tag taxonomy.
- Selecting or composing multiple question modules.
- Changes to report-module creation.
- Publishing, response collection, or report generation behavior.
