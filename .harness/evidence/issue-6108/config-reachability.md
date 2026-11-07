# Enterprise configuration entry points

The exact merge group `25dff195b7f026b65baa1973b526c7a862c5d4c5` failed `base-control-plane` job `125454423689` at 2026-11-02T18:07:25Z. The reachability gate reported four Enterprise configurations without named entry points. Supervisor run `41497658930` then correctly requested cancellation of run `41496988529`; its log explicitly names the failed job. Cancellation was a consequence, not the root failure.

The same local command, `pnpm run lint:vitest-config-reachability`, reproduced all four orphan configurations with exit 1. Adding four explicit scripts in `apps/api/package.json` made the unchanged gate pass: 66 configurations reachable, 12 live specs covered, exit 0. No configuration, test inclusion, permission or gate was changed.

The actual new unit entry point, `pnpm --filter @repo/api test:enterprise-management`, passed 5 files / 24 tests, exit 0 (16.97s). This checks the script and existing unit coverage; the three database entry points map directly to their unchanged existing configurations. Previously recorded database/browser evidence remains separate; no database suite was repeated for this script-only repair.

Independent incremental review, complete normal pre-push and fresh CI remain required. No deployment or passing-state claim is made here.
