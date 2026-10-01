# 契约束 `work-content` — UC 覆盖证明（支撑材料）

> 需求单一事实源：`requirements/05-content-lines.md`。R12 验收线索按原文编号 V1–V9。
> API 操作为 `packages/contracts/src/work-content.ts` 的 `operations.<op>`；`workflowRuntime.<op>` 来自 `workflow-runtime.ts`。

## 一、R12 → API 操作 → 前端消费点

| 行键 | 验收线索 | API 操作 | 前端消费点 | feature | 状态 |
|---|---|---|---|---|---|
| V1 | pack 构建三线各 1 个 JSON，重复构建 digest 不变；篡改退出非 0 指名文件 | 内部 UC-WC-I1（CLI，无 HTTP） | —（CLI 验收） | CT01/CT04/CT07 | 契约闭合；待实现 |
| V2 | 目录 58+19+4=81，ID 集合逐一相等；W017 不出现 | `getPhase1Reconciliation`；`listWorkflowCatalog`；work-skill-meta `listWorkSkillCatalog` | `workflow-catalog-item-<workflowId>`；Skill 目录屏（work-skill-meta 束） | CT11 | 契约闭合；待实现 |
| V3 | 研究 e2e：W001 → G2 → 发布；每条结论有 evidenceRefs；effect 恰好 1 次发布 | `workflowRuntime.startInstance`/`approveGate`；`getInstanceOutput`（`ResearchBrief.claims[].evidenceRefs`） | `brief-claims`、`brief-distribution-dualsign` | CT03 | 契约闭合；待实现 |
| V4 | 产品 e2e：W029 PRD 发布；D011 发起 W030 → not allowlisted | `workflowRuntime.startInstance`（403 + `WorkflowNotAllowlistedHint`）；`getInstanceOutput`（`PrdArtifact`） | PRD 审批卡；目录「可转交 D003」提示 | CT06 | 契约闭合；待实现 |
| V5 | 销售 e2e：批准写 N 条；驳回 0 次；杀进程重放仍 N；冲突 `conflict`；撤权 `forbidden` | `getLeadDecisionCard`、`decideLeadItems`（`CrmWriteItemOutcome`）；`getInstanceOutput.crmItems` | `lead-item-<itemId>`、`lead-outcome-<itemId>`、`lead-conflict-diff-<itemId>`、`lead-manual-checklist` | CT09 | 契约闭合；待实现 |
| V6 | W013 事件触发实例仍停 G1；新商机不含 amount/closeDate/stage | `decideMeetingFollowup`（`NewOpportunityPayload` strict、`deferredProposals`） | `meeting-framing`、`meeting-changeset`、`deferred-proposals` | CT08 | 契约闭合；待实现 |
| V7 | Board：有权看卡与头像；无权 ID 不存在；两视图 ID 相同；不可拖动 | `listBoardRunCards`（`BoardWorkflowRunCard.draggable=false`） | `board-run-card-<instanceId>`、`board-run-card-agents`、`board-run-card-badge` | CT10 | 契约闭合；待实现 |
| V8 | 矩阵闭合 lint：skillPins = 矩阵行；白名单 = 角色矩阵行 | 内部 UC-WC-I4；`getWorkflowCatalogEntry`（`skillPins`） | —（lint 验收） | CT02/CT05/CT08 | 契约闭合；待实现 |
| V9 | `./init.sh` 与全量回归（含引导式研究）通过 | 内部 UC-WC-I5 | — | CT11 | 待实现 |

## 二、反向核对：每个操作都有验收线索

| 操作 | 被哪些行引用 |
|---|---|
| `listWorkflowCatalog` | V2 |
| `getWorkflowCatalogEntry` | V8 |
| `getInstanceOutput` | V3、V4、V5 |
| `getLeadDecisionCard` | V5 |
| `decideLeadItems` | V5 |
| `decideMeetingFollowup` | V6 |
| `listBoardRunCards` | V7 |
| `getPhase1Reconciliation` | V2 |

无孤儿操作；无未覆盖线索（V1/V8/V9 为 CLI/lint/回归，按设计无前端消费点）。

## 三、R4 异常 → 契约落点

| 异常 | 落点 |
|---|---|
| E1 | UC-WC-I1 退出码 |
| E2 | `WorkflowCatalogItem.availability/unresolvedPins` |
| E3 | `WorkflowNotAllowlistedHint` |
| E4 | `CrmWriteItemOutcome.conflict` + `conflictDiff` |
| E5 | `CrmWriteItemOutcome.forbidden` |
| E6 | domain I-C8 |
| E7 | `CrmWriteItemOutcome.rejected`、`BoardRunBadge.rejected` |
| E8 | domain I-C10；runtime 事件 |
| E9 | domain I-C14；UI `followup-email-recipients` 提示 |
| E10 | domain I-C12 |
| E11 | `CrmWriteItemOutcome.held` |
