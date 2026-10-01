# Phase 20 WS01-WS05 Acceptance Report — Iteration 2

Date: 2026-09-28  
Branch: claude/tender-maxwell-dh21fg-iter2  
Verifier: Claude Sonnet 4.6 (independent, wrote none of the implementation)

## Environment

- PostgreSQL 16 on 127.0.0.1:5432 (local, no Docker)
- Docker daemon NOT available; a minimal fake `docker` binary was used to intercept
  `pg_isready` and `CREATE DATABASE` calls (forwarding to local psql)
- pnpm workspace, node from .nvmrc, no infra containers

## Results Summary

| Feature | Title | Verification tests | Exit codes | Result |
|---------|-------|--------------------|-----------|--------|
| WS01 | WorkSkillManifest 契约与 frontmatter 校验 | manifest-schema.test.ts (16), manifest-frontmatter-lint.test.ts (11) | 0, 0 | PASS |
| WS02 | 导入接入 manifest 校验与 skill_catalog_entries 迁移仓储 | starter-import-catalog.test.ts (10), catalog-entries-migration.test.ts (7) | 0, 0 | PASS |
| WS03 | 目录/搜索/详情 API 与通道写接口 | catalog-api.test.ts (10), catalog-channel-transition.test.ts (11) | 0, 0 | PASS |
| WS04 | Skill 依赖就绪性计算与 API | readiness-compute.test.ts (10) | 0 | PASS |
| WS05 | Work Skill 目录屏 UI | work-skill-catalog.test.tsx (15) | 0 | PASS |

Total: 90 tests, 90 passed, 0 failed.

## Verification Commands and Exit Codes

```
pnpm --filter @repo/contracts exec vitest run tests/work-skill/manifest-schema.test.ts
→ exit 0 (16 tests passed)

pnpm --filter api exec vitest run tests/work-skill/manifest-frontmatter-lint.test.ts
→ exit 0 (11 tests passed)

pnpm --filter api exec vitest run tests/work-skill/starter-import-catalog.test.ts
→ exit 0 (10 tests passed)

pnpm --filter api exec vitest run tests/work-skill/catalog-entries-migration.test.ts
→ exit 0 (7 tests passed)

pnpm --filter api exec vitest run tests/work-skill/catalog-api.test.ts
→ exit 0 (10 tests passed)

pnpm --filter api exec vitest run tests/work-skill/catalog-channel-transition.test.ts
→ exit 0 (11 tests passed)

pnpm --filter api exec vitest run tests/work-skill/readiness-compute.test.ts
→ exit 0 (10 tests passed)

pnpm --filter web exec vitest run tests/ui/work-skill-catalog.test.tsx
→ exit 0 (15 tests passed)
```

## Additional Checks

```
pnpm --filter @repo/contracts typecheck → exit 0
pnpm --filter api typecheck             → exit 0
pnpm --filter web typecheck             → exit 0

node .harness/scripts/lint-arch-deps.mjs
→ exit 0: "1679 files, all dependencies point inward"

node .harness/scripts/lint-contract-source.mjs
→ exit 0: "generated files match the contract, no hand-written copies (1151 contract types)"

./init.sh
→ exit 0: "快速路径通过"
```

## User-Visible Behavior Exercise

### WS01 — Frontmatter schema validation
The lint script at `apps/api/scripts/lint-work-skill-manifests.ts` correctly:
- Parses all SKILL.md files with `metadata.work` sections
- Exits non-zero with file path + field path when required fields are missing (e.g. riskClass)
- Exits non-zero when dependencies reference vendor names (not canonical capability IDs)
- Exits non-zero when copied provenance has no copyright notice
- Passes valid manifests with exit 0

### WS02 — Import pipeline
POST /admin/skills/starter-pack-imports with a valid S003 payload:
- Parses and writes manifest.work into immutable skill_versions.manifest
- Atomically creates a skill_catalog_entries row (default channel=candidate) in same transaction
- Returns 422 with unchanged skill_versions row count for invalid frontmatter / missing license

### WS03 — Catalog API + channel transitions
- GET /skills/catalog (domain/channel/q/cursor) → paginated list with correct filters
- GET /skills/catalog/:skillId → full manifest detail; ?versionId= reads historical version
- PATCH channel: candidate→verified/deprecated writes audit event; deprecated hidden by default
- Non-admin PATCH → 403; cross-org read → 404; unauthenticated → 401

### WS04 — Readiness computation
GET /skills/catalog/:skillId/readiness:
- Returns satisfied/missing/denied per required capability × org-granted+enabled tools
- All required satisfied → ready:true; optional missing doesn't block ready
- Tool authorization query failure → unknown (not ready)

### WS05 — Work Skill Catalog UI
/skill?screen=work-catalog renders:
- S003 row with name/stableId/domain/channel badge/riskClass/readiness badge
- Left-side domain filter and channel tabs pass params to API
- Detail drawer shows dependency groups/provenance/locale/eval status placeholder/version/successor
- Empty state, clear-filter, readiness unknown local hint, no channel button for non-admin — all covered by 15 vitest JSDOM tests

## Screenshots / Playwright

WS05 is a JSDOM-level vitest test (15 assertions on rendered HTML). No Playwright E2E was
run because the web app was not started (requires Redis/Postgres full stack + infra setup).
The JSDOM tests exercise the full React component tree including API fetch mock, filter state,
channel tab switching, and detail drawer rendering.

## Infrastructure Note

Docker was not available (no Docker daemon). API tests were run with a 3-line fake `docker`
binary that forwarded `pg_isready` and `CREATE DATABASE` commands to the local PostgreSQL.
`WORKSPACEX_DB=workspacex PGPORT=5432 PGHOST=127.0.0.1` were set. Database migrations ran
successfully prior to test execution. This is an infrastructure workaround, not a code issue.

## Verdict

**ACCEPT** — All 90 verification tests pass. All type checks pass. Arch and contract lint
pass. init.sh passes. No blocking issues found.
