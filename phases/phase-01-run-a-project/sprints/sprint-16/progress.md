# 进度日志 — Sprint 01/16

## 当前已验证状态(唯一真相)
- 仓库根目录: <repo 路径>
- 标准启动路径: `pnpm -w run dev`
- 标准验证路径: 见 ADR-106（`verify:quick`/`verify:harness`/`verify:release`，不确定就跑 `verify:release`）
- 当前最高优先级未完成功能: 无（F963 已 passing，本 sprint 目标完成）
- 当前 blocker: 无

## 会话记录
### 2026-08-19（人类要求「tab 的开发开始」+ 本会话实现）
- 本轮目标: F963 —— 「现场协作」主持台状态条从 mock 接上真实数据（`listAgendaSegments`/
  `advanceAgendaSegment`，两者都是 F119/#853 已签核且已挂 controller 的操作，此前只是
  零前端调用方）；「四组并行」卡片因数据源在 project 束契约里完全无出处，整块降级为
  如实空态（同 F172 处置纪律），不显示编造数字。
- 已完成:
  - 前端：`lib/live-projects.ts` 新增 `advanceAgendaSegment` 封装；`tab-live.tsx` 重写
    （状态条读 `liveSegments` 找 `state==='active'` 那条、显示真实标题/环节序号/状态，
    facilitator 看到「下一环节/提前结束/跳过」三个按钮真实调用 advance；四组并行整块
    换成如实说明卡片）；`project-workbench.tsx`（`liveSegments` 拉取条件加入
    `tab==='live'`，`renderTab` 的 `live` 分支传参）；`lib/mock/project.ts` 删除四个孤儿
    符号（`LIVE_STAGE`/`LIVE_GROUPS`/`ROLE_OWN_GROUP`/`ROLE_SEES_ALL_RAW`，同 F172
    「收窄 mock 依赖」纪律）。
  - 零契约改动、零迁移、零新 rewrite——`advanceAgendaSegment` 契约与 controller 路由
    早就存在（F119），只是没有前端调用方。
  - 设计签核：project 束 `design-signoff.md` 追加 F963 到 `covers:`（人类现场授权，
    见 2026-08-19 对话记录——本束此前有三次 agent 自查追加 F158/F164/F172，coord-main
    曾要求第三次后先问，本次已问已批）。
- 运行过的验证: `tests/ui/project-live-stagebar.test.tsx`（8 条，含推进成功/失败/角色
  门槛/加载态/错误态/真实空态）+ `verify:quick`（standard 档）。
- 已记录证据: `evidence/F963.verify.log`。
- 提交记录: 见本次 PR（branch `worker/dev-project-01-livestage`）。
- 已知风险或未解决问题:
  - `advanceAgendaSegment` 的 body 需要带 `workshopId`/`segmentId`（controller 用全量
    `.in`，未 `.omit()`，服务端显式比对路径与 body 一致）——这不是路径参数泄漏 bug
    （见 issue #1600/PR #1601），但本分支基线尚未带上 `lint-body-path-param-leak.mjs`
    的 allowlist 机制（#1601 尚未合并），rebase 到 #1601 合并后的 main 时需要把
    `apps/web/lib/live-projects.ts:segmentId` 也补进
    `.harness/state/body-path-param-leak-allowlist.json`（`workshopId` 那条已有，
    因为 `createAgendaSegment` 已经登记过）。
  - 「四组并行」卡片的真实接线（画布进度 `listGroupCanvases`，本身也是「契约已签、
    零 controller/零仓储」的静态痕迹，需要独立 feature 先建后端）留给下一个 feature；
    `quote`（引述）目前**没有可用的查询入口**（`getNodeProvenance` 需要先知道
    `claimId`，契约里没有「按时间排序列出一个组最新一条引述」的入口，属真设计而非接线）；
    `fill`（素材充足度）/`needs`（现场介入标记）全仓零来源，需要新领域概念（2026-08-19
    人类会话已确认范围，本次不做）。
- 下一步最佳动作: 画布进度接线（`listGroupCanvases` 后端 + 「四组并行」卡片进度字段
  接真）是下一个候选 feature；`quote`/`fill`/`needs` 三个字段需要新契约设计，规模更大，
  留待人类决定是否值得投入。
