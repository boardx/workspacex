# Local validation checkpoint

All commands below exited 0 after the review fixes. No DB, Docker, app server, vendor model call, package installation, or organization write was performed.

- `pnpm --filter @repo/contracts exec vitest run tests/provider-model-catalog.test.ts`: 5 passed.
- `PYTHONDONTWRITEBYTECODE=1 python3 scripts/model-catalog/test_refresh_bailian.py`: 5 passed, offline only.
- `pnpm --filter web exec vitest run tests/lib/provider-model-catalog-view.test.ts tests/ui/bailian-model-catalog.test.tsx tests/ui/admin-model-catalog.test.tsx`: 16 passed, including existing organization-model behavior.
- `pnpm --filter @repo/contracts exec tsc --noEmit`: exit 0.
- `pnpm --filter web exec tsc --noEmit`: exit 0.
- Changed-file Web ESLint with `--max-warnings 0`: exit 0.
- `./apps/web/scripts/lint-design.sh components/admin/bailian-model-catalog.tsx components/admin/model-screen.tsx lib/provider-model-catalog-view.ts`: exit 0.
- `node scripts/model-catalog/verify-bailian-ui.cjs /tmp/wsx-bailian-ui-final`: exit 0. Real component static-file browser fixture at 375 / 768 / 1280: no horizontal overflow, no drawer overflow, no page error, no WCAG 2 A/AA axe violations in directory views. Screenshots use the actual component, reviewed JSON and design tokens, without an authenticated organization or API.

The fixture is explicitly labelled and does not prove authenticated organization acceptance, full API parameters, provider account inventory, enabled adapters, or real inference. Independent review required narrowing generic modality assumptions and requiring pricing provenance; both fixes are included and tested. Normal hooks and PR CI are separate final gates.
