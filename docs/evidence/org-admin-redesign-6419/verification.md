# Organization content redesign — #6419

## Scope

Right-side content for organization overview, members, invitations, profile, workflow permissions and member Credit quota. Existing AppShell/AdminNav/rail remain unchanged. No backend, billing policy, production configuration or authorization changes.

The supplied references guide hierarchy and layout. Unsupported historical trend, last-active, growth and profile metadata are not invented. Overview uses server-provided model distribution and supported Today/Week/Month windows. Enterprise aggregate Credit has no cap; member monthly limits remain separate from Token quotas.

## Verification

- `./init.sh`: existing fast initialization path passed.
- Targeted UI regression: 7 files / 64 tests passed, covering data failure, cross-organization isolation, locale changes, pagination, filters and mutation boundaries.
- `next lint --max-warnings 0`: passed.
- Real Chromium with controlled localhost HTTP fixtures: three specs passed, covering all six real routes at 375/768/1280 pixels, no document overflow, search/pagination/no-match, profile save, quota adjustment and drawer Escape/no mutation.
- Browser fixtures validate production UI rendering and interaction only; they do not establish production connectivity, PostgreSQL/RLS or real email delivery.

Browser commands:

```sh
pnpm --filter web exec playwright test e2e/org-admin-overview-redesign.spec.ts
pnpm --filter web exec playwright test e2e/org-admin-people-redesign.spec.ts
pnpm --filter web exec playwright test e2e/org-admin-controls-redesign.spec.ts
```

Screenshots: overview `/tmp/org-admin-overview-redesign-6419`, controls `/tmp/org-admin-controls-redesign-6419`, people `apps/web/test-results/org-admin-redesign-6419`. These contain controlled fixture identities, not production user data. Generated captures are not committed.

Independent review identified invitation Hook scope, medium-width overflow and stale cross-organization statistics; all were fixed, with an A-success → B-denied regression test. Visual inspection also corrected narrow audit/Credit table wrapping to bounded local scrolling.

## Delivery boundary

This is an ad-hoc UI change under issue #6419. No sprint feature status was modified. Production deployment is separate from PR validation.
