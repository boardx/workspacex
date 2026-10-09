# Design workbench HTML chat preservation — Refs #5521

## Reproduction from code

`describeProject` replaces each HTML node with visible-text summaries. Without a selected HTML node, `reply` previously accepted tree writeback as a whole-prototype replacement. An output reported as truncated also fell back to paged generation whose outline progress could overwrite existing pages with null placeholders before the iteration finished.

## Change

Existing root HTML pages use a routing-only model call to choose existing page indices, then the existing HTML editor receives each selected page's full original HTML and recent conversation. Results are assembled into one patch; any invalid page output abandons the entire patch. Discussion responses do not edit the design. New/delete-page requests on this HTML path currently return an explanation instead of rebuilding existing pages. Selected element editing is unchanged. Existing designs reject intermediate progress writes; first generation retains streaming progress.

## Validation

- `./init.sh`: passed with pnpm 9.15.0, workspace-safe cache directories and `ELECTRON_SKIP_BINARY_DOWNLOAD=1` (desktop Electron is not needed for this API change).
- `pnpm --filter @repo/api typecheck`: passed.
- `pnpm --filter @repo/api lint`: passed.
- Five focused fake-port suites: **173 tests passed** (HTML generation/editing, design chat model, project lifecycle, uploaded image preservation, transient model retry).
- `git diff --check`: passed.

The focused suites ran from `apps/api` with a temporary config to avoid the main config's PostgreSQL global setup. Reproduce the config with `export default { test: { include: ['tests/design-workbench/*.test.ts'], maxWorkers: 1, minWorkers: 1 } };`, then run `pnpm exec vitest run --config <config-path> tests/design-workbench/html-page-generation.test.ts tests/design-workbench/design-image-src.test.ts tests/design-workbench/design-chat-model.test.ts tests/design-workbench/project-lifecycle.test.ts tests/design-workbench/design-chat-transient-retry.test.ts`.

Regressions cover unselected-page routing, preserving untargeted pages, full HTML above 40,000 characters, three consecutive edits, malformed/truncated routing, failure on a later page with no partial writeback, and preventing progress placeholders from overwriting an existing design.

## Live boundary

The user URL responds HTTP 200. No authenticated production project data, real-model trace, or third-image reference was available in this environment. No production data was modified and no lost design was restored. These checks prove the application paths with fake model ports; they do not prove production deployment or a real model's visual fidelity.
