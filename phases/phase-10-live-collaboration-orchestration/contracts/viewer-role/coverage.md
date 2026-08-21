# `viewer-role` — feature ↔ 需求映射

| feature | 需求出处 | 覆盖情况 |
|---|---|---|
| F01 | `requirements/01-viewer-role.md#R2` | 视角切换器结构、状态后缀——UI 骨架已建 |
| F02 | `requirements/01-viewer-role.md#R1` | 服务端角色矩阵——待 API 契约文件落地后实现 |

## R12 门控映射（第 ③ 件形态 A：`packages/contracts/src/viewer-role.ts`）

| R12 | 一句话 | 门控命令（API 操作） | 后端落点 | 状态 |
|---|---|---|---|---|
| V1 | facilitator 拿到『主持台·全场』+全部分组，groupLead/member 只拿到自己那组，observer 只拿『主持台·全场』一项 | `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run tests/live-collab/get-viewer-options.test.ts` | `apps/api/src/application/live-collab/get-viewer-options.ts` `getViewerOptionsUseCase` | ✅ |
| V2 | `requestedViewerId` 越权（组员传 stage、任意角色传别组 id、observer 传任意 groupId）服务端拒绝 `VIEWER_SCOPE_DENIED`（403） | 同上（同一测试文件覆盖越权分支） | `packages/contracts/src/viewer-role.ts` err 枚举 + 同一 use case | ✅ |
| V3 | 返回体不含任何分组原始字段（`leaderUserId`/`memberUserIds`/`scenario`）泄露给无权限角色 | 同上 | `apps/api/src/application/live-collab/get-viewer-options.ts` `toViewerOptions` | ✅ |
| V4 | 前端 `tab-live.tsx` 优先读服务端 `viewerOptions`，未到手前回退本地 `computeViewerOptions`（非安全边界） | `pnpm --filter web exec vitest run tests/ui/project-live-viewer-switcher.test.tsx` | `apps/web/components/project/tab-live.tsx` | ✅ |

## 反向检查

- `requirements/01-viewer-role.md` 全文两节（R1/R2）均已被 F01/F02 覆盖，无遗漏章节。
- `ui.md` 列出的 2 个截图缺口（G-1/G-2）尚未对应到任何 feature 的 verification——
  是否需要新增一个 feature 补这两张图，还是靠 code review 口头确认，签核时请一并定。

## R12 验收线索 → API 操作 → 门控命令（ADR-023 第 ③ 件实质性判据）

| 行键 | API 操作 | 门控命令 |
|---|---|---|
| V1 | `getViewerOptions`（视角切换器结构渲染） | `grep -rq 'data-testid="lc-viewer-switcher"' apps/web/components/project/tab-live.tsx` |
| V2 | `getViewerOptions`（触发器 + 菜单出口） | `grep -rq 'data-testid="lc-viewer-trigger"' apps/web/components/project/tab-live.tsx`；`grep -rq 'data-testid="lc-viewer-menu"' apps/web/components/project/tab-live.tsx` |
| V3 | `getViewerOptions`（类型层面：服务端权威、无前端二次过滤） | `pnpm --filter web typecheck` |
| V4 | `getViewerOptions`（切换器行为用例） | `pnpm --filter web exec vitest run tests/ui/project-live-viewer-switcher.test.tsx` |
| V5 | `VIEWER_SCOPE_DENIED`（越权拒绝态，`stage-default-denied.png`） | `grep -rq 'data-testid="denied"' apps/web/components/live-collab/orchestration-preview.tsx`；`pnpm --filter web exec playwright test -c playwright.live-collab-shots.config.ts -g 'denied'` |
| V6 | `getViewerOptions`（观察者仅一个 `kind:"stage"` 条目，2026-08-20 已裁决） | ⚠ 缺口：后端 controller 未实现，服务端断言待 F02 开工后补，见 `domain.md` 不变量 3 |
| V7 | `getRoleScopeNote`（角色区分文案来自服务端） | ⚠ 缺口：后端 controller 未实现，当前 `usecases.md` 仅有形状草案，无可执行门控命令 |
