# Deep Research 可信研究控制台验证证据

- Issue: #4083
- Branch: `codex/deep-research-trust-console`
- Date: 2026-09-24

## Automated verification

- Contracts: `research-trust.test.ts` — 6/6 passed, including strict-domain and calendar-range validation.
- API trust/steering/evidence/quality plus persistence/orchestration regression: 72/72 passed in an isolated PostgreSQL test environment.
- Web trust/readiness/live/report suites: 52/52 passed.
- Contracts, API, and Web TypeScript checks passed.
- API lint passed.
- Web ESLint, token synchronization, and design lint passed.
- CI spec reachability and Tailwind color-token gates passed.

## Independent review remediation

The first independent review found five important issues; all were converted to failing tests and fixed:

1. Durable idempotency receipts are evaluated before optimistic revision conflicts.
2. Internal source selection uses an explicit authorization port and defaults to deny.
3. Unsupported mixed claims cannot be marked publication-ready.
4. Legacy completed reports without readiness data display `质量待评估`, not an unconditional success state.
5. Activity-event merge/deduplication is used by the production trust console.

The final independent review found three additional boundary risks; all were converted to
regression tests and closed:

1. Internal research sources now pass through the repository's authoritative
   `guard`/`disclose` ACL path. A real PostgreSQL test proves that two researchers in the
   same project but different teams cannot cross a `team-only` artifact boundary.
2. A `restrict` source policy with no domain is rejected by both the contract and the UI,
   rather than silently behaving like open-web search.
3. Time boundaries accept calendar dates only and reject a start date later than the end
   date in both the contract and the UI.

## Full baseline gate note

`./init.sh --full` passed the harness suite (165 files / 1,891 tests), all 45 typecheck/lint tasks, and continued through the repository test matrix. The run was not green because six unrelated `@repo/skill-sandbox` Office-generation tests timed out at their shared 60-second limit. An isolated rerun reproduced the same six timeouts (PPTX/XLSX/PDF/DOCX) while the remaining 79 sandbox tests passed. No skill-sandbox files are changed by this branch; the PR CI result remains the authoritative clean-environment signal.

## Real browser verification

The seeded full-stack lane now verifies the trust console through the real UI, API, and isolated PostgreSQL database:

```bash
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.fullstack-smoke.config.ts --project=seeded guided-research-runtime.spec.ts
```

Result after the final ACL/source/time-boundary fixes: Chromium 1/1 passed; the browser test
itself completed in 1.7 minutes (4.6 minutes including isolated stack startup). It confirms
persisted intent/time range, enforced restricted-domain policy, pause/resume across reload,
question-level verbatim evidence, coverage, quality/readiness, and
planning/searching/reading/writing/validation activity.

The deterministic responsive preview remains a separate visual acceptance lane:

Command:

```bash
pnpm --dir apps/web exec playwright test e2e/guided-research-trust-console.spec.ts
```

Result after review fixes and merging the latest `origin/main`: Chromium 1/1 passed in 20.7s.

The real browser verified:

1. Required intent fields block confirmation until complete.
2. `restrict` source mode and domain input are operable.
3. Activity, steering, coverage, claim evidence, conflict, quality, and readiness regions render.
4. Pause and resume update the visible activity state.
5. An open severe conflict produces “带限制完成”.
6. Remediating evidence changes server-shaped preview state to “可发布” and clears the conflict.
7. Desktop and 390×844 mobile layouts have no horizontal overflow.

Generated screenshots (local Playwright evidence):

- `apps/web/test-results/guided-research-trust-cons-9ddc8-g-and-publication-readiness-chromium/trust-console-ready.png`
- `apps/web/test-results/guided-research-trust-cons-9ddc8-g-and-publication-readiness-chromium/trust-console-mobile.png`

The desktop CUA connector timed out twice before returning browser state, so browser verification used the repository's real Chromium Playwright lane rather than treating the connector failure as product failure.
