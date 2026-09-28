---
bundle: work-content
phase: "20"
covers: [CT01, CT02, CT03, CT04, CT05, CT06, CT07, CT08, CT09, CT10, CT11]
status: confirmed
confirmed_by: "usamshen"
confirmed_at: "2026-09-27T16:30:00Z"
confirmed_via: "人类在 GitHub 亲自签核"
---

# 契约束 `work-content` 设计签核

> 签核状态只由人类填写（ADR-023 决策五）。2026-09-28 人类授权「先执行、后补签」：
> 本束 feature 可先开发，但 `status` 保持 `pending`，agent 不写 `confirmed_by` / `confirmed_at`。

覆盖意图（派生视图；权威是 frontmatter `covers:`）：

| feature | 能力边界 |
|---|---|
| CT01 | 研究线 Skill 包作者化、可重复构建与导入 |
| CT02 | 研究线 Workflow 定义（W001/W006/W009/W057/W060）与 skillPins 矩阵闭合 |
| CT03 | 研究线 e2e：调研到简报（含 A4 数据需求说明） |
| CT04 | 产品线 Skill 包（D003 ∪ D011 + 额外依赖），skillGaps 只登记 |
| CT05 | 产品线 Workflow 定义（W027–W032/W002） |
| CT06 | 产品线 e2e：问题到 PRD；D011 发起 W030 被拒并提示转交 |
| CT07 | 销售线 Skill 包 |
| CT08 | 销售线 Workflow 定义（W011–W016/W018） |
| CT09 | 销售线 e2e：线索到合格（审批 / 驳回 / 冲突 / 撤权 / 幂等重放 / written_manual） |
| CT10 | Board 只读运行卡投影与 UI |
| CT11 | 81 实体对账与全量回归 |

依据：`requirements/05-content-lines.md` R1–R12；ADR-116～ADR-120；`docs/proposals/PROP-WORK-STACK-001.md` 修订 R1。

## 一、材料清单

- ① UI：`ui.md`（Board 运行卡、线索决定卡、W013 三联卡、简报分发卡、Workflow 目录不可用态；截图 `ui-preview/work-content/board-run-card.png`）。
- ② 用例：`usecases.md`（UC-WC-1～UC-WC-8 对外 + UC-WC-I1～I5 内部）。
- ③ API 契约：`packages/contracts/src/work-content.ts`（zod 单源；8 个 operations；复用 workflow-runtime / agent-role / work-skill-meta 形状）。
- 支撑·领域模型：`domain.md`（I-C1～I-C14）。
- 支撑·覆盖证明：`coverage.md`（V1～V9 → 操作 → 前端消费点）。

## ① UI — 人看到的界面对不对

- [ ] Board 运行卡：Workflow 图标、标题（Workflow 名 + 发起对象）、Agent 头像叠放、状态徽标五态，无拖拽手柄，点击跳实例详情。
- [ ] 无读权限时卡**不出现**（无占位、无计数泄漏）。
- [ ] W011 线索决定卡：逐条批准/驳回/改层级；冲突差异视图；forbidden / written_manual 说明。
- [ ] W013 G1 三联卡（记录 / 三选一 / 变更集前值→新值）+ G2 邮件确认卡（收件人只读）。
- [ ] W001 G2/G3 简报审阅与分发卡：双签状态可见。
- [ ] Workflow 目录「不可用」态显示原因与未解析 Skill。

## ② 用例 — 业务流程对不对

- [ ] 组合只认两张矩阵；skillPins = 矩阵行；白名单 = 角色矩阵行。
- [ ] 每条结论带 evidenceRefs；无材料时产出数据需求说明而非结论。
- [ ] 所有外部写入 = 人工门 + effect-gateway 执行前重查；批准绑定 digest，上游重算即失效。
- [ ] 事件触发的 W013 永无自动批准；新商机不含 amount/closeDate/stage。
- [ ] 白名单外 → 可见失败 + 转交提示，不静默降级。

## ③ API 契约 — 接口形状对不对

- [ ] 8 个 operations 的路径与方法（`/workflows/catalog`、`/workflow-instances/:id/output`、`…/lead-decisions`、`…/meeting-followup-decision`、`/board/workflow-run-cards`、`/admin/work-stack/phase1/reconciliation` 等）。
- [ ] `WorkContentErrorCode`、`CrmWriteItemOutcome`、`BoardRunBadge`、`WorkContentOutcome` 四个封闭枚举是否够用 / 多余。
- [ ] 不新增实例状态（`completed_with_holds` 表达为 `succeeded` + `outcome=with_holds`）是否可接受。

## 待签核人裁决的开放问题

见 `usecases.md` 末节「开放问题 Q1–Q7」。
