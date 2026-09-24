# Deep Research 可信研究控制台验证证据

- Issue: #4083
- Branch: `codex/deep-research-trust-console`
- Date: 2026-09-24

## Automated verification

- Contracts: `research-trust.test.ts` — 4/4 passed.
- API trust/steering/evidence/quality: 22/22 passed in an isolated PostgreSQL test environment.
- API persistence/orchestration regression: 47/47 passed in an isolated PostgreSQL test environment.
- Web trust/readiness/live/report suites: 23/23 passed.
- Contracts, API, and Web TypeScript checks passed.
- API lint passed.
- Web ESLint, token synchronization, and design lint passed.

## Real browser verification

Command:

```bash
pnpm --dir apps/web exec playwright test e2e/guided-research-trust-console.spec.ts
```

Result: Chromium 1/1 passed in 14.0s.

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
