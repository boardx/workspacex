# Survey6251 bounded fixture/caption review

Base: fbbd0beb6d82e6b36280f8de1c9020d2f74b20d4
Exact HEAD: 72b0dd34a7e1e03338c43635743dc4fc50d1cb79

Verdict: **STATIC CLEAN for the four-file source/test delta. No confirmed actionable P1/P2.** Current gate execution and browser acceptance are not certified here.

- Actual apps/packages/.github diff is exactly question-material.tsx, i18n-survey-journey.spec.ts, survey-design.ts and survey-question-controls-i18n.test.tsx. No API, contracts, workflow, parser/encoding or other product change in scope.
- Author driver now explicitly opens the real Advanced rules summary (question-settings.tsx:297–299; EN resource exactly Advanced rules), checks actual native txt checkbox, and waits for autosaved runtime allowedExtensions.includes(txt). Existing Required toggle/raw-title poll remains; this is an authored question setting, not a bypass of upload validation.
- Actual checkbox onChange appends only selected extension to existing allowedExtensions and spreads other config. Original contract defaults remain pdf/png/jpg; maxFiles/maxFileBytes are untouched. Driver additionally checks all original defaults plus txt before publication and equality of published file-question allowlist to the saved configuration. It does not change policy constants or silently rewrite the upload MIME/name/bytes.
- Independently parsed all three top-level test declarations and compared text: template and intake statements are completely byte-identical, only moved before author. Original order author/template/intake becomes template/intake/author. Preamble/helper source is byte-identical.
- Reproduced owner proof hashes using complete statement plus trailing LF: template308517aa7e615a3ddcd79c534b79f032b96ddf4853cabf8e4f947748f05b4c71; intake7d89100d188e4848554475e3091ea74227e6669e50989480084fe883eb3ff6dc. Both match before/after proof. These are independent cases; reordering reduces maxfail starvation without deleting or shortening author.
- Author text from original const bytes=Buffer.from onward through its upload/submit/governance/32-response/report/Markdown/Word/PG/finally body is byte-exact against base. Original ASCII raw filename and55-byte fixture, permission assertions, IDs, sample matrix, rate-window wait and other downstream expectations are unchanged.
- All three180000ms test budgets, worker/retry configuration and core assertions remain. No auto-retry, skipped case, lower sample/privacy threshold, spoofed peer or altered source policy.
- QuestionMaterial replaces only its fixed signature hint literal with existing provider t(new typed key); zh resource is exactly the original caption, EN explicitly retains the non-electronic-contract-certification meaning. Canvas, typed signature draft, drawing/save/clear callbacks, file/signature limits and upload lifecycle are untouched.
- Existing signature continuity test keeps original same-canvas/same-input DOM, raw draft value, enabled-save and callback assertions, and adds exact visible zh and EN hint assertions. No test weakening.
- Read safe ci-fixture-order-fix-proof.json; its scope/body hashes/order/policy/budget assertions match static checks. Author-reported valid RED and ongoing GREEN/lint were not rerun or accepted here. No dynamic PASS is inferred from reordering or static proof.

No tests/type/lint/init/build/browser/network/raw trace/log reads or source/index/branch edits. No6253/whole/AI behavior re-review. Only exact git objects/static AST/byte comparisons and this private report write. Later metadata does not alter this exact source verdict unless source changes.
