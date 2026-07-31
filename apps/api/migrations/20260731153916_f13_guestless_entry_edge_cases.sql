-- 20260731153916 F13: 免注册进场三种意外之二/三（UC-1.2 R4 / contracts/org-admin
--                       `ApplyForJoin` `ReviewJoinApplication` `ResumeLiveSession`）
--
-- 「三种意外」在契约里分属三个用例：
--   ① 打开别组链接        —— 已由 F12 `JoinByGroupLink` 落地（I-20），本迁移不重复建表。
--   ② 名单外访客申请加入   —— 本迁移新增 `join_applications`。
--   ③ 掉线 / 换设备重开链接 —— 复用 F16 的 `live_sessions`，本迁移只补 `device_id` 一列。
--
-- ## `join_applications` 为什么与 `project_participants` 是两张表，不是给后者加一个状态列
--
-- I-21：「批准前该访客不进入任何组、读不到任何内容」，断言形式是**返回 0 行**而不是
-- 「界面上没渲染」。如果把「待批」做成 `project_participants` 的一个状态值，
-- 那么「查名单」这条最常见的读路径就必须记住去过滤掉待批状态——漏过滤一次，
-- I-21 就在生产环境悄悄失守，而不会有任何测试失败（名单表恰好多了一行,一切如常）。
-- 拆成两张表，「批准前不存在于名单」是**表本身的形状**保证的，不依赖每个读路径记得过滤。
--
-- ## 幂等落点：`(project_id, phone)` 待批状态下唯一
--
-- usecases.md 逐字「重复申请返回既有单据（幂等）」。与 `guest_identities_participant_uniq`
-- 同一条纪律：部分唯一索引 + `ON CONFLICT`，而不是「先查后插」——两路并发的重复申请
-- 都查到「还没有」，两路都插入成功，同一手机号产生两条待批单据，引导师审批面上看到
-- 一个人排两次队。索引只在 `status = 'pending'` 时生效：审批完之后同一手机号可以再申请
-- 一次（例如上次被拒绝后引导师后来把他补进名单又移出，此处不阻断二次申请）。
--
-- ## 批准写入名单为什么在 `review-join-application.ts` 里手写 SQL，不复用
--   `ParticipantRosterRepository.upsert`
--
-- 那个方法是给「引导师批量邀请」用的，输入形状是全新收件人列表，输出带 created/deduped/invalid
-- 三段——为部分成功设计的。这里只有一个人、一次性从 pending 转 approved，且要与
-- `join_applications` 那一行的状态更新在**同一个事务**里（部分成功禁止，同 F12
-- `joinByGroupLink` 的「建身份 + 授项目角色」）。复用那个方法就得在它之外再包一层事务，
-- 而两个仓储各自 `withTenant` 打开的是两个连接，不是同一个事务。
--
-- Replayable：IF NOT EXISTS / ADD COLUMN IF NOT EXISTS，`migrate:check` 会忽略版本表重放每个文件。

CREATE TABLE IF NOT EXISTS join_applications (
  id         text PRIMARY KEY,
  org_id     text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  -- 申请所依附的那条链接——批准时沿用它的 project_role（同 O-06：令牌决定授予什么角色）。
  link_id    text NOT NULL REFERENCES invite_links (id) ON DELETE CASCADE,

  -- ⚠ 手机号存储形态同 project_participants：domain.md [待定 A] 未裁决，这里是现状不是裁决。
  phone text NOT NULL,

  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  -- 批准时引导师指定的组号；拒绝/待批时为 NULL。
  group_id    text REFERENCES groups (id) ON DELETE SET NULL,
  reviewed_by text,
  reviewed_at timestamptz,

  -- 批准落地后的名单条目 id——供「批准前不存在于名单」的反证查询定位批准后的那一行，
  -- 不是授予依据（授予恒读 project_participants 那一行,同 invite_link_tokens.org_id_hint 的命名纪律）。
  participant_id text REFERENCES project_participants (id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT join_applications_review_is_atomic
    CHECK ((status = 'pending') = (reviewed_by IS NULL AND reviewed_at IS NULL)),
  CONSTRAINT join_applications_approved_has_group
    CHECK (status <> 'approved' OR group_id IS NOT NULL)
);

-- 见文件头：同一手机号在同一项目内至多一条待批单据。
CREATE UNIQUE INDEX IF NOT EXISTS join_applications_pending_uniq
  ON join_applications (project_id, phone) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS join_applications_project_idx
  ON join_applications (org_id, project_id) WHERE status = 'pending';

DO $$
BEGIN
  ALTER TABLE join_applications ENABLE ROW LEVEL SECURITY;
  ALTER TABLE join_applications FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS join_applications_tenant ON join_applications;
  CREATE POLICY join_applications_tenant ON join_applications
    USING (org_id = current_setting('app.current_org', true))
    WITH CHECK (org_id = current_setting('app.current_org', true));
  GRANT SELECT, INSERT, UPDATE ON join_applications TO app_rw;
END
$$;

SELECT kernel_apply_org_freeze_policies();

-- ③ 掉线/换设备重开链接（I-23）：恢复凭据是「已验证手机号 + 名单条目」，**不依赖 Cookie**。
-- 换设备接管后旧设备会话立即失效——`device_id` 是这条判定唯一需要新增的一列：
-- 同一 `live_sessions` 行（同 project_id + participant_id，ended_at IS NULL）上
-- 记录「当前是哪台设备在用这个会话」，重开时若换了 device_id 即为接管（旧设备读到失效提示）。
-- NULL = 该会话尚未记录过设备（F16 签到路径签入时不强制携带 deviceId）。
ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS device_id text;
