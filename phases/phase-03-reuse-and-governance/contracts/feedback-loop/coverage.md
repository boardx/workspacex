# `feedback-loop` 束 · UC 覆盖矩阵

依据：`requirements/17-gov/uc-17-6-反馈与迭代闭环.md`（313 行）。

| UC 条目 | 落在哪 | 状态 |
|---|---|---|
| R3.a 软件反馈：提交 / 投票 / 分诊 / 状态三态 | `domain.md` §1.1 + §2 前四条操作 | 提案 |
| R3.a-1 反馈自动携带复现上下文 | `software_feedback.occurred_route/app_version/submitted_by` | 提案 |
| R3.b-5 消息级评价挂 skill+agent+上下文 | **phase-01 F68 已 passing**，本束只消费 | 已实现（不重复声明） |
| R3.b-6 聚合成含具体改动的建议（四件） | `domain.md` §1.2 + I-FB3 | 提案 |
| R3.b-7 生成改进 PR → 进入人工复核 | §1.3 + I-FB1/I-FB2 | 提案 |
| R3.b-8 人工复核通过后灰度，比例可见 | `improvement_pr.rollout_pct` + `setRollout` | 提案 |
| R3.b-9 不绕过 03-skill 双重门禁 | 边界声明（不在本束实现） | 边界 |
| R3.c-10 参与者反馈自动推送 Skill 改进队列（AC4） | **跨屏**，采集端在项目侧 | ⚠ 待裁（ui.md K-3） |
| R3.c-11 闭环度量四个数 | `getLoopMetrics` + I-FB7 | 提案 |
| A1 导出 / A2 迭代看板 | —— | ⚠ **原型待补**，建议本版不做（ui.md K-1/K-2） |
| A3 驳回附理由、反馈回 pending | `improvement_pr_decision` + 状态机 | 提案 |
| A4 灰度回滚留痕、反馈回 pending | 同上 | 提案 |
| A5 空态不生成示例反馈 | ui.md 第四节 | 提案 |
| E1 跳过复核 → 拒绝 + 安全审计 | I-FB1 + `REVIEW_REQUIRED` | 提案 |
| E2 附件脱敏 | `ATTACHMENT_NOT_SANITIZED` 阻断 | ⚠ 只阻断，不实现脱敏（domain.md §3） |
| E3 原始案例不可用 | `improvement_case.available` | 提案 |
| E4 建议缺具体改动 → 不得生成 PR | I-FB3 + `SUGGESTION_NOT_ACTIONABLE` | 提案 |
| E5 依赖不可用保留输入可重试 | ui.md 第四节 | 提案 |
| R5 权限六类角色 | usecases.md §2 | ⚠ 「人工复核人」无对应角色值，待裁 |
| AC1~AC5 | 逐条对应上表 | AC3b 是 [设计验收]，需人类签 |

## 未覆盖 / 明确不做

- **F39 / F40（客户反馈）**：UC-15.2 的地盘，不是对产品的反馈。若要做另开束。
- **开发 Agent 的实现与 CI/CD**：UC「不包含」逐字排除。
- **面向外部的公开路线图**：同上。
