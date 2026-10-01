-- #4787 通用项目邀请（后端）：项目负责人用「邮箱邀请」或「邀请链接」把人拉进通用项目。
--
-- ## 两张表
--
--   project_invitations        租户表（带 org_id）：邀请本体。邮箱邀请一次性、绑定邮箱；链接邀请
--                              可重复使用到过期 / 撤销。ENABLE + FORCE + 租户策略 + F22 冻结策略。
--   project_invitation_tokens  无租户键的令牌索引（token_hash → invitation_id + org_id_hint）。
--
-- ## 为什么需要第二张无租户键的表
--
-- 受邀人点开链接时**没有会话**：新用户还没有账号、老用户可能已登出。带 org_id 的租户策略会让
-- 「恰好要被找到的那一行」读不到。做法与 `invite_link_tokens`（0025）/ `org_invite_link_tokens`
-- 逐字同型：令牌索引表脱离租户，`org_id_hint` 只回答「去哪个租户上下文里找」，不回答「授予什么」——
-- 授予值（role / project_id / kind / email）恒来自 `project_invitations` 那一行（FORCE RLS）。
--
-- ## 令牌只存 SHA-256
--
-- 明文令牌不落库：`project_invitations.token_hash` 与索引表的主键都是哈希。代价是「链接邀请」创建后
-- 无法再读出原链接——要拿新链接只能重置（旧的被取代，见下面的部分唯一索引）。邮件邀请的「重发」
-- 同理：重发 = 轮换令牌（旧令牌行从索引表删掉，旧邮件里的链接当场失效）。
--
-- ## 部分唯一索引
--
--   · 同一项目同一邮箱至多一条 pending 邮箱邀请（重复邀请走重发，不多一行）；
--   · 同一项目至多一条 pending 链接邀请（重置 = 旧的置 revoked、再插新的）。
--   ⚠ 「已过期」不在索引谓词里（now() 不是 IMMUTABLE）。过期由写路径先把
--     `status='pending' AND expires_at <= now()` 的行翻成 `expired` 再插入，读路径按
--     expires_at 派生（domain `deriveInvitationStatus`），不靠定时任务。
--
-- ## 可重放（migrate:check）
-- 全部 IF NOT EXISTS / DROP-then-CREATE。

/* ─────────────────────────── project_invitations ─────────────────────────── */

