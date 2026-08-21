# `stage-aggregation` — feature ↔ 需求映射

| feature | 需求出处 | 覆盖情况 |
|---|---|---|
| F09 | `requirements/03-module-routing.md#R2`（第 1 点：看板） | UI 骨架已建；真实数据对接完全阻塞于 phase-02 F02，见 design-signoff.md 硬阻断 |
| F10 | `requirements/03-module-routing.md#R2`（第 2 点：知识图谱·决策推演） | UI 骨架已建；真实数据对接完全阻塞于 phase-02 F11/F15/F16/F17，见 design-signoff.md 硬阻断 |

## R12 门控映射（第 ③ 件形态 B：本束当前无对外 HTTP 面，见 domain.md——硬阻断于 phase-02）

| R12 | 一句话 | 门控命令（API 操作） | 后端落点 | 状态 |
|---|---|---|---|---|
| V1 | 骨架：本束现有代码（UI 骨架 + mock，含"依赖失败"诚实占位态）typecheck/lint 不破 | `pnpm --filter web run typecheck` | `apps/web/components/live-collab/orchestration-preview.tsx` | ✅ |

**缺口 1**（文字登记，不放进上表）：F09/F10 硬阻断于 phase-02 知识图谱/看板契约束签核，
在那之前本束不会有真实 HTTP 面；phase-02 对应束签核后，本节要么新增真实门控命令，
要么整节改写为形态 A。

## 反向检查

- `requirements/03-module-routing.md#R2` 三点中，第 1、2 点（看板、知识图谱）已被 F09/F10 覆盖；
  第 3 点（分组与签到）**不属于本束**，归 `group-checkin` 束（F05/F06）——本文件不越界声明。
- `00-overview.md` 硬前置段落"phase-02 的知识图谱/看板领域模型（F11/F02/F15-F19）目前
  `not_started` 且无契约束签核"这一条，是本束两个 feature 共同的阻塞源，已在 F09/F10 各自的
  notes 与本 design-signoff.md 里**只声明一次**（本文件是唯一权威落点），未在其它束重复声明
  同一条阻塞（`module-routing` 束的"本组图谱"消费同一个 phase-02 知识图谱数据，但那是分组粒度、
  不同的交叉点，两束的 design-signoff.md 交叉约束表分别列出，不是重复声明同一件事）。

## R12 验收线索 → API 操作 → 门控命令（ADR-023 第 ③ 件实质性判据）

| 行键 | API 操作 | 门控命令 |
|---|---|---|
| V1 | `getKanbanBoard`（4 组实时卡片骨架渲染） | `grep -rq 'data-testid="lc-kanban-grid"' apps/web/components/live-collab/orchestration-preview.tsx` |
| V2 | `getKanbanBoard`（`{ready:false}` 未就绪响应，不渲染编造字段） | ⚠ 缺口：属 phase-02 依赖范围，后端 controller 未实现，`getKanbanBoard` 的服务端未就绪断言待 phase-02 契约束签核后一并接线，见 `KNOWN_CONTRACT_GAPS.A1` |
| V3 | `broadcastToGroupLeads`（广播动作，不依赖看板数据） | `grep -rq 'data-testid="lc-kanban-broadcast"' apps/web/components/live-collab/orchestration-preview.tsx` |
| V4 | `broadcastToGroupLeads`（成功态截图冒烟） | `pnpm --filter web exec playwright test -c playwright.live-collab-shots.config.ts -g 'kanban'` |
| V5 | `getDecisionGraph`（决策推演骨架 + 分支/下一步展开点） | `grep -rq 'data-testid="lc-stage-graph"' apps/web/components/live-collab/orchestration-preview.tsx`；`grep -rq 'data-testid="lc-stage-graph-forks"' apps/web/components/live-collab/orchestration-preview.tsx` |
| V6 | `dispatchNextWork`（派发动作出口） | `grep -rq 'data-testid="lc-stage-graph-nextwork"' apps/web/components/live-collab/orchestration-preview.tsx` |
| V7 | `getKanbanBoard`/`getDecisionGraph`/`dispatchNextWork` 权限拒绝（复用 `VIEWER_SCOPE_DENIED`，domain.md 不变量 4） | ⚠ 缺口：后端 controller 未实现，`viewer-role` 束角色矩阵门控命令尚未落地，见该束 coverage.md |
| V8 | `UPSTREAM_BUNDLE_NOT_SIGNED`（`dep-failed` 态，`stage-kanban-dep-failed.png`） | ⚠ 缺口：截图已产出但无自动化断言脚本核对该错误码，需在 F09/F10 实现时补一条门控命令 |
