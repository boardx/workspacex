# Survey #3754 verification

Verified against isolated local PostgreSQL/Redis/API and the real Next.js application. No mocked HTTP responses in the browser journey.

- Create, edit, save, reload, publish, independently submit an anonymous response, inspect the response, generate and reload the report: passed (`browser-result.json`).
- Three actual scale responses (2, 3, 4) rendered as table, bar, radar, daily trend and target gap: passed (`charts-result.json`).
- Actual Word downloads include the complete report and chart images (`report.docx`, `charts.docx`). PDF verification checks the complete isolated print document and invocation of print, not an OS print-dialog download (`print-report.html`).
- Final focused tests: 22 web UI tests and 13 compiler tests passed. API persistence/auth/public-submission tests: 10 passed. Earlier full contracts suite: 809 passed. API/web type checks and scoped lint passed.
- Independent review found two issues (duplicate question labels and missing captions); both fixed and retested. Hidden iframe layout waiting is bounded and covered by a regression test.

Reproduce browser journeys from `apps/web` with an isolated, migrated and preset-account-seeded API and matching Next.js proxy:

```sh
SURVEY_API_URL=http://127.0.0.1:API_PORT SURVEY_WEB_URL=http://127.0.0.1:WEB_PORT node scripts/survey/live-check.cjs
SURVEY_API_URL=http://127.0.0.1:API_PORT SURVEY_WEB_URL=http://127.0.0.1:WEB_PORT node scripts/survey/charts-check.cjs
```

These scripts create test surveys/answers and reject non-loopback services. Credentials are the repository development preset, not a production account.

## Handoff / boundaries

Personal-owner surveys only. AI content suggestions, project-member sharing, reusable question/template resource libraries and QR-code delivery remain follow-up work under #3754. Template JSON import/export is implemented. Existing prototype pages require explicit `preview=1`; production routes never fall back to seeded data. Migration must be deployed before using the new routes. Reports use configured blocks and real data; they do not invent analysis or benchmark values.
