# `feedback-loop` 束 · ② 用例（失败模式与不变量）

## 第零节 · 错误码

| 码 | 何时 | ⚠ |
|---|---|---|
| `FEEDBACK_NOT_FOUND` | 反馈 id 不存在或不在本组织 | 与「存在但无权看」返回**同一个码**，否则它是一个反馈存在性探测器 |
| `INVALID_STATE_TRANSITION` | 状态机转移不在合法表里（§3） | 响应体带 `from` / `to` / `allowed[]`——只说「非法」等于让人靠试 |
| `REVIEW_REQUIRED` | 试图跳过人工复核上线 | **同时写一条安全审计**（E1），不是静默拒绝 |
| `SUGGESTION_NOT_ACTIONABLE` | 改进建议缺具体改动 | 响应体点名缺哪一件（归因 / 参数改动） |
| `ATTACHMENT_NOT_SANITIZED` | 未脱敏的附件试图进入推送 payload | 阻断，不降级为「推了但不带附件」——那会让推送方以为附件送到了 |
| `ORIGINAL_CASE_UNAVAILABLE` | 评价指向的消息已删/已撤回 | **不是错误**，是标注：评价保留、案例标注不可用（E3） |

## 第一节 · 不变量（服务端强制，不靠界面）

- **I-FB1（人工复核是必经环节）**：`improvement_pr` 的状态只能沿
  `drafted → under_review → (approved | rejected)` 走；`approved` **只能由人**产生。
  开发 Agent 的主体永远不能出现在 `approved_by`。
  ⇒ 反证：以开发 Agent 身份直接置 `approved` / 直接置 `rolled_out`，两条都必须被拒 + 留审计。
- **I-FB2（三步不可颠倒）**：`rolled_out` 的前驱必须是 `approved`；
  `approved` 的前驱必须是 `under_review`。跳步一律 `INVALID_STATE_TRANSITION`。
  ⚠ 原型只陈述了一次成功路径（「开发 Agent 提交，人工复核通过，已灰度 100%」），
  **没有**表明其它顺序被拒绝——这条是 [设计验收] AC3b，需要人类签。
- **I-FB3（建议必须可执行）**：`improvement_suggestion` 生成 PR 的前提是它同时具备
  现象 / 负评数 / 归因 / **具体参数或提示词改动** 四件。缺任一件 ⇒ `SUGGESTION_NOT_ACTIONABLE`。
  ⇒ 反证：构造一条只有「表现不好」的建议，断言 PR **没有被创建**（不是「创建了但标记警告」）。
- **I-FB4（溯源不因已修复而断）**：`fixed` 状态的反馈必须同时带 `fixedInVersion` 与 `prId`。
- **I-FB5（驳回与回滚的理由不可覆盖）**：`rejected` / `rolled_back` 的 `reason` 一旦写入
  不可 UPDATE（append-only），与 UC-17.1「退回理由不可覆盖」同一条纪律。
- **I-FB6（评价挂版本不挂 id）**：消息级评价归因到 `skillVersionId` / `agentVersionId`。
  ⚠ 这条**已由 phase-01 F68 实现并 passing**，本束不重新声明，只消费。
- **I-FB7（闭环度量四个数同源）**：`N 条反馈 → M 条 PR → K 条上线 → 满意度 ±X` 必须
  从同一批记录派生，不得各查各的。⇒ 反证：造一条 `approved` 但未 `rolled_out` 的 PR，
  断言 M 增 1 而 K 不变。

## 第二节 · 权限（R5）

| 角色 | 可以 | 不可以 |
|---|---|---|
| 任意使用者 | 提反馈、投票、打消息级评价、看自己的反馈状态 | 看他人附件（**K-5 待裁**：全文可见与否） |
| 组织管理员 | 分诊、推送开发 Agent、生成改进 PR、导出 | **放行上线** |
| 人工复核人 | 批准 / 驳回 / 回滚 / 调灰度比例 | —— |
| 开发 Agent | 起草方案、提交 PR | **合并、上线、改灰度比例**（三样都不行） |
| 观察者 / 客户 | —— | **整个模块不可见**（这是产品内部治理） |

⚠ 「人工复核人」在本产品的角色本体里**目前没有对应值**（组织角色四值 + 项目角色）。
→ 待裁：是新增一个组织角色，还是复用「管理员 ∧ 非发起人」（同 F11 双人复核的形状）。
我的倾向是后者：新增角色要动 phase-00 的 identity 束，代价远大于收益。

## 第三节 · 状态机（合法转移表）

**软件反馈** `software_feedback.status`：

```
pending ──(分诊)──> in_iteration ──(PR 上线)──> fixed
   ^                     │
   └──(PR 被驳回/灰度回滚)─┘
```

- `fixed` 是**终态**（但保留 `fixedInVersion` + `prId`，I-FB4）。
- 驳回与回滚都把反馈**退回 `pending`**，不是关闭（A3/A4 逐字）。

**改进 PR** `improvement_pr.status`：

```
drafted ──> under_review ──> approved ──> rolling_out ──> rolled_out
                  │              │            │
                  └──> rejected  └──> rejected└──> rolled_back ──> (反馈回 pending)
```

任何不在这张表里的转移 ⇒ `INVALID_STATE_TRANSITION`。
⚠ **表本身是服务端的单一事实源**：前端不得内置第二份「哪些按钮可点」的判断，
按钮可用性由接口返回的 `allowedTransitions` 决定。
