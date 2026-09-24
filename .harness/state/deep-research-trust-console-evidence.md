# Deep Research 可信研究控制台验证证据

- Issue: #4083
- Branch: `codex/deep-research-trust-console`
- Date: 2026-09-24

## Automated verification

- Contracts: `research-trust.test.ts` — 4/4 passed.
- API trust/steering/evidence/quality plus persistence/orchestration regression: 69/69 passed in an isolated PostgreSQL test environment.
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

## Full baseline gate note

`./init.sh --full` passed the harness suite (165 files / 1,891 tests), all 45 typecheck/lint tasks, and continued through the repository test matrix. The run was not green because six unrelated `@repo/skill-sandbox` Office-generation tests timed out at their shared 60-second limit. An isolated rerun reproduced the same six timeouts (PPTX/XLSX/PDF/DOCX) while the remaining 79 sandbox tests passed. No skill-sandbox files are changed by this branch; the PR CI result remains the authoritative clean-environment signal.

## Real browser verification

Command:

```bash
pnpm --dir apps/web exec playwright test e2e/guided-research-trust-console.spec.ts
```

Result after review fixes: Chromium 1/1 passed in 23.8s.

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
