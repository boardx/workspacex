# Design workbench iteration and development handoff — Refs #5647

## Authorized scope

The user reported that existing HTML designs refused new-page requests, asked to move the device selector to the header, and reported that pushed development-scheduling items omitted design details.

## Result

- The HTML planner can describe new pages without generating them, or generate additions using existing HTML as style anchors. `addScreen` appends only new pages; all additions precede link writeback so a new page can link to later additions. Failed batches return no patch. Existing pages are edited only when requested. Page caps are reported before drawing rather than silently truncating the plan.
- HTML editor/generator interaction notes now accompany successful patches into storage.
- Device selection and rotation are always visible in the canvas header, using the same device state and presets as before. Switching a device remains a preview operation, not a project write.
- Organization inbox design items now include the full current project. Publishing tokens are explicitly excluded. The drawer previews pages and navigation, displays the complete design document, and exports the full design data, original HTML and component trees as JSON. Design issue drafts include the design document and a link back to the complete handoff. HTML page text is no longer clipped at 160 characters in design documents.

## Validation

- `./init.sh`: passed (pnpm 9.15.0, workspace-safe cache, unused desktop Electron download disabled).
- API: 199 tests passed across HTML generation/editing, model behavior, project lifecycle, image preservation, retry, inbox projection, and design issue creation.
- Web: 271 tests passed across design-loop UI and design document exports.
- Contracts: 109 tests passed for inbox and design workbench contracts.
- API, web and contracts typecheck passed; API and web lint passed; `git diff --check` passed.

Focused API tests use a temporary config with `export default { test: { include: ['tests/design-workbench/*.test.ts'], maxWorkers: 1, minWorkers: 1 } };` to avoid the PostgreSQL global setup. From `apps/api`, run `pnpm exec vitest run --config <path> tests/design-workbench/html-page-generation.test.ts tests/design-workbench/inbox-projection.test.ts tests/design-workbench/design-chat-model.test.ts tests/design-workbench/project-lifecycle.test.ts tests/design-workbench/create-design-github-issue.test.ts tests/design-workbench/design-image-src.test.ts tests/design-workbench/design-chat-transient-retry.test.ts`.

Regressions exercise four original pages plus ten AR pages (original HTML, notes and navigation preserved), adding Profile with a selected element, planning only, new-to-new navigation, failed generation, page caps, persisted interaction notes, full inbox/issue detail including HTML text beyond the old excerpt, publishing-token exclusion, and device switching before opening Appearance.

## Boundaries

New pages are covered with fake model ports, not a real-model visual acceptance. Reference image metadata is preserved in the full design package; reference file bytes remain in existing storage. The inbox reflects the current project, not an immutable snapshot of its first push. No production project was modified or deployed during local verification.
