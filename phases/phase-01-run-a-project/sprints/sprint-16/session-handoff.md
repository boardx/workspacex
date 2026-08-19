# 会话交接 — Sprint 01/16

## 当前已验证
- F963：`passing`。1 条 verification 全绿 + `verify:quick`（standard 档）已跑绿。
  evidence 见 `evidence/F963.verify.log`。

## 本轮改动
- 前端：`lib/live-projects.ts`（新增 `advanceAgendaSegment` 封装）、`tab-live.tsx`
  （重写：状态条接真、四组并行降级为如实空态）、`project-workbench.tsx`（`liveSegments`
  拉取加 `live` tab 触发条件 + `renderTab` 传参）、`lib/mock/project.ts`（删四个孤儿
  mock 符号）。
- 设计签核：`contracts/project/design-signoff.md` 追加 F963 到 `covers:`（人类现场
  授权，本束此前有三次自查追加限额，本次已问已批）。

## 仍损坏或未验证
- **`advanceAgendaSegment` 需要在 body-path-param-leak allowlist 补一条**：等
  issue #1600 / PR #1601 合并后，本分支（或它的后继 PR）rebase 到那之后的 main 时，
  把 `apps/web/lib/live-projects.ts:segmentId` 加进
  `.harness/state/body-path-param-leak-allowlist.json`（`workshopId` 那条已因
  `createAgendaSegment` 存在而登记过，`advanceAgendaSegment` 同一个文件多用了
  `segmentId` 一个新参数，同一类合法冗余，非 bug）。
- 「四组并行」卡片仍是空态占位，未接真：
  - 画布进度（`canvas.listGroupCanvases`）本身也是「契约已签、零 controller/零仓储」
    的静态痕迹，需要独立 feature 先建后端（同 F950/F960 那类坑）。
  - `quote`（引述）**没有可用查询入口**——`getNodeProvenance` 需要先知道 `claimId`，
    契约里没有「按时间排序列出一个组最新一条引述」的操作，是真设计缺口不是接线缺口。
  - `fill`（素材充足度）/`needs`（现场介入标记）全仓零来源，需要发明新领域概念——
    2026-08-19 人类会话已确认这次不做，留给后续。

## 下一步最佳动作
- 下一个候选：画布进度接线（`listGroupCanvases` 后端 + 四组卡片进度字段接真）。
- `quote`/`fill`/`needs` 三个字段需要新契约设计，规模明显更大，留待人类决定是否投入。
- 不要动：`contracts/project/design-signoff.md` 的 `status`/`confirmed_by`/
  `confirmed_at` 三个字段——那是人的动作（ADR-023），本次只动了 `covers:`。

## 命令
- 启动:`pnpm -w run dev`
- 验证:`pnpm harness verify --sprint 01/16`
- 调试:`pnpm --filter web exec vitest run tests/ui/project-live-stagebar.test.tsx`
