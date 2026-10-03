# #5271 verification

Exact source 4c0017fd2cb42102c53b89258162a16e58ea37ab. Commands sequential in survey-report-echarts WT, PATH=/Users/shenyangjun/.npm-global/bin:$PATH (pnpm9).

- `pnpm --filter web exec vitest run tests/ui/survey-import-page.test.tsx tests/ui/survey-route-layout.test.tsx tests/ui/survey-app-shell.test.tsx`: exit0, 12tests/3files (frontend-green.log).
- `pnpm --filter web typecheck`: exit0 (typecheck-web.log).
- `pnpm --filter web exec next lint --max-warnings 0 --file components/survey/live/survey-import-workspace.tsx`: exit0, zero warnings (lint-web.log).
- `pnpm --filter @repo/api exec tsx /private/tmp/survey-all-buttons-20261004/return-runtime.ts`: Web-only production build/start, 124pages, Ready150ms (preview-build.log).

No runner product/Git/UI edits. Only Next-generated include removed after build; source hash identical. Runtime details and private backup hashes in preview-runtime.md.
