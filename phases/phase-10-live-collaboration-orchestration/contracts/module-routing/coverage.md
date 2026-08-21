# `module-routing` — feature ↔ 需求映射

| feature | 需求出处 | 覆盖情况 |
|---|---|---|
| F07 | `requirements/03-module-routing.md#R1`（第 1-3 点：侧栏结构、路由、统一卡片形态） | UI 骨架已建，字段集已按 Q3 裁定 |
| F08 | `requirements/03-module-routing.md#R1`（第 4 点：本场状态右侧栏） | checklist/需要知道/已生成产出三类字段全仓无来源，只能停骨架，见 design-signoff.md 硬阻断 |

## 反向检查

- `requirements/03-module-routing.md#R1` 全部 4 点均已被 F07（1-3 点）/F08（第 4 点）覆盖，无遗漏。
- `03-module-routing.md#R2`（主持台·全场三视图聚合）**不属于本束**，归 `stage-aggregation` 束
  （F09/F10）与 `group-checkin` 束（分组与签到子视图）——本束的 coverage 不越界声明这部分。
- `03-module-routing.md` 末尾"编排层的路由/权限硬约束"一节（上下文携带、角色可见性生效）
  已在 `domain.md` 不变量 3/4 与 `usecases.md` 签核确认项里覆盖。

## R12 验收线索 → API 操作 → 门控命令（ADR-023 第 ③ 件实质性判据）

| 行键 | API 操作 | 门控命令 |
|---|---|---|
| V1 | `getModuleCards`（五模块侧栏 + 统一卡片形态渲染） | `grep -rq 'data-testid="lc-module-sidebar"' apps/web/components/live-collab/orchestration-preview.tsx` |
| V2 | `getModuleCards`（分组主区渲染） | `grep -rq 'data-testid="lc-group-main"' apps/web/components/live-collab/orchestration-preview.tsx` |
| V3 | `getModuleCards`/`getModuleCounts`（跨模块视图截图冒烟） | `pnpm --filter web exec playwright test -c playwright.live-collab-shots.config.ts -g 'group-'` |
| V4 | `getModuleCards`/`getModuleCounts` 权限拒绝（复用 `VIEWER_SCOPE_DENIED`，domain.md 不变量 3） | ⚠ 缺口：后端 controller 未实现，`viewer-role` 束的角色矩阵门控命令尚未落地，见该束 coverage.md |
| V5 | `getGroupGraphSummary`（未就绪响应，`{ready:false}`） | ⚠ 缺口：属 phase-02 依赖范围，本束契约文件已声明 `NotReady` 形状但无可执行的服务端断言，见 `KNOWN_CONTRACT_GAPS.A1`（stage-aggregation 束同名缺口） |
| V6 | F08 checklist/需要知道/已生成产出（`lc-group-state-sidebar` 骨架） | `grep -rq 'data-testid="lc-group-state-sidebar"' apps/web/components/live-collab/orchestration-preview.tsx`（仅验证骨架渲染，不验证真实数据——三类字段的真实契约见 `KNOWN_CONTRACT_GAPS.R1`） |
