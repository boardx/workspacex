# Deep Research Six-Step Markdown UI Design

## Goal

Rebuild the desktop Deep Research experience around the approved six-screen
reference: research list, import brief, confirm topic, research plan, source
research, and report. Every generated artefact that a researcher can inspect,
edit, approve, or export is represented as Markdown, while the service keeps
its existing structured state for validation, citations, provenance, conflict
resolution, and resumable execution.

The outcome is a calm, professional research workspace that makes the next
decision obvious without weakening the existing trust guarantees.

## Confirmed Design Principles

- The supplied image is the desktop visual and information-architecture
  reference, not an instruction embedded in an asset.
- The workflow has six visible stages: `研究列表` → `导入需求` → `确认研究主题`
  → `研究计划` → `资料研究` → `研究报告`.
- AI output is never rendered as opaque JSON or a collection of disconnected
  fields. Each stage has a canonical Markdown artefact as its visible,
  copyable, and editable output.
- Markdown is a presentation and authoring format, not a replacement for
  structured research state. Sources, source IDs, evidence quotes, approval
  checkpoints, revision versions, and conflict resolutions remain server-owned
  structured data.
- Existing evidence verification, rejected-source persistence, report citation
  validation, human conflict resolution, and session restore behavior are
  non-negotiable.

## Scope

### Included

1. A `Deep Research` desktop shell that starts directly beside the existing
   WorkspaceX product rail, with top six-step progress, a primary work canvas,
   and a contextual research assistant rail. It does not introduce a second
   left navigation menu.
2. A redesigned research home that uses search, filters, compact research
   cards, clear status, and a primary `新建研究` action.
3. A six-stage session view that maps current runtime nodes to the approved
   product vocabulary without losing route or checkpoint compatibility.
4. Markdown editors and previews for the brief, topic confirmation, research
   plan, source-research findings, and report.
5. A Markdown document adapter that derives deterministic, editable document
   text from existing structured drafts and parses validated edits back into
   the corresponding structured command payloads.
6. Stage-level loading, empty, error, saved, disabled, and conflict states;
   all primary interaction points receive stable `data-testid` anchors.
7. Component and browser-level coverage for the six-stage desktop path and
   Markdown round trips.

### Excluded

- Replacing the existing runtime with Markdown persistence only.
- Treating unverified Markdown as sourced evidence.
- New file upload, ASR, or document-export backends. The UI may expose the
  existing entry points, but unavailable integrations must be explicitly
  labelled rather than simulated.
- A mobile-first redesign. The implementation remains responsive, but desktop
  fidelity to the supplied reference is the acceptance target.

## Workflow And State Mapping

The visible stage is intentionally separate from the existing runtime node.
This preserves the proven API and enables an additive UI migration.

| Visible stage | Runtime/checkpoint source | Canonical visible Markdown |
| --- | --- | --- |
| 1. 研究列表 | session history | card summary (read-only) |
| 2. 导入需求 | `brief` draft | research brief |
| 3. 确认研究主题 | confirmed `brief` + generated directions | topic and scope decision |
| 4. 研究计划 | confirmed directions + outline + `researchPlan` | objectives, key questions, methods, and source plan |
| 5. 资料研究 | tasks, sources, evidence, activities, conflicts | live findings and evidence log |
| 6. 研究报告 | validated report chapters and synthesis | final cited report |

The stage mapper must only expose a completed or available stage when the
runtime already permits the relevant node. Navigation does not bypass server
confirmation or graph-version checks.

## Markdown Artefact Contract

Each document begins with an H1 title and uses stable H2 sections. The adapter
owns the schema and serialization; individual screens must not create a second
copy of headings or parsing rules.

### Brief

```md
# 研究需求

## 研究主题
...

## 研究目标
...

## 时间与地区
...

## 重点关注
...
```

### Topic and plan

Topic confirmation records the selected scope and enabled directions. Research
planning records the research question, section objectives, key questions,
method, expected outputs, and source strategy. Human edits may change content
inside the allowed headings; the adapter rejects missing required headings,
empty required sections, duplicate IDs, and an outline with no enabled section.

### Source research

The source-research document is generated from runtime activity, accepted and
excluded sources, evidence gaps, and resolved conflicts. It is a readable
Markdown evidence log, but it is not an alternate source of truth. Source IDs
and canonical citations are displayed as non-editable metadata or are validated
strictly when carried through Markdown. A researcher can add interpretation or
next-step notes, never fabricate source provenance through an edit.

### Report

The report remains generated from validated chapters and cited sources. The
existing inline `[[source:<id>]]` marker rule remains required. The UI presents
the same Markdown in reading and editing modes; saving invokes existing report
revision flows and retains citation validation before the report can become
publishable.

## Desktop Layout

At desktop widths, the screen has three visual regions:

1. The product rail remains unchanged.
2. The main canvas begins immediately after the product rail and contains the
   title, six-step progress bar, and the current
   stage document or workspace.
3. A right assistant rail appears only where helpful, showing stage-specific
   suggestions, evidence warnings, active work, and a deliberate action to
   apply a suggestion. It never silently changes a Markdown document.

On narrower viewports, rails collapse before the main document does, preserving
logical keyboard order and avoiding horizontal page scroll. This is a desktop
workflow, so the wide view prioritizes readable documentation, source rows, and
the activity timeline rather than card density alone. The existing WorkspaceX
global sidebar is not duplicated inside the research module.

## Reference-Stage Layouts

