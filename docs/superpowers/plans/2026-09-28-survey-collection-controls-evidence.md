# Survey collection controls — issue #4452

User confirmed anonymous once-per-browser and the UI/use-case/API delta. Human merge only.

## Implemented boundaries

- Publication Markdown is the settings source. The shared compiler validates `responseLimitScope` and bounded `successMessageMarkdown`.
- Public projection reads the frozen publication snapshot, not newer draft settings. Legacy publications default to unrestricted submission and the existing thank-you text.
- Server-issued HMAC proof is publication-bound, HttpOnly and SameSite=Lax. The private key is stored outside the public model; no IP fingerprint is used.
- PostgreSQL aggregate transactions enforce one accepted receipt per browser proof. Replaying the same accepted receipt remains idempotent. Forged or missing proof is rejected.
- Success Markdown is sanitized and rendered after submission and on subsequent visits from the same browser. Clearing cookies or changing browsers permits another response; this is not person-level uniqueness.

## Fresh verification (2026-09-28)

- Shared contracts: `survey-collection-settings.test.ts`, 6 passed.
- Web UI: `survey-public-form.test.tsx` and `survey-live-workspace.test.tsx`, 23 passed.
- Isolated real API/PostgreSQL: `survey-source-http.test.ts` and `survey-source-lifecycle.test.ts`, 12 passed. Includes simultaneous submissions (201/409), accepted-receipt replay, forged/missing proof, independent browser acceptance and success projection.
- Seeded Playwright: `survey-complete-flow.spec.ts`, 3 passed. Includes custom success Markdown, respondent reload without another submission form, old-link question preservation, independent derived draft and optional report.
- API and Web TypeScript checks passed. `git diff --check` passed.
- `./init.sh` fast initialization passed; this is not a full-repository test claim.

Independent review found premature trimming during sequential Markdown typing. A regression reproduced missing spaces/newlines; the editor now preserves local raw text while validating the canonical document. Production HTTPS Secure-cookie roundtrip has not been observed; local browser and HTTP evidence must not be presented as that deployment evidence. GitHub checks remain a delivery gate. Real AI proposal generation (#4451) is separate unfinished work.
