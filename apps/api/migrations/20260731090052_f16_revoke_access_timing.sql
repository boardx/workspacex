-- F16: 撤销后 5 秒内新访问失效；已在场者保留至环节结束；分组与签到到场回写
-- （UC-1.3 R7 / contracts/org-admin `RevokeInviteLink` `GetCheckinBoard`）
--
-- 一张表：`live_sessions` —— domain.md `LiveSession` 实体，撤销语义的锚点（I-12 ~ I-14）。
--
-- ## 为什么 `survives_until_stage_id` 是一列文本，不是一个外键
--
-- 议程环节状态机属 06-现场协作，**本迁移那个阶段还不存在**（design-signoff.md 逐字：
-- 「两条核心不变量的锚点在别的模块里……那个锚点现在既不在本束、也还不存在」）。
-- 与 `temporary_access.expires_at_stage_id`（若已建）同型：本束是环节 id 的**消费者**，
-- 不定义它、不建它的外键——建了外键，06 束哪天定下环节表的真实形状，这里就要跟着改一次
-- migration，而这条边界从一开始就不该由本束闭合。
--
-- ## 三个字段回答三个问题（I-12 / I-13 / I-14）
--
--   revoked_at              这条会话背后的链接是不是已经撤销（NULL = 未撤销）
--   survives_until_stage_id 撤销生效的方式：
--                             NULL 且 revoked_at 非空 = 立即生效（I-14，[重置全部] / 逐人移出）
--                             非 NULL                = 保留至该环节结束（I-13，单条撤销）
--   ended_at                会话本身是否已经结束（立即生效 revoke 时与 revoked_at 一起写）
--
-- 「新访问 ≤5 秒失效」（I-12）**不落在这张表**：核销路径（`invite_links.revoked_at`，
-- 迁移 0025）已经是同一份记录、同一个事务读到的——单一数据源没有「传播延迟」这件事，
-- 5 秒是契约对**外部缓存/只读副本**场景预留的 SLA 上限，不是本实现需要新造一列去满足的
-- 宽限期。`revoke-5s-new-access-denied.test.ts` 断言的正是「immediate ⊂ within 5s」。
--
-- Replayable：IF NOT EXISTS，`migrate:check` 会忽略版本表重放每个文件。

CREATE TABLE IF NOT EXISTS live_sessions (
  id             text PRIMARY KEY,
  org_id         text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id     text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,

  -- 这条会话是用哪条链接进场的——单条撤销要能按 link_id 定位它名下仍在场的会话。
  link_id        text NOT NULL REFERENCES invite_links (id) ON DELETE CASCADE,
  -- 名单条目——签到板的「11/12 已到」按它分组计数（I-16：观察者视角下不含手机号，
  -- 这里也不存手机号，只存外键）。
  participant_id text NOT NULL REFERENCES project_participants (id) ON DELETE CASCADE,
  -- 免注册身份 id（domain.md `GuestIdentity.id`）。F16 本轮不建该表，
  -- 这里先存**操作者标识空间**里的一个字符串（与正式账号共用同一空间，uc-1-2 R10）。
  guest_identity_id text NOT NULL,
  group_id       text REFERENCES groups (id) ON DELETE SET NULL,

  entered_at_stage_id     text,
  survives_until_stage_id text,
  revoked_at     timestamptz,
  ended_at       timestamptz,

  created_at     timestamptz NOT NULL DEFAULT now(),

  -- 立即生效（I-14）时两列一起写；单条撤销（I-13）时只写 revoked_at，
  -- 会话仍在场直到环节结束才补 ended_at。「已撤销但既没保留环节也没结束」是不可能的中间态。
  CONSTRAINT live_sessions_revoke_shape CHECK (
    revoked_at IS NULL
    OR survives_until_stage_id IS NOT NULL
    OR ended_at IS NOT NULL
  )
);

-- 「一次撤销要能按 link_id 找到它名下仍在场的会话」（I-13 的定位依据）。
CREATE INDEX IF NOT EXISTS live_sessions_link_idx ON live_sessions (org_id, link_id) WHERE ended_at IS NULL;
-- 「在场」= 该项目下 ended_at 为空的会话；签到板与 [重置全部] 都按 (org, project) 扫。
CREATE INDEX IF NOT EXISTS live_sessions_project_onsite_idx
  ON live_sessions (org_id, project_id) WHERE ended_at IS NULL;
-- 到场回写：同一名单条目重复签到（掉线重连）应命中同一条在场会话，不产生第二条。
CREATE UNIQUE INDEX IF NOT EXISTS live_sessions_onsite_participant_uniq
  ON live_sessions (project_id, participant_id) WHERE ended_at IS NULL;

DO $$
BEGIN
  ALTER TABLE live_sessions ENABLE ROW LEVEL SECURITY;
  ALTER TABLE live_sessions FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS live_sessions_tenant ON live_sessions;
  CREATE POLICY live_sessions_tenant ON live_sessions
    USING (org_id = current_setting('app.current_org', true))
    WITH CHECK (org_id = current_setting('app.current_org', true));
  GRANT SELECT, INSERT, UPDATE ON live_sessions TO app_rw;
END
$$;

-- F22 冻结：新建的租户表必须显式补上三条 RESTRICTIVE 策略（见 0014 文件头，
-- 这是它记录过的第三次坑——新库上的新租户表默认没有冻结）。
SELECT kernel_apply_org_freeze_policies();
