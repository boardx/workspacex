# token 计量 / 成员 token 配额 / 用量监控 / 限额策略 —— contract delta

Status: proposed; human signoff required.

本文件是本 delta 的**唯一规范来源**。已签核的 `org-admin` 束（`status: confirmed`，
`confirmed_by: yanbin shen`，2026-07-30）保持不变、不被静默修改；若本包与既有束冲突，
实现停下来，等人类签这份 delta。

覆盖 feature：**F159 / F160 / F161 / F162 / F163**（phase-01，owner `dev-org-admin`）。
其中 **F163 不在本 delta 的范围内**——它不新增任何契约操作，只是把 F06 已 passing 的
既有端点接到界面上；列在这里只是为了说明「成员与配额」整屏的四块里有一块不需要签。

派工依据：coord-main 2026-08-12 裁决（线 A 走已签 org-admin 束，超出③件已签范围的新端点
按 #953 先例走 design-delta 补签，实现可并行、PR 等签）。

---

## 0. 背景（2026-08-12 实测，SHA `54d9e340`）

- **全仓零 token 计量落库**。`agent_runs`（`20260804060000_wave2_chat_message_acceptance.sql:23`）
  有 `model_provider` / `model_id`，**没有任何 token 列**；`agent_run_steps` 有 `model_called`
  这一步，也没有。全仓 grep `token_usage` / `tokens_in` / `totalTokens` 命中 0 个迁移文件。
- **数已经拿到手了，只是被丢掉**。`infrastructure/agent-run/configured-model-provider.ts`
  已从上游 `usage.total_tokens` 解出并经 `complete()` / `completeStream()` 返回
  `{ text, tokens }`（该文件 133/207-211/313-325 行）；`application/agent-run/execute-run.ts`
  拿到 `completion` 后**不使用 `tokens`**。
- **前端两块都是 mock**。`components/admin/members-screen.tsx`（420 行）与
  `usage-monitor-tab.tsx` / `limit-policy-tab.tsx` 全屏挂 `NoBackendNotice`，
  数据来自 `lib/mock/admin.ts`（`MEMBERS.usedM/limitM`）与 `lib/mock/admin-limits.ts`。
  `usage-monitor-tab.tsx` 自己的文件头注释逐字承认：「窗口切换只影响本地展示态（无后端），
  不真正拉取不同窗口的数据——mock 定死一份「本周」快照」。
- **`seat_quota` 不是这件事**。`organizations.seat_quota`（F11 / O-29⑤ / I-9）管的是
  「还能邀请几个人」，2026-08-11 刚被 `20260811040000_devapp_seat_quota_default.sql`
  把默认值从 0 改成 50。本 delta 的 token 额度是**另一件事**，不复用那一列。

---

## 1. 数据模型

### 1.1 `token_usage_events`（F159）—— 用量的唯一事实源

```sql
CREATE TABLE IF NOT EXISTS token_usage_events (
  id             text PRIMARY KEY,
  org_id         text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id        text NOT NULL,
  run_id         text NULL REFERENCES agent_runs (id) ON DELETE SET NULL,
  model_provider text NOT NULL,
  model_id       text NOT NULL,
  tokens_total   bigint NOT NULL CHECK (tokens_total >= 0),
  outcome        text NOT NULL CHECK (outcome IN ('succeeded', 'failed')),
  occurred_at    timestamptz NOT NULL DEFAULT now()
);
```

- **append-only**：UPDATE / DELETE 由触发器拒绝（同 `wave2_agent_run_step_append_only`
  的写法，含「父组织已删除时放行级联」的同一豁口）。RLS 按 `app.current_org`。
- **⚠ 只有 `tokens_total`，没有 in/out 拆分**。上游我们今天真正拿得到的只有
  `usage.total_tokens`（见第 0 节）。造两列再各填一半是伪造维度——记为具名缺口
  **`GAP-TOKEN-IO-SPLIT`**：等 provider 侧真能分出 prompt/completion 再加列，
  届时旧行按 NULL 处理而不是回填猜测值。
- **失败也记一行**（`outcome='failed'`, `tokens_total=0`）。理由：管理员问「这个人这周
  怎么用了这么多」时，失败重试是答案的一部分；「失败就没有用量」会让计量流水与
  `agent_runs` 的行数对不上，而对不上时没人知道是漏记还是真没调用。

### 1.2 `org_token_budget`（F160）—— 组织月度额度

```sql
CREATE TABLE IF NOT EXISTS org_token_budget (
  org_id         text PRIMARY KEY REFERENCES organizations (id) ON DELETE CASCADE,
  monthly_budget bigint NOT NULL CHECK (monthly_budget >= 0),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     text NOT NULL
);
```