The supplied six-panel reference is the interaction and layout source of truth.
The product shell may retain WorkspaceX chrome, but each stage must use the
reference's own composition rather than a generic document card.

| Stage | Reference composition | Required runtime behavior |
| --- | --- | --- |
| 1. 研究列表 | searchable research cards, filters, a `新建研究` action, and a compact assistant entry point | open or continue an existing session; empty and loading states stay truthful |
| 2. 导入需求 | three equal entry choices for upload, live voice, and text; an optional brief area and explicit next action | unavailable upload/voice integrations are disabled with an explanation; text creates the normal brief draft |
| 3. 确认研究主题 | structured brief form in the center and a right-side assistant that proposes scope refinements | assistant output is an explicit suggestion; saving or applying always persists through the runtime command |
| 4. 研究计划 | plan summary, key questions, methods, and source-scope cards with an explicit start action | enabled outline sections remain the server-authoritative research boundary |
| 5. 资料研究 | task-progress rail, live activity timeline, and a compact insight/risk rail | tasks, source decisions, evidence gaps, conflicts, and resume state remain live structured data; Markdown is the inspectable artefact |
| 6. 研究报告 | table of contents, report document, export actions, and source/quality metric tiles | citation validation and publication readiness remain prerequisites for a verified report |

The contextual assistant appears on stages 1–3 and 5 when it supplies a clear
next decision. It must not leave an empty reserved desktop column on stages
where it is absent.

## Component Boundaries

- `guided-research-flow.tsx` owns session selection, visible-stage mapping,
  route compatibility, and composition.
- `guided-research-six-step-shell.tsx` owns the shared desktop rails and top
  progress contract.
- `guided-research-markdown.ts` owns Markdown serialization, parsing, required
  headings, validation errors, and structured-payload conversions.
- `guided-research-markdown-workspace.tsx` owns preview/edit mode, unsaved
  changes, save feedback, and Markdown-specific accessibility.
- Stage components own only their stage-specific form, status panels, and
  primary actions. They consume the adapter rather than hand-writing Markdown.
- The API runtime and report generation retain ownership of structured state,
  evidence, citations, and execution side effects.

## Interaction Rules

- All generated content opens in preview mode with an explicit `编辑 Markdown`
  action. A visible dirty state appears before a user can save.
- Saving validates the document locally, then sends a structured command with
  the current graph version. A version conflict leaves the draft visible and
  offers reload/compare rather than overwriting work.
- Applying an assistant suggestion creates or updates the Markdown draft but
  never confirms a checkpoint or starts research without the existing explicit
  confirmation action.
- The source-research stage combines a clear task list, live activity feed,
  source count, evidence gaps, and conflict card. Human conflict resolution
  still requires a rationale and is persisted atomically.
- Report export operates from the validated report document only. Markdown
  draft changes that have not passed report validation cannot be exported as a
  verified report.

## States, Accessibility, And Visual Rules

- Every data-fetching stage has a skeleton (`data-testid="loading"`), an empty
  state (`data-testid="empty"` where applicable), and a structured error alert.
- All inputs have labels; Markdown preview has a descriptive region label;
  edit/save/cancel controls are keyboard reachable with visible focus.
- Current, completed, locked, and failed steps communicate via text and icon in
  addition to color.
- Existing semantic color tokens, shadcn components, typography scale, and
  Tailwind spacing are reused. No hard-coded color values, arbitrary pixel
  values, bare form elements, or custom design-token copies are introduced.

## Failure Handling

- Runtime recovery failure stays distinguishable from an empty study list.
- Markdown parse or validation failure identifies the affected section without
  discarding the user's editor text.
- Server graph-version conflicts preserve local Markdown and reload the latest
  remote version only after a deliberate user choice.
- A failed source task is shown as an evidence gap. It may not be converted to
  a successful finding by report generation or Markdown editing.
- Missing integrations such as upload or speech input are disabled with a
  truthful explanation; they do not create a fake attachment or transcript.

## Verification Contract

1. Unit tests prove each structured state serializes into stable Markdown and
   permitted Markdown edits convert back to valid payloads.
2. Unit tests reject deleted required headings, malformed section metadata,
   source-ID mutation, and invalid citations while preserving unsaved text.
3. UI tests prove the desktop shell has six named stages, each stage exposes
   a Markdown document surface, and assistant suggestions require an explicit
   apply action.
4. UI tests cover loading, empty, error, dirty, save-success, and
   graph-conflict states for the Markdown workspace.
5. API tests retain report citation validation and conflict-resolution
   persistence; no Markdown request can bypass either rule.
6. Browser verification at desktop width proves the approved primary path:
   create/open research → import brief → confirm topic → inspect plan → observe
   source research → read the cited Markdown report.
7. Relevant web/API tests, type checks, design lint, and the repository PR
   checks must pass before a PR is created.

## Risks And Mitigations

- Markdown parsing can become a second uncontrolled schema. Mitigation: one
  adapter module owns headings and parsing, while server schemas stay final
  validators.
- Making all source data editable risks fabricated provenance. Mitigation:
  source identity, quotes, evidence links, and resolution history are rendered
  from structured state and cannot be authored freely.
- A six-stage facade might accidentally bypass established graph gating.
  Mitigation: visible-stage mapping is derived from `availableNodes` and every
  state-changing action keeps `expectedVersion` / graph-version semantics.
- A visually faithful shell may crowd out research content. Mitigation: the
  main Markdown canvas has priority; rails collapse on smaller widths and
  assistant output is contextual rather than permanently dominant.
