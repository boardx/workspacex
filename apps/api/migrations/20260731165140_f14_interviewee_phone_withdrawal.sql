-- 20260731165140 F14: 受访者手机号纳入撤回与删除范围（D-13 最小切片）
-- (contracts/org-admin `WithdrawParticipantPhone`, usecases.md I-34)
--
-- ⚠ D-13 最小切片：本迁移**只做「触发与手机号接入」**——入待删除队列 + 让该手机号
--   立即退出 F12 进场路径的检索范围。**不做**级联引擎本体（报告段落标失效 / 30 天物理
--   删除的实际执行）——那部分属 22-files（T86）与 17-gov（UC-17.2），见 domain.md
--   「与 22-files/17-gov 的分工」一节。此处只落「有没有人发起过撤回、发起时的两个
--   deadline 是多少」这件事，供上游触发与下游（T86）消费。
--
-- ## 为什么是新表 + 一个新列，而不是把两个 deadline 现算
--
-- 契约 `out` 逐字返回 `queuedAt` / `logicalRetireDeadline` / `physicalDeleteDeadline`——
-- 一次查询要能把「这个人什么时候发起的撤回、剩多久到期」答出来，且**幂等重放要返回
-- 同一单据**（usecases.md 逐字）。现算意味着重放时用 `now()` 重新推一次，两次调用
-- 拿到两个不同的 deadline——这正是撤回链单源想禁止的「同一件事两个数」的另一种形态。
-- ⇒ 落库存一次，之后只读不重算。两个 deadline 的**数值**（≤5 分钟 / ≤30 天）仍然只有
--   一个来源：`apps/web/lib/withdrawal-flow.ts`（`WITHDRAWAL_SLA_SUMMARY`），
--   本迁移与 application 层都不重新声明这两个数字，只把 TS 侧算好的时间戳搬进来。
--
-- ## `project_participants.withdrawn_at`：检索范围的开关落在哪一行
--
-- I-34 ②「关联可识别信息 ≤5 分钟退出检索范围」。本仓没有独立的搜索索引——
-- F12 进场路径（`joinByGroupLink`）按 `(project_id, contact_kind='phone', contact)`
-- 直接查 `project_participants`，这张表本身就是「检索范围」。⇒ 退出检索 = 该行的
-- `withdrawn_at` 非空 + 查询侧加 `AND withdrawn_at IS NULL`。触发是**同一事务**内的
-- 一次 UPDATE（与入队同一个 `withdrawParticipantPhone` 事务），不是异步任务——
-- 这样「≤5 分钟」在本仓的实现里是**立即**成立而非等到某个后台任务跑到，
-- 符合契约「部分成功：禁止——入队、退出检索、标失效三件的触发在同一事务」。
--
-- Replayable：IF NOT EXISTS，`migrate:check` 会忽略版本表重放每个文件。

ALTER TABLE project_participants
  ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz;

CREATE TABLE IF NOT EXISTS participant_withdrawal_requests (
  id         text PRIMARY KEY,
  org_id     text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  -- 与 project_participants 同生共死：名单条目被清出项目，撤回单据没有独立存在的意义。
  participant_id text NOT NULL REFERENCES project_participants (id) ON DELETE CASCADE,

  -- 契约 `in.requestedBy`：受访者本人发起 vs 引导师代发起。两者都合法（domain.md I-34
  -- 前的 UC 逐字「受访者/参与者」），落库以便回执与审计能区分「谁按下的」。
  requested_by text NOT NULL CHECK (requested_by IN ('data-subject', 'facilitator')),

  -- 三个时间戳：入队时刻 + 两级 SLA 到期时刻（数值来源见文件头，这里只存不算）。
  queued_at                timestamptz NOT NULL,
  logical_retire_deadline  timestamptz NOT NULL,
  physical_delete_deadline timestamptz NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT participant_withdrawal_deadlines_ordered
    CHECK (queued_at <= logical_retire_deadline AND logical_retire_deadline <= physical_delete_deadline)
);

-- 一名参与者至多一张在途撤回单据——幂等重放读的就是这一行，而不是「查最新一条」。
-- 与 0025 `project_participants_contact_uniq` 同一条纪律：唯一索引 + ON CONFLICT，
-- 不是「先查后插」（两路并发的撤回请求都查到「没有」，两路都插入成功，
-- 出两张单据、两个不同的 deadline，而幂等重放的承诺就破了）。
CREATE UNIQUE INDEX IF NOT EXISTS participant_withdrawal_requests_participant_uniq
  ON participant_withdrawal_requests (participant_id);

CREATE INDEX IF NOT EXISTS participant_withdrawal_requests_project_idx
  ON participant_withdrawal_requests (org_id, project_id);

-- 与 0025 / F12 迁移同一形状：租户表一律 ENABLE + FORCE + 单条 org_id 策略。
DO $$
BEGIN
  ALTER TABLE participant_withdrawal_requests ENABLE ROW LEVEL SECURITY;
  ALTER TABLE participant_withdrawal_requests FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS participant_withdrawal_requests_tenant ON participant_withdrawal_requests;
  CREATE POLICY participant_withdrawal_requests_tenant ON participant_withdrawal_requests
    USING (org_id = current_setting('app.current_org', true))
    WITH CHECK (org_id = current_setting('app.current_org', true));
  GRANT SELECT, INSERT ON participant_withdrawal_requests TO app_rw;
END
$$;

-- F22 的停用冻结（三条 RESTRICTIVE 策略）。见 0025 文件头：**必须显式调用**，
-- 不能指望旧迁移自己扫到这张新表。
SELECT kernel_apply_org_freeze_policies();
