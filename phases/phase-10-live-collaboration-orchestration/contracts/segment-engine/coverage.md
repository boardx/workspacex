# `segment-engine` — feature ↔ 需求映射

| feature | 需求出处 | 覆盖情况 |
|---|---|---|
| F03 | `requirements/00-overview.md#R1` | 状态条复用 F963 数据源，编排层渲染一致性——UI 骨架已建 |
| F04 | `requirements/00-overview.md#R1`（倒计时段落） | 倒计时字段——跨 phase-01 议程束的契约变更请求，待对方确认后落地 |

## R12 门控映射（第 ③ 件形态 A：复用 `packages/contracts/src/project.ts`，见 `third-artifact-map.json`）

| R12 | 一句话 | 门控命令（API 操作） | 后端落点 | 状态 |
|---|---|---|---|---|
| V1 | 状态条数据（环节标题/序号/状态）与推进动作在切换 F01 视角前后完全一致，不重新拉取/不建副本 | `pnpm --filter web exec vitest run tests/ui/project-live-segment-engine-consistency.test.tsx` | `apps/web/components/project/tab-live.tsx` `StageBar`（复用 F963 的 `listAgendaSegments`/`advanceAgendaSegment` 调用，`project.ts` 契约） | ✅ |

**缺口 1**（文字登记，不放进上表）：倒计时字段（F04）——`listAgendaSegments` 契约目前无剩余
时长字段，是跨 phase-01 议程束的契约变更请求，本轮不落地；对方确认新增字段后本表补一行真实命令。

## 反向检查

- `requirements/00-overview.md#R1` 全段（含状态条描述、倒计时段落、"需介入"判据段落）均已被
  F03/F04 覆盖或显式标记为不在本轮签核范围（"需介入"判据）——无遗漏内容，也没有把不该本束
  拍板的跨 phase 事项悄悄内化成本束的既成决定。
- `00-overview.md` 硬前置段落提到的"素材充足度""现场介入标记"两个字段**不属于本束**
  （它们出现在 stage-aggregation/module-routing 的看板与本场状态相关场景），
  本束的 `＊` 占位仅限倒计时与"需介入"两处，未越界覆盖其它束的无来源字段。

## R12 验收线索 → API 操作 → 门控命令（ADR-023 第 ③ 件实质性判据）

| 行键 | API 操作 | 门控命令 |
|---|---|---|
| V1 | `listAgendaSegments`/`advanceAgendaSegment`（编排层状态条与 F963 数据源逐字节一致） | `pnpm --filter web exec vitest run tests/ui/project-live-segment-engine-consistency.test.tsx` |
| V2 | `listAgendaSegments`（现场状态条渲染） | `grep -rq 'data-testid="project-live-stagebar"' apps/web/components/project/tab-live.tsx` |
| V3 | `listAgendaSegments`/`advanceAgendaSegment`（转发调用，不重新查询） | `grep -rq 'listAgendaSegments\|advanceAgendaSegment' apps/web/components/project/tab-live.tsx` |
| V4 | `advanceAgendaSegment`（非引导师调用被拒，F119 已限定） | ⚠ 缺口：`project.ts` 的 `advanceAgendaSegment` 权限断言未在 phase-10 编排层单独复测，需核实 F119 原有门控是否已覆盖分组视角入口，见 `phases/phase-00-shared-kernel` 对应测试 |
| V5 | `getSegmentCountdown`（倒计时未接入前 `＊` 占位，不发真实请求） | `grep -rq 'data-testid="lc-stage-countdown"' apps/web/components/live-collab/orchestration-preview.tsx` |
| V6 | "第X组需介入" pill（无判据来源期间不得渲染，domain.md 不变量 4） | ⚠ 缺口：判据全仓无来源，见 `KNOWN_CONTRACT_GAPS.S3`（live-collab-segment-engine.ts） |