**⚠ 一处需要人类确认的取舍：没有行 ＝ 未设置组织额度 ＝ 不限额、不阻断。**
不给 `organizations` 加一列带默认值，正是因为 `seat_quota` 那次的教训——一个
「默认 0」把每个新组织锁死，而 O-29⑤ 当初只裁了「用尽时阻断」，没裁「从 0 开始」。
这里改成：**未设置就是没有这条约束**，界面显示「未设置组织额度」并给出设置入口，
而不是把所有人显示成 0/0 已用尽。若人类要的是「新组织必须先分配额度才能用模型」，
请在签核时改这一条，实现随之改。

### 1.3 `member_token_quota`（F160）

```sql
CREATE TABLE IF NOT EXISTS member_token_quota (
  org_id        text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id       text NOT NULL,
  monthly_limit bigint NOT NULL CHECK (monthly_limit >= 0),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text NOT NULL,
  PRIMARY KEY (org_id, user_id)
);
```

不变量 **I-Q1**：`SUM(member_token_quota.monthly_limit) ≤ org_token_budget.monthly_budget`
（组织额度已设置时）。违反即 `QUOTA_OVERALLOCATED`，响应体带 `remainingTokens`
（还剩多少可分配）——延续 `QUOTA_EXHAUSTED` 那条「阻断必须伴随可执行的下一步」的纪律。

### 1.4 `limit_rules` / `limit_events`（F162）

```sql
CREATE TABLE IF NOT EXISTS limit_rules (
  id              text PRIMARY KEY,
  org_id          text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  scope_kind      text NOT NULL CHECK (scope_kind IN ('member','role','team','agent','model')),
  scope_ref       text NOT NULL,
  window_kind     text NOT NULL CHECK (window_kind IN ('hour','day','week','month')),
  threshold_tokens bigint NOT NULL CHECK (threshold_tokens > 0),
  action          text NOT NULL CHECK (action IN ('warn','degrade','block','require_approval')),
  enabled         boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS limit_events (
  id           text PRIMARY KEY,
  org_id       text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  rule_id      text NOT NULL REFERENCES limit_rules (id) ON DELETE CASCADE,
  subject_kind text NOT NULL,
  subject_ref  text NOT NULL,
  action_taken text NOT NULL,
  observed_tokens bigint NOT NULL,
  occurred_at  timestamptz NOT NULL DEFAULT now()
);
```

- `scope_kind` 五值 ＝ 前端 `LimitScopeKind`（个人/角色/团队/Agent/模型）的**同一集合**，
  一份枚举两种语言：测试从 `pg_constraint` 读回并与契约枚举断言相等（同
  `agent_run_steps_kind_check` 的既有做法），杜绝第二份副本。
- **求值：取最先触发的一条**（`first-trigger-wins`）。多条规则同时命中时，按
  `观测值 / 阈值` 的比值先到先得，命中哪条就在 `limit_events.rule_id` 写哪条——
  界面不说笼统的「超限」。⚠ 这条判据的语义来自 phase-03 F14（三级阈值取最先触发），
  本 delta **只借语义不领 feature**：不做 F14 的四类任务处置矩阵、不做机密数据禁降级。

---

## 2. 契约操作（追加进 `packages/contracts/src/org-admin.ts`，不新建文件）

