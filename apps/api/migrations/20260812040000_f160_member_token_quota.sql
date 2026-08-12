/*
 * F160 —— 成员 token 配额：组织月度额度 + 逐人分配。
 *
 * ## 为什么不复用 `organizations.seat_quota`
 *
 * 那一列（F11 / O-29⑤ / I-9）答的是「这个组织还能邀几个人」。本迁移的两张表答的是
 * 「每人每月能烧多少 token」。同一个中文词「配额」在产品里指两件事，而它们的单位、
 * 结算周期、耗尽后的处置**全都不同**（人数是硬阻断邀请，token 是降级/预警/阻断三选一，
 * 见 F162）。塞进同一列会让「配额用尽」这句话在界面上失去所指。
 *
 * ## 为什么组织额度是一张表而不是 `organizations` 上的一列
 *
 * 因为**「没有行」这个状态必须存在**：它表示「组织额度未设置 ⇒ 不限额、不阻断」。
 * 加一列就必须给默认值，而默认值只有两个选择：0（＝所有人立刻用尽，正是
 * `20260811040000` 那次事故——`seat_quota` 默认 0 把每个新组织锁死在单人状态）
 * 或者某个凭空拍的数（那个数会立刻变成产品行为里一个没人签核过的常量）。
 * 一张可以没有行的表让「未设置」成为一等状态，而不是伪装成某个数字。
 *
 * ⚠ 这条取舍在 `design-signoff.md` 里等人类签（delta §1.2 与 §4①）。若人类要的是
 *   「新组织必须先分配额度才能用模型」，改的是这里 + `get-token-quotas.ts` 的
 *   `orgBudget === null` 分支，不是加一个默认值。
 *
 * ## 不变量 I-Q1
 *
 * `SUM(member_token_quota.monthly_limit) ≤ org_token_budget.monthly_budget`（额度已设置时）。
 * ⚠ **这条不下沉成数据库约束**：跨行求和的约束在 PG 里只能靠触发器串行化整张表，
 *   而它要挡的是管理员在界面上手点的那一次调整——并发两个管理员同时提额是可能的，
 *   但用例层的读-算-写在同一个事务里（`pg-token-quota-repository.setMemberQuota`
 *   的 `SELECT ... FOR UPDATE`）已经序列化了同组织的调整。判定写在
 *   `member-token-quota-overallocation-rejected.test.ts` 里，含并发那一条。
 *
 * Replayable：IF NOT EXISTS，重放安全。
 */

CREATE TABLE IF NOT EXISTS org_token_budget (
  org_id         text PRIMARY KEY REFERENCES organizations (id) ON DELETE CASCADE,
  monthly_budget bigint NOT NULL CHECK (monthly_budget >= 0),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- 谁调的。额度是钱，改动要有名字——不做完整审计表（那是 phase-03 F01 的范围），
  -- 但至少不能出现「额度变了、没人知道是谁改的」。
  updated_by     text NOT NULL
);

CREATE TABLE IF NOT EXISTS member_token_quota (
  org_id        text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id       text NOT NULL,
  monthly_limit bigint NOT NULL CHECK (monthly_limit >= 0),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text NOT NULL,
  PRIMARY KEY (org_id, user_id)
);

/* 两张表都是可变状态（额度会被调），不是 append-only 的账——`token_usage_events`
   才是账。所以这里给全套 DML 权限，不加 append-only 触发器。 */

ALTER TABLE org_token_budget ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_token_budget FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_token_budget_tenant ON org_token_budget;
CREATE POLICY org_token_budget_tenant ON org_token_budget
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

ALTER TABLE member_token_quota ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_token_quota FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS member_token_quota_tenant ON member_token_quota;
CREATE POLICY member_token_quota_tenant ON member_token_quota
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON org_token_budget TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON member_token_quota TO app_rw;

SELECT kernel_apply_org_freeze_policies();
