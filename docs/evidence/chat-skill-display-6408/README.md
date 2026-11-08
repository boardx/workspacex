# Chat skill picker metadata repair (#6408)

The picker rendered the raw skill name (a stable Work Skill number such as S190) and the compatibility duty string describing file storage. The actual task description lives in the published skill version manifest; it was not exposed in this catalog projection. The previous diagnosis that locale alone caused the issue was incomplete.

## Changes

- Preserve the maintenance `duty` marker used by source editors. Add optional `taskDescription` to the existing authorized list projection and API contract, derived from the same published version as `currentVersionId` (deterministic created_at/id ordering). No draft/unpublished description is read.
- Use the existing mechanically checked Work Skill name mapping and the published task description for a read-only picker projection. Search, candidates and mounted labels consume this same pool. Skill IDs, published version IDs, visibility and mount commands are unchanged.
- Existing custom skill names/descriptions and missing-metadata fallbacks remain supported. No provider calls, database writes or synthetic descriptions are introduced.

## Evidence

- RED: the display regression failed on raw S190 before the projection was implemented.
- Frontend: `pnpm --filter web exec vitest run tests/lib/skill-picker-display.test.ts tests/ui/i18n-chat-skill-mount.test.tsx tests/ui/chat-skill-mount-panel-auto-close.test.tsx`: 16 passed, including actual picker purpose search, readable label/description and unchanged mount identity.
- API: `pnpm --filter @repo/api exec vitest run --config vitest.skill-display-unit.config.ts`: 10 passed. These use controlled database rows to verify real repository mapping and visibility; they do not claim live PostgreSQL/RLS acceptance.

## Scope boundary

No production data, runtime configuration or deployment was changed. The billing/survey proposal is unrelated pending design and is excluded from this commit. Existing worktree reused. Full CI and production browser acceptance are recorded separately in the PR.
