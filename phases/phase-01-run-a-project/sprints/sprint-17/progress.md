# 进度日志 — Sprint 01/17

## 当前已验证状态(唯一真相)
- 仓库根目录: <repo 路径>
- 标准启动路径: `pnpm -w run dev`
- 标准验证路径: 见 ADR-106（`verify:quick`/`verify:harness`/`verify:release`，不确定就跑 `verify:release`）
- 当前最高优先级未完成功能: F964 —— 成果沉淀 tab「成果去向」接真实 listBackflow + 「审计与反馈」接真实 queryProvenance
- 当前 blocker: 无（等 `pnpm harness verify --sprint 01/17 --feature F964` 门控转 passing）

## 会话记录
### 2026-08-20（人类要求「项目 → 成果沉淀」tab 从纯前端 mock 打通到前后台真正接线）
- 本轮目标: F964 —— 成果沉淀 tab 里能接真的两块（成果去向 / 审计与反馈）接真，
  四块契约里从未建模的板块（项目结论 / 假设状态 / 发布结论 / 候选决策）整块降级为
  如实空态，同 F172 / F963 建立的纪律。
- 已完成:
  - `apps/web/lib/live-provenance.ts`：`queryProvenance` 补 `targetKind`/`targetId`
    两个可选参数（契约 `in` 早有，此前无调用方）。
  - `apps/web/lib/live-projects.ts`：新增 `BackflowEntry` 类型与 `BACKFLOW_BADGE_LABEL`
    单一声明处（原在 `tab-overview.tsx` 私有声明，第二个消费点出现后收成一处）。
  - `apps/web/components/project/tab-overview.tsx`：改从 `live-projects.ts` import
    `BACKFLOW_BADGE_LABEL`，删掉本地重复声明。
  - `apps/web/components/project/tab-results.tsx`：整体重写。「成果去向」接
    `liveOverview.backflow`（四态：signed-out/loading/error/empty/list）；
    「审计与反馈」接 `liveAudit`（`queryProvenance` 按 `targetKind:project`+
    `targetId` 收窄，四态同上）；「项目结论」「假设状态」「发布结论」「候选决策」
    四块因契约未建模，删除编造数据与「发布」「签署」两个只弹本地对话框、不产生
    真实副作用的危险按钮，改为如实说明「暂不可用」。
  - `apps/web/components/project/project-workbench.tsx`：`liveOverview` 拉取条件
    加入 `tab==='results'`；新增 `liveAudit`/`liveAuditLoading`/`liveAuditError`
    state 与拉取（`tab==='results' && qs.org` 时触发）；`renderTab` 传参给
    `TabResults`。
  - `apps/web/lib/mock/project.ts`：删除三个孤儿 mock 常量
    （`RESULTS`/`CANDIDATE_DECISIONS`/`AUDIT_TRAIL`），头注登记四块契约未建模的
    缺口（同 F172/F963「收窄 mock 依赖」纪律）。
  - 设计签核：`contracts/project/design-signoff.md` 追加 F964 到 `covers:`
    （零新增设计面自查追加，逐条对照三条件，见该文件对应段落；`status`/
    `confirmed_by`/`confirmed_at` 未改）。
  - `phases/phase-01-run-a-project/feature_list.json` 新增 F964（`not_started`）；
    `pnpm harness new-sprint --phase 01 --id 17 --features F964` 通过设计签核门；
    `pnpm harness claim --phase 01 --feature F964 --owner dev-project` 转 `in_progress`。
- 运行过的验证:
  - `pnpm --filter web run typecheck`（绿）。
  - `pnpm --filter web run lint`（绿，含 `lint-design.sh`）。
  - `pnpm --filter web exec vitest run tests/ui/project-results-live.test.tsx`
    （新增，12 条：四块未建模区块不再显示编造数据、角色投影规则不变、成果去向/
    审计与反馈各自四态）。
  - `pnpm --filter web exec vitest run tests/ui/project`（回归扫，8 个测试文件
    66 条全绿，含 `project-overview-live-*`/`project-live-stagebar` 等相邻文件，
    确认 `BACKFLOW_BADGE_LABEL` 搬迁未破坏 F362/F172 既有行为）。
- 已记录证据: 见 `evidence/F964.verify.log`（`pnpm harness verify` 落地后补）。
- 提交记录: 分支 `worker/dev-project-01-results-backflow-audit`。
- 已知风险或未解决问题:
  - `pnpm harness readiness` 队列（issue #814）本轮只列 #624/#728，F964 不在队列上
    ——本次是人类在本会话任务指令里直接点名要做的活，不是默默越权，已在
    `design-signoff.md`/本记录里写明理由。
  - UIUX 保真度评分（对齐已签核 `uc-00-3-results-*.png` 十张基准图）待跑：需要真栈
    截图（起 devapp + 真实 API + 真登录），本条目将在下一轮/本会话后续补记分与截图。
  - 发布结论/候选决策/项目结论/假设状态四块的真实领域模型仍未建——本 feature 只是
    诚实地不再假装它们存在，没有解决它们的缺失；补它们需要新的契约设计与人类签核，
    不在本次已签核范围内，留给后续 feature。
- 下一步最佳动作: 跑真栈 UIUX 对齐评分，若 <9 分按差距迭代；随后开 PR
  （`Closes` 对应 issue）。