```ts
getTokenQuotas: {
  method: "GET",
  path: "/organizations/:orgId/token-quotas",
  in: z.object({ orgId: z.string() }).strict(),
  out: z.object({
    orgBudget: z.number().nullable(),        // null = 未设置（见 §1.2）
    allocated: z.number(),
    unallocated: z.number().nullable(),      // orgBudget 为 null 时也是 null，不写 0
    orgUsed: z.number(),
    overspendCount: z.number(),              // 已用 > 85% 的人数
    members: z.array(z.object({
      userId: z.string(),
      displayName: z.string(),
      email: z.string(),
      orgRole: OrgRole,
      teamId: z.string().nullable(),
      monthlyLimit: z.number().nullable(),   // null = 未分配
      usedTokens: z.number(),
    }).strict()),
  }).strict(),
  err: ["NO_ORG_MEMBERSHIP", "FORBIDDEN", "AUTH_SERVICE_UNAVAILABLE"] as const,
},

setMemberTokenQuota: {
  method: "PATCH",
  path: "/organizations/:orgId/token-quotas/:userId",
  in: z.object({ orgId: z.string(), userId: z.string(), monthlyLimit: z.number().int().min(0) }).strict(),
  out: z.object({
    userId: z.string(), monthlyLimit: z.number(),
    allocated: z.number(), unallocated: z.number().nullable(),
  }).strict(),
  err: ["NO_ORG_MEMBERSHIP", "FORBIDDEN", "QUOTA_OVERALLOCATED",
        "MEMBER_NOT_FOUND", "AUTH_SERVICE_UNAVAILABLE"] as const,
},

setOrgTokenBudget: {
  method: "PATCH",
  path: "/organizations/:orgId/token-budget",
  in: z.object({ orgId: z.string(), monthlyBudget: z.number().int().min(0) }).strict(),
  out: z.object({ orgBudget: z.number(), allocated: z.number(), unallocated: z.number() }).strict(),
  err: ["NO_ORG_MEMBERSHIP", "FORBIDDEN", "BUDGET_BELOW_ALLOCATED",
        "AUTH_SERVICE_UNAVAILABLE"] as const,
},

getUsageReport: {
  method: "GET",
  path: "/organizations/:orgId/usage",
  in: z.object({ orgId: z.string(), window: UsageWindow }).strict(),   // '5h'|'today'|'week'|'month'
  out: z.object({
    window: UsageWindow,
    totalTokens: z.number(),
    callCount: z.number(),
    failedCallCount: z.number(),
    activeMemberCount: z.number(),
    models: z.array(z.string()),                    // 矩阵的列
    rows: z.array(z.object({                        // 矩阵的行：人 × 模型
      userId: z.string(), displayName: z.string(),
      perModel: z.array(z.number()), total: z.number(),
    }).strict()),
    distribution: z.array(z.object({
      modelId: z.string(), tokens: z.number(), share: z.number(),
    }).strict()),
    recentLimitEvents: z.array(z.object({
      id: z.string(), occurredAt: z.string(), subjectKind: z.string(), subjectRef: z.string(),
      ruleId: z.string(), actionTaken: z.string(), observedTokens: z.number(),
    }).strict()),
  }).strict(),
  err: ["NO_ORG_MEMBERSHIP", "FORBIDDEN", "AUTH_SERVICE_UNAVAILABLE"] as const,
},

listLimitRules / createLimitRule / updateLimitRule / deleteLimitRule: {
  // /organizations/:orgId/limit-rules[ /:ruleId ]
  // in/out 逐字段见实现；err 同上 + "LIMIT_RULE_NOT_FOUND"
},
```

**新增错误码三个**（进 `OrgAdminError` 枚举）：`QUOTA_OVERALLOCATED`、
`BUDGET_BELOW_ALLOCATED`、`LIMIT_RULE_NOT_FOUND`。
⚠ 不复用 `QUOTA_EXHAUSTED`——那一条是 F11 的「人数配额用尽」，语义是「不能再邀人」；
把 token 超分配也塞进同一个码，界面就没法说清到底是哪种额度出了问题。

**授权**：四组读写一律**仅组织 admin**（`FORBIDDEN`），与 `listOrgInvites` 同一收窄取向，
且**各自判一次**，不共用 `listOrgMembers` 的判定（那一条对普通成员开放）。

---

## 3. 写入点唯一性（F159 的主张）

`application/agent-run/execute-run.ts` 里 `model_called` 那一步结束处是**唯一**写入
`token_usage_events` 的地方。反证测试 `token-usage-single-write-path.test.ts` 扫描
`apps/api/src` 全部源码，断言 `INSERT INTO token_usage_events` 只出现在计量仓储的
一个文件里，且该仓储只被 `execute-run` 调用。

理由：这条流水是配额、用量监控、限额事件三块的共同上游。允许第二个写入点，
就等于允许两处对「一次调用算多少 token」给出不同答案——本仓已因同一事实两处声明
栽过五次（AGENTS.md 顶部那条警告）。

---

## 4. 请人类在签核时明确回答

1. **§1.2 的「未设置 ＝ 不限额」**是否就是你要的？还是新组织必须先分配 token 额度？
2. **§1.1 的「失败调用也记一行」**是否接受？它会让用量矩阵里出现「有调用没 token」的格子。
3. **`GAP-TOKEN-IO-SPLIT`**：今天只记 total 是否可以？（拆 in/out 要等 provider 侧先能给。）
4. **§2 的授权收窄**（四组端点一律仅 admin）——普通成员能不能看自己的用量？
   本 delta 的取向是**这一屏是后台管理屏，普通成员根本进不来**；若要给成员自查入口，
   那是另一条 feature，不在这里顺手做。
