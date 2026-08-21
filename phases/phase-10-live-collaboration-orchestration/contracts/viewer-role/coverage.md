# `viewer-role` — feature ↔ 需求映射

| feature | 需求出处 | 覆盖情况 |
|---|---|---|
| F01 | `requirements/01-viewer-role.md#R2` | 视角切换器结构、状态后缀——UI 骨架已建 |
| F02 | `requirements/01-viewer-role.md#R1` | 服务端角色矩阵——待 API 契约文件落地后实现 |

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
