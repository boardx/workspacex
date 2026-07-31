-- 20260731090952 F12: 免注册身份落库（UC-1.2 / contracts/org-admin `JoinByGroupLink`）
--
-- guest_identities  免注册身份。**不是账号**——不写 credentials，也不写任何 accounts 表
--                   （I-18：走完整条进场流程，那两类表的行数前后相等）。
--
-- ## 为什么 `id` 没有外键指向任何「用户」表
--
-- `project_memberships.user_id`（0003 identity）本来就是一列**无外键约束**的 text——
-- 正式账号与免注册身份共用同一套操作者标识空间（domain.md `GuestIdentity`），
-- 而不是「先在某张用户表建一行，再引用它」。这张表因此可以把它的 id 直接写进
-- `project_memberships.user_id`，不需要、也不应该新建一张「访客账号表」——
-- 那正是 I-18 想要禁止的东西的另一种写法。
--
-- ## 幂等落点：`(project_id, participant_id)` 唯一
--
-- I-19「同一名单条目重复进场返回同一 guestIdentityId，不产生第二个身份」。
-- 与 `project_participants_contact_uniq`（0025）同一条纪律：用唯一索引 + ON CONFLICT
-- 而不是「先查后插」，否则两路并发的进场请求都查到「还没有」，两路都插入成功，
-- 同一个人在名单里对应两个免注册身份。
--
-- ## `group_id` 为什么在这张表上单独存一份，而不是每次现查 `project_participants`
--
-- 名单条目的 `group_id` 之后可能被引导师重新分组（O-29 ④），而 I-20 说的是
-- 「进场那一刻」落地哪个组——`GuestIdentity` 是那一刻的快照，不随名单条目事后改动
-- 而回溯性地改变一个已经进过场的人当时落在哪个组。这与 `invite_links.project_role`
-- 是签发时刻的暂存、进场时逐字搬到 `project_memberships` 是同一种处置。
--
-- Replayable：IF NOT EXISTS，`migrate:check` 会忽略版本表重放每个文件。

CREATE TABLE IF NOT EXISTS guest_identities (
  id             text PRIMARY KEY,
  org_id         text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id     text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  participant_id text NOT NULL REFERENCES project_participants (id) ON DELETE CASCADE,

  -- 进场那一刻的快照（见文件头）。四值恒等 project_memberships.project_role 的集合。
  group_id     text REFERENCES groups (id) ON DELETE SET NULL,
  project_role text NOT NULL CHECK (project_role IN ('facilitator', 'groupLead', 'member', 'observer')),

  -- 展示层代称（domain.md [待定 D]，占位实现见 domain/auth/guest-identity.ts）。
  alias text NOT NULL,

  -- 项目结束自动归档（I-24）；归档后不可再进场，其产出仍追溯到 participant_id。
  archived_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now()
);

-- I-19：同一名单条目至多一个免注册身份。
CREATE UNIQUE INDEX IF NOT EXISTS guest_identities_participant_uniq
  ON guest_identities (project_id, participant_id);

CREATE INDEX IF NOT EXISTS guest_identities_project_idx ON guest_identities (org_id, project_id);

-- 与 0025 同一形状：租户表一律 ENABLE + FORCE + 单条 org_id 策略。
DO $$
BEGIN
  ALTER TABLE guest_identities ENABLE ROW LEVEL SECURITY;
  ALTER TABLE guest_identities FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS guest_identities_tenant ON guest_identities;
  CREATE POLICY guest_identities_tenant ON guest_identities
    USING (org_id = current_setting('app.current_org', true))
    WITH CHECK (org_id = current_setting('app.current_org', true));
  GRANT SELECT, INSERT, UPDATE ON guest_identities TO app_rw;
END
$$;

-- F22 的停用冻结（三条 RESTRICTIVE 策略）。见 0025 文件头：**必须显式调用**，
-- 不能指望旧迁移自己扫到这张新表。
SELECT kernel_apply_org_freeze_policies();
