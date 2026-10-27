# Handoff — AI usage #5943

The approved UI is implemented; see progress.md and the implementation plan. No API/database/permissions/model-pricing changes. Historical unknown usage remains unknown; this change does not recover supplier telemetry.

Verification commands:
- `./init.sh`
- `pnpm --filter web exec vitest run tests/ui/ai-usage-panel.test.tsx tests/ui/ai-usage-format.test.ts tests/ui/admin-usage-monitor-live.test.tsx tests/ui/admin-members-usage-limits-tabs.test.tsx`
- `pnpm --filter web typecheck`
- `pnpm --filter web exec eslint components/admin/ai-usage-panel.tsx components/admin/ai-usage-format.ts components/admin/ai-usage-ledger.tsx app/usage/page.tsx tests/ui/ai-usage-panel.test.tsx tests/ui/ai-usage-format.test.ts`
- `pnpm --filter web lint:design`
- `node docs/evidence/ai-usage-5943/browser-check.cjs`

Browser script binds a temporary loopback server, runs headless Chromium, then closes browser/server and removes temporary build files in finally. No Docker resources were started. Existing worktree retained for PR follow-up.

PR #5944 created and attached to chat. CI is running; no deployment or merge performed. Follow the latest head checks before treating the PR as ready for merge.
