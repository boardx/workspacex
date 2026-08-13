-- shared-invite-links delta（人类 2026-08-13 三条拍板）：组织共享邀请链接。
-- contracts/org-admin `CreateOrgInviteLink` `ListOrgInviteLinks` `RevokeOrgInviteLink`
-- `ReviewOrgInviteLink` `ActivateViaOrgInviteLink`。
--
-- 两张表，分表的理由与 0022（org_invites / org_invite_tokens）逐字相同——租户键：
--
--   org_invite_links        链接事实（角色/有效期/上限/计数/复核状态）。带 org_id
--                           ⇒ 租户表 ⇒ FORCE RLS。
--   org_invite_link_tokens  令牌 hash → 链接的映射。**不带租户键**——激活请求是匿名的，
--                           点链接的人还没有会话、也还不是任何组织的成员，查这一行时
--                           `app.current_org` 只能是未设置的（0022 文件头的同一段推理）。
--
-- ## 与 org_invite_tokens 的一处刻意不同：存 hash 不存明文
--
-- 单人邀请 token 一次性、核销即死、7 天窗口；共享链接 token **多次使用、长期有效**——
-- 同样一次 DB 泄露，前者给攻击者的是一批一次性短命链接，后者给的是「任意多人加入
-- 组织」的长期凭据。所以这里落库的是 sha-256(token) 的十六进制，明文只在签发响应里
-- 出现一次（delta contract.md 的对照表）。查找按 hash 等值匹配，不需要明文。
--
-- ## pending-review 态令牌不存在（拍板③ / O-28⑥ 适用点扩展）
--
-- admin 级链接建链时**不写 token 行**，批准那一刻才签发——与 I-3「待复核不签发」
-- 同一落地形状：机械判据是 org_invite_link_tokens 里查无此 link_id，
-- 不是「签了但拦着」。org_invite_links_active_has_expiry 那条 CHECK 是它的近亲：
-- active 必有 expires_at（窗口从批准/建链起算，见列注释）。
--
-- Replayable：全部 IF NOT EXISTS / DO $$ 判存在，migrate:check 会重放每个文件。

/* ─────────────────────────── org_invite_links ─────────────────────────── */

CREATE TABLE IF NOT EXISTS org_invite_links (
  id        text PRIMARY KEY,
  org_id    text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- 授予值的暂存，与 org_invites.org_role 同一段理由：取值集合必须与 org_memberships
  -- 相同，激活时逐字搬进成员表。
  org_role  text NOT NULL CHECK (org_role IN ('admin', 'lead', 'consultant', 'compliance')),
  -- 契约 OrgInviteLinkExpiry 三档。存档位而不是毫秒数：expires_at 是它算出来的结果，
  -- 但 admin 级链接的窗口从批准起算，批准之前只有档位、没有截止时刻。
  expiry    text NOT NULL CHECK (expiry IN ('1d', '7d', '30d')),
  -- NULL ⟺ pending-review（窗口未起算）。active 必非空（下方 CHECK）。
  expires_at timestamptz,
  -- NULL = 无上限（拍板②默认）。
  max_uses  integer CHECK (max_uses IS NULL OR max_uses > 0),
  used_count integer NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  -- 存储态只有三值；expired / exhausted 是派生态（expires_at / used_count 现算），
  -- 落库就是同一事实两处声明，且「过期」没有写入时机。
  status    text NOT NULL CHECK (status IN ('pending-review', 'active', 'revoked')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- 双人复核落点（同 F11 给 org_invites 加的两列）。
  reviewed_by text,
  reviewed_at timestamptz,
  revoked_at  timestamptz,

  -- I-4：发起人不可自批。CHECK 与应用层各判一次（防线，不是重复权威）。
  CONSTRAINT org_invite_links_reviewer_not_creator
    CHECK (reviewed_by IS NULL OR reviewed_by <> created_by),
  -- 「谁批的」与「什么时候批的」一起动或都不动（org_invites_reviewed_is_atomic 同款）。
  CONSTRAINT org_invite_links_reviewed_is_atomic
    CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL)),
  -- active 必有截止时刻——「永不过期的共享链接」在本表连表达都表达不出来。
  CONSTRAINT org_invite_links_active_has_expiry
    CHECK (status <> 'active' OR expires_at IS NOT NULL),
  -- 作废时刻只在作废态存在。
  CONSTRAINT org_invite_links_revoked_atomic
    CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS org_invite_links_org_idx ON org_invite_links (org_id, created_at DESC);

/* ──────────────────────── org_invite_link_tokens ──────────────────────── */

CREATE TABLE IF NOT EXISTS org_invite_link_tokens (
  -- sha-256(token) 的十六进制。主键 ⇒ 撞了是约束冲突不是覆盖。
  token_hash  text PRIMARY KEY,
  link_id     text NOT NULL REFERENCES org_invite_links (id) ON DELETE CASCADE,
  -- 0022 的同一命名裁定：打开哪个租户上下文的线索，**不是授予依据**。
  org_id_hint text NOT NULL,
  issued_at   timestamptz NOT NULL DEFAULT now()
);

-- 一条链接同时最多一枚令牌（共享链接不重签：作废即建新链接，没有「重发」语义——
-- 重发单人邀请是因为收件人只有一个；共享链接的「换一条」就是再建一条）。
CREATE UNIQUE INDEX IF NOT EXISTS org_invite_link_tokens_link_uniq
  ON org_invite_link_tokens (link_id);

COMMENT ON TABLE org_invite_link_tokens IS
  'kernel-no-tenant-data: 组织共享邀请链接的令牌 hash。激活请求是匿名的——点链接的人'
  '还没有会话、也还不是任何组织的成员——所以这张表必须在没有 app.current_org 的情况下'
  '可查；带租户键的 RLS 策略会让恰好要被找到的那一行读不到（同 org_invite_tokens）。'
  'WHAT app_rw CAN ACTUALLY SEE HERE：令牌的 sha-256 hash（**不是明文**——与单人邀请的'
  'org_invite_tokens 不同，这里连被攻陷的 app_rw 也拿不到可用链接）、指向的 link_id、'
  '以及 org_id_hint（「存在某个组织 id」这一事实）。它不含角色、不含上限、不含任何'
  '组织内容——授予值全在 org_invite_links（租户表，FORCE RLS），激活写入的角色恒取自'
  '那一行（不变量 I-2 同款）。';

/* ─────────────────────────── RLS ─────────────────────────── */

-- 与 0003/0022 同一形状：租户表 ENABLE + FORCE + 单条 org_id 策略，fail-closed。
DO $$
BEGIN
  EXECUTE 'ALTER TABLE org_invite_links ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE org_invite_links FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS org_invite_links_tenant ON org_invite_links';
  EXECUTE 'CREATE POLICY org_invite_links_tenant ON org_invite_links '
       || 'USING (org_id = current_setting(''app.current_org'', true)) '
       || 'WITH CHECK (org_id = current_setting(''app.current_org'', true))';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE ON org_invite_links TO app_rw';
END
$$;

-- F22 停用冻结：0014 编号在前扫不到本表，必须显式补一次（0022 文件尾的同一段教训）。
SELECT kernel_apply_org_freeze_policies();

-- 令牌表没有 DELETE：作废走 org_invite_links.status（激活路径要求 status='active'，
-- 状态一翻链接当场失效）；删 hash 行会让「这条链接存在过」不可回答。
GRANT SELECT, INSERT, UPDATE ON org_invite_link_tokens TO app_rw;