CREATE TABLE IF NOT EXISTS project_invitations (
  id         text PRIMARY KEY,
  org_id     text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id text NOT NULL,

  kind  text NOT NULL CHECK (kind IN ('email', 'link')),
  -- 仅 kind='email'；恒小写（与 credentials.email 同一口径）。
  email text,

  -- SHA-256(hex)。明文令牌永不落库。
  token_hash text NOT NULL,

  -- 目前只有一档。写成 CHECK 而不是常量：将来加档是一次显式迁移，不是某条写路径的默默扩张。
  role   text NOT NULL DEFAULT 'collaborator' CHECK (role IN ('collaborator')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),

  expires_at timestamptz NOT NULL,
  invited_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- 发信账本。creation 与 resend 都是「先占位再发」：先把 send_attempts +1 / last_sent_at 落库，
  -- 再调邮件；发送失败把 last_send_error 写成枚举码（不存异常文本）。
  last_sent_at    timestamptz,
  send_attempts   integer NOT NULL DEFAULT 0 CHECK (send_attempts >= 0),
  last_send_error text CHECK (last_send_error IN ('MAIL_NOT_CONFIGURED', 'MAIL_SEND_FAILED', 'MAIL_RECIPIENT_REJECTED')),

  accepted_by text,
  accepted_at timestamptz,

  -- 项目必须是存在的通用项目，且 (project_id, org_id) 钉死「这一行属于容器所在的组织」。
  FOREIGN KEY (project_id, org_id) REFERENCES general_projects (id, org_id) ON DELETE CASCADE,

  CONSTRAINT project_invitations_email_iff_kind
    CHECK ((kind = 'email') = (email IS NOT NULL)),
  CONSTRAINT project_invitations_email_lowercase
    CHECK (email IS NULL OR email = lower(email)),
  -- 链接邀请可重复使用，没有「已接受」这一终态。
  CONSTRAINT project_invitations_link_never_accepted
    CHECK (kind = 'email' OR status <> 'accepted'),
  CONSTRAINT project_invitations_accept_is_atomic
    CHECK ((accepted_by IS NULL) = (accepted_at IS NULL)),
  CONSTRAINT project_invitations_accepted_iff_status
    CHECK ((status = 'accepted') = (accepted_by IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS project_invitations_token_hash_uniq
  ON project_invitations (token_hash);

CREATE UNIQUE INDEX IF NOT EXISTS project_invitations_live_email_uniq
  ON project_invitations (project_id, email)
  WHERE kind = 'email' AND status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS project_invitations_live_link_uniq
  ON project_invitations (project_id)
  WHERE kind = 'link' AND status = 'pending';

-- 列表按项目、每日上限按「项目 + 创建时间」数。
CREATE INDEX IF NOT EXISTS project_invitations_project_idx
  ON project_invitations (org_id, project_id, created_at DESC);

/* ──────────────────── project_invitation_tokens ──────────────────── */

-- 无租户键。见文件头：受邀人的请求可能没有会话。
-- ⚠ `org_id_hint` 是**打开哪个租户上下文**的线索，不是**授予什么**的依据。
CREATE TABLE IF NOT EXISTS project_invitation_tokens (
  token_hash    text PRIMARY KEY,
  invitation_id text NOT NULL REFERENCES project_invitations (id) ON DELETE CASCADE,
  org_id_hint   text NOT NULL
);

CREATE INDEX IF NOT EXISTS project_invitation_tokens_invitation_idx
  ON project_invitation_tokens (invitation_id);

COMMENT ON TABLE project_invitation_tokens IS
  'kernel-no-tenant-data: 通用项目邀请的令牌索引。受邀人点开链接时可能没有会话（新用户没有账号、'
  '老用户已登出），所以这张表必须在没有 app.current_org 的情况下可查。'
  'WHAT app_rw CAN ACTUALLY SEE HERE：令牌的 SHA-256、它指向的 invitation_id、以及 org_id_hint'
  '（即「存在某个组织 id」这一事实）。明文令牌不在库里；它不含项目名、不含邮箱、不含角色、'
  '不含有效期——这些全在 project_invitations（租户表，FORCE RLS）。因此一个被攻陷的 app_rw 拿不到'
  '「这枚令牌会授予什么」，授予值恒取自 project_invitations 那一行。';

/* ─────────────────────────── RLS ─────────────────────────── */

ALTER TABLE project_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_invitations FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_invitations_tenant ON project_invitations;
CREATE POLICY project_invitations_tenant ON project_invitations
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON project_invitations FROM app_rw;
GRANT SELECT, INSERT, UPDATE ON project_invitations TO app_rw;

-- 令牌索引表要 DELETE：邮件邀请重发 / 链接重置会轮换令牌，旧哈希必须从索引里拿掉，
-- 旧链接才会与「从来不存在的令牌」表现一致（同一个统一的「邀请无效」结果）。
REVOKE ALL ON project_invitation_tokens FROM app_rw;
GRANT SELECT, INSERT, DELETE ON project_invitation_tokens TO app_rw;

-- F22 组织停用冻结（三条 RESTRICTIVE 策略）。必须显式调用：本文件的编号在 0014 之后，
-- 0014 扫不到这张新表（0025 / 0020 / 0022 各记录过同一个坑）。规则只声明在 0014。
SELECT kernel_apply_org_freeze_policies();

COMMENT ON TABLE project_invitations IS
  '#4787: 通用项目邀请。邮箱邀请一次性、绑定邮箱；链接邀请可重复使用到过期 / 撤销。'
  '令牌只存 SHA-256；受邀人匿名入口经 project_invitation_tokens 定位租户。';
