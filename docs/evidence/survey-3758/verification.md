# Verification — issue #3758

- `./init.sh`: passed baseline initialization.
- `pnpm --filter web typecheck`: passed.
- `pnpm --filter web lint`: passed including design lint.
- Targeted Vitest: 5 files, 50 tests passed (builtin catalog/compiler, builtin workspace/apply, live library including delayed GET race, resource library).
- `SURVEY_API_URL=http://127.0.0.1:24640 SURVEY_WEB_URL=http://127.0.0.1:25640 node apps/web/scripts/survey/builtin-templates-check.cjs`: passed against isolated local API/Postgres/Redis and real web.
- Browser verified original six question modules and four report presets; edit builtin → save personal copy → reload persisted copy → original unchanged; use builtin → publish real survey → anonymous answer → generate report from actual answer. No simulated responses or editor instructions in generated report.
- Screenshots in `screenshots/` show restored libraries and real report.

Report presets restore reference structure and real statistical blocks. Narrative analysis blocks remain empty until filled with actual evidence; this is surfaced in template description. No fabricated historical samples, targets, conclusions, or timestamps are seeded. Existing personal data is untouched.

Independent review identified and fixed a late library GET overwriting a newly created copy, and fixed static methodology text that assumed a 1–5 scale after remapping.
