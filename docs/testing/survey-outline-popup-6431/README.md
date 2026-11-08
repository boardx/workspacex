# Survey outline popup (#6431)

The designer toolbar now opens the question outline in the shared accessible Dialog. The element toolbox no longer contains the outline. Search and question reordering remain available. Selecting a question closes the popup, scrolls its canvas item into view and focuses it; Escape/close restores the toolbar trigger. Locked surveys retain read-only outline navigation, and save-disabled state disables popup controls. The non-studio legacy editor keeps its inline outline.

No API, schema, survey content or persistence change. Existing diagnostics and undo/redo tests now access the outline through its new trigger rather than assuming it is always mounted.

Validation:

- `./init.sh`: standard quick path PASS.
- `pnpm --filter web exec vitest run tests/ui/survey-outline-popup.test.tsx tests/ui/survey-responsive-designer.test.tsx tests/ui/survey-live-publishing.test.tsx tests/ui/survey-designer-i18n.test.tsx tests/ui/survey-question-controls-i18n.test.tsx tests/ui/survey-question-types.test.tsx`: 202 PASS.
- Web TypeScript and scoped ESLint on changed files: PASS.
- Three isolated behavior cases fail on the original editor and pass on the candidate; initial temporary Vite configuration errors were test setup failures, not product counterexamples.
- Real local browser with a temporary 16-question preview: toolbar opens popup; search filters; selection closes and focuses the chosen canvas card; reorder changes first question and undo restores it; 375px popup stays inside viewport (left16/right359), no document overflow, Escape returns trigger focus. See browser-result.json and screenshots.

The temporary preview route and local server were removed/stopped after verification. Browser evidence uses synthetic local data and does not prove authenticated backend writes or production deployment. No production browser, account or funds were changed.
