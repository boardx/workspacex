# `feedback-loop` 束 · ③ API 契约与领域模型

⚠ 本文件是**提案**，`design-signoff.md` 的 `status` 是 `pending`。
下面的形状在人类签核前**不得实现**（ADR-023）。

## §1 领域模型

### 1.1 `software_feedback` —— 软件反馈

```sql
CREATE TABLE software_feedback (
  id            text PRIMARY KEY,
  org_id        text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('defect', 'request')),
  title         text NOT NULL,
  body          text NOT NULL,
  submitted_by  text NOT NULL,
  -- 反馈自动携带的复现上下文（R3.a-1：发生位置 / 版本 / 操作者）。
  -- 不是自由 jsonb：三个字段各一列，否则「复现上下文」会退化成一个什么都能塞的口袋。
  occurred_route text NOT NULL,
  app_version    text NOT NULL,
  status        text NOT NULL CHECK (status IN ('pending', 'in_iteration', 'fixed')),
  -- I-FB4：fixed 必须同时有版本号与 PR
  fixed_in_version text NULL,
  pr_id            text NULL REFERENCES improvement_pr (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT software_feedback_fixed_traceable_check CHECK (
    status <> 'fixed' OR (fixed_in_version IS NOT NULL AND pr_id IS NOT NULL)
  )
);
```

`software_feedback_vote(feedback_id, voter_id)` 主键去重——一人一票，票数是 `COUNT(*)`，
**不存一个 `vote_count` 列**：那会立刻变成第二份可能对不上的事实。

### 1.2 `improvement_suggestion` —— 由消息级评价聚合出来的建议

```sql
CREATE TABLE improvement_suggestion (
  id                 text PRIMARY KEY,
  org_id             text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- 归因到**版本**，不是 skill/agent 本身（I-FB6，phase-01 F68 已实现，这里只引用）
  skill_version_id   text NULL,
  agent_version_id   text NULL,
  phenomenon         text NOT NULL,   -- 现象：「打断时机过早」
  negative_count     integer NOT NULL CHECK (negative_count > 0),
  attribution        text NOT NULL,   -- 归因：「在讨论未收敛时就提示投票」
  -- 具体改动。⚠ NOT NULL 是 I-FB3 的一半：没有它就没有这一行，而不是有一行空的。
  proposed_change    jsonb NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
```

`proposed_change` 的形状（至少一项）：
`{ "kind": "threshold", "param": "converge_trigger_repeats", "from": 3, "to": 5 }`
或 `{ "kind": "prompt", "diff": "..." }`。
⚠ **空对象 `{}` 必须被拒**——这正是 E4 那条「只有『表现不好』不得生成 PR」的落点。

`improvement_case(suggestion_id, message_id, available)` —— 原始案例。
`available=false` 表示消息已删/已撤回（E3）：**行留着**，`[看 N 个原始案例]` 里如实标注，
不删行也不伪造案例。

### 1.3 `improvement_pr` —— 改进 PR 与它的三步

```sql
CREATE TABLE improvement_pr (
  id             text PRIMARY KEY,
  org_id         text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  source_kind    text NOT NULL CHECK (source_kind IN ('software_feedback', 'improvement_suggestion')),
  source_id      text NOT NULL,
  status         text NOT NULL CHECK (status IN
                   ('drafted','under_review','approved','rejected','rolling_out','rolled_out','rolled_back')),
  drafted_by_agent text NOT NULL,          -- 开发 Agent 的标识
  -- ⚠ I-FB1：只能是人。约束不在这里（数据库分不清人和 agent），
  --    在用例层 + 一条反证测试：以开发 Agent 身份置 approved 必须被拒并留审计。
  approved_by    text NULL,
  rollout_pct    integer NOT NULL DEFAULT 0 CHECK (rollout_pct BETWEEN 0 AND 100),
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- I-FB5：驳回/回滚的理由 append-only，与 UC-17.1 同一条纪律
CREATE TABLE improvement_pr_decision (
  id         text PRIMARY KEY,
  pr_id      text NOT NULL REFERENCES improvement_pr (id) ON DELETE CASCADE,
  decision   text NOT NULL CHECK (decision IN ('approved','rejected','rolled_back')),
  decided_by text NOT NULL,
  reason     text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now()
);
-- append-only 触发器，同 token_usage_events / limit_events 的写法
```

## §2 契约操作（提案）

```ts
submitSoftwareFeedback:  POST /organizations/:orgId/feedback
voteSoftwareFeedback:    POST /organizations/:orgId/feedback/:feedbackId/vote
listSoftwareFeedback:    GET  /organizations/:orgId/feedback           // 排序：票数 desc
triageSoftwareFeedback:  POST /organizations/:orgId/feedback/:feedbackId/triage
listImprovementSuggestions: GET /organizations/:orgId/improvement-suggestions
listSuggestionCases:     GET  /organizations/:orgId/improvement-suggestions/:id/cases
draftImprovementPr:      POST /organizations/:orgId/improvement-prs     // 开发 Agent 起草
reviewImprovementPr:     POST /organizations/:orgId/improvement-prs/:prId/review
setRollout:              PATCH /organizations/:orgId/improvement-prs/:prId/rollout
getLoopMetrics:          GET  /organizations/:orgId/feedback/loop-metrics
```

三处**必须**在 `out` 里的东西（否则界面只能靠猜）：

1. `listSoftwareFeedback` 的每一行带 `allowedTransitions: FeedbackStatus[]`
   ——按钮可用性由服务端说了算，前端不内置第二份状态机（usecases §3 末）。
2. `listImprovementSuggestions` 的每一行带 `caseCount` 与 `actionable: boolean`
   ——`actionable=false` 时 `[生成 skill 改进 PR]` **不可点**，且屏上说明缺哪一件。
3. `getLoopMetrics` 的四个数带同一个 `periodStart`
   ——I-FB7：同源可核对，不是四个各查各的。

## §3 两处刻意留白（不在本束解决，请人类确认这个边界）

- **附件脱敏（E2）**：本束只把它写成一条**阻断**（`ATTACHMENT_NOT_SANITIZED`），
  不给自动脱敏方案。真做自动脱敏（音频里的客户名、PII）是另一个 UC 的量级，
  在这里顺手写一个「看起来在脱敏」的实现，比明说做不到更危险。
- **开发 Agent 怎么真的生成 PR**：本束只定义产品侧的触发与状态（UC「不包含」逐字：
  「开发 Agent 的实现、代码仓库与 CI/CD 系统本身」）。`draftImprovementPr` 落的是
  一条记录，不是一次真实的代码提交。
