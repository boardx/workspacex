-- 0025 F15: 项目邀请链接与参与者名单（UC-1.3 / contracts/org-admin `IssueInviteLink`
--            `UpsertParticipantRoster` `BroadcastInvites` `RevokeInviteLink`）
--
-- 两张表，**都带 org_id ⇒ 都是租户表 ⇒ ENABLE + FORCE + 租户策略 + F22 三条 RESTRICTIVE**。
--
--   invite_links          主链接 / 分组链接 / 邀请码。撤销、过期、核销、被取代四种终局。
--   project_participants  名单条目。「9 / 12 已确认」的分母与分子都出自这张表。
--
-- ## 为什么这两张表**不**像 org_invite_tokens 那样脱离租户
--
-- 0022 把令牌表做成无租户键的，理由是「激活请求是匿名的，点链接的人还不是任何组织的成员，
-- 带 org_id 的策略会让恰好要被找到的那一行读不到」。项目进场链接**同样是匿名点开的**，
-- 但处置不同：这里的 `token` 与授予值（project_id / group_id / project_role）在**同一行**，
-- 拆表就得把授予值也搬出租户或者跨两张表读一次——前者是把最该受 RLS 保护的东西搬出 RLS，
-- 后者是 0022 已经付过的复杂度。⇒ 本表留在租户内，核销路径由仓储在事务里
-- `set_config('app.current_org', <org_id_hint>, true)` 后再读（同 pg-org-invite-repository），
-- 而那个 hint 来自**令牌查找**这一步，见下。
--
-- ⚠ 于是需要一条能在**无租户上下文**下按 token 定位 org 的途径。做法是
--   `invite_link_tokens`（第三张表，无租户键，只有 token → link_id + org_id_hint），
--   与 0022 逐字同型、同理由——包括「org_id_hint 不是授予依据」这条命名纪律。
--
-- ## 幂等（契约 `IssueInviteLink` 逐字）
--
-- 「同 (projectId, kind, groupId, identity, validity) 返回**同一条**有效链接，不每次新签一条
--   （否则「单条撤销」的语义会被稀释成撤销其中一条）」。
-- ⇒ `invite_links_live_slot_uniq` 是**部分唯一索引**：一个槽位同时最多一条**在世**链接。
--   在世 = 未撤销 ∧ 未核销 ∧ 未被取代。
--
-- ⚠ 「已过期」不在索引谓词里，因为 `now()` 不是 IMMUTABLE，写不进部分索引。
--   过期链接由签发路径显式 `superseded_at = now()` 让位（见 pg-invite-link-repository）。
--   `superseded_at` 与 `revoked_at` 是**两件事**：撤销是引导师做过的动作、要出现在
--   `revokedLinkIds` 里；让位是签发顺手做的清理、**不得**出现在那个数组里。
--   合成一列的表现是「重新签发一条链接」在审计里长得像「引导师撤销了一条链接」。
--
-- ## 身份四选只存一列
--
-- `project_role` 一列，**不存 identity_choice**：四选到四值是单射
-- （coFacilitator→facilitator，见 domain/auth/invite-link.ts），选项由角色反推。
-- 两列都存就是同一事实的第二份副本，漂移方向是「改了角色没改选项」，
-- 界面显示「组员」而实际授予引导师。
--
-- ## [待定 A] 手机号存储形态未裁决
--
-- domain.md `[待定 A]`：加密可逆 vs 只存哈希 + 掩码，**加密密钥策略必须等合规负责人**。
-- ⇒ 本迁移**不发明密钥方案**：`contact` 按现状明文存，`masked` 另存展示值。
--   等 [待定 A] 落定后，改的是这一列的形态与一个回填迁移，**不是**整张表的结构。
--   把它写在这里而不是让下一个人从明文列推断「已经裁过了」。
--
-- Replayable：全部 IF NOT EXISTS / DROP-then-CREATE，`migrate:check` 会忽略版本表重放每个文件。

/* ─────────────────────────── invite_links ─────────────────────────── */

CREATE TABLE IF NOT EXISTS invite_links (
  id         text PRIMARY KEY,
  org_id     text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,

  kind     text NOT NULL CHECK (kind IN ('main', 'group')),
  group_id text REFERENCES groups (id) ON DELETE CASCADE,

  -- ⚠ 四值与 project_memberships.project_role 同一集合（0003）。这里是**授予值的暂存**，
  -- 进场时逐字搬过去；两处取值集合必须相同，不同的那一天，链接能存一个成员表存不下的角色。
  project_role text NOT NULL CHECK (project_role IN ('facilitator', 'groupLead', 'member', 'observer')),

  -- 有效期三档（契约 InviteLinkValidity）。⚠ 时长**不在 SQL 里**：
  -- 没有 `DEFAULT now() + interval '24 hours'`。一旦有，它就是第二份数值声明点，
  -- 而漂移方向是「有人改了 TS 侧，库里的默认值纹丝不动」。
  -- `expires_at` 由 application 算好再写库（同 organizations.retention_until 的处置）。
  validity   text NOT NULL CHECK (validity IN ('24h', '7d', 'once')),
  expires_at timestamptz,

  -- I-10：令牌恒非空。**列级 NOT NULL**，因为「没有令牌的链接」不是一条弱一点的链接，
  -- 是一个公开入口。
  token       text NOT NULL,
  -- 同一授权的另一载体（原型的 KCK-8F21-EU24）。null = 该条不配码（分组链接）。
  invite_code text,

  -- I-11 的落点：一次性链接的**使用者记录**。谁用的、什么时候用的，一起动或都不动。
  used_by text,
  used_at timestamptz,

  revoked_at    timestamptz,
  -- 见文件头：签发让位，**不是**撤销。
  superseded_at timestamptz,

  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- 分组链接必带组号，主链接必不带（契约 InviteLinkKind 的两句注释）。
  CONSTRAINT invite_links_group_iff_kind CHECK ((kind = 'group') = (group_id IS NOT NULL)),
  -- 「谁用的」与「什么时候用的」少一半，就是审计问「这条链接是谁用掉的」时没有答案的状态。
  CONSTRAINT invite_links_used_is_atomic CHECK ((used_by IS NULL) = (used_at IS NULL)),
  -- `once` 之外的档不按时间失效就没有 expires_at；`once` 恒无 expires_at（它按次失效）。
  -- 写成约束而不是靠 application 记得：一条 validity='once' 却带 expires_at 的行，
  -- 意味着某条路径把两种失效条件混起来了，而那条路径不会报错。
  CONSTRAINT invite_links_once_has_no_expiry CHECK (validity <> 'once' OR expires_at IS NULL),
  CONSTRAINT invite_links_timed_has_expiry   CHECK (validity =  'once' OR expires_at IS NOT NULL)
);

-- 令牌全局唯一。撞了是约束冲突不是覆盖。
CREATE UNIQUE INDEX IF NOT EXISTS invite_links_token_uniq ON invite_links (token);
-- 邀请码在项目内唯一（现场同时挂两条一样的码，念出来的那个人不知道进哪一场）。
CREATE UNIQUE INDEX IF NOT EXISTS invite_links_code_uniq
  ON invite_links (project_id, invite_code) WHERE invite_code IS NOT NULL;

-- 幂等槽位（见文件头）。COALESCE 而不是 NULLS NOT DISTINCT：后者要 PG15+，
-- 而这条索引的语义（主链接的 group_id 恒为 NULL，两条主链接必须撞上）不该依赖版本。
CREATE UNIQUE INDEX IF NOT EXISTS invite_links_live_slot_uniq
  ON invite_links (project_id, kind, COALESCE(group_id, ''), project_role, validity)
  WHERE revoked_at IS NULL AND used_at IS NULL AND superseded_at IS NULL;

CREATE INDEX IF NOT EXISTS invite_links_project_idx ON invite_links (org_id, project_id);
-- 「记录使用者」要能**按使用者反查**（I-11 逐字：`usedBy` 可按使用者检索）。
CREATE INDEX IF NOT EXISTS invite_links_used_by_idx
  ON invite_links (org_id, used_by) WHERE used_by IS NOT NULL;

/* ─────────────────────── invite_link_tokens ─────────────────────── */

-- 无租户键。见文件头：进场请求是匿名的，查这一行时 app.current_org 只能是未设置的。
-- ⚠ `org_id_hint` 是**打开哪个租户上下文**的线索，不是**授予什么**的依据。
--   授予恒读 invite_links 那一行（租户表，FORCE RLS）。命名纪律与 0022 逐字相同，
--   连同 `lint-permission-paths` 按 `^\s*org_id\b` 认租户表这一条后果。
CREATE TABLE IF NOT EXISTS invite_link_tokens (
  token       text PRIMARY KEY,
  link_id     text NOT NULL REFERENCES invite_links (id) ON DELETE CASCADE,
  org_id_hint text NOT NULL
);

CREATE INDEX IF NOT EXISTS invite_link_tokens_link_idx ON invite_link_tokens (link_id);

COMMENT ON TABLE invite_link_tokens IS
  'kernel-no-tenant-data: 项目进场链接的令牌索引。进场请求是匿名的——扫码的人还没有会话、'
  '也还不是任何组织的成员——所以这张表必须在没有 app.current_org 的情况下可查。'
  'WHAT app_rw CAN ACTUALLY SEE HERE，如实写而不是一句「没有租户数据」：令牌值、'
  '它指向的 link_id、以及 org_id_hint（即「存在某个组织 id」这一事实）。'
  '它不含项目名、不含组号、不含角色、不含有效期、不含使用者——'
  '这些全在 invite_links（租户表，FORCE RLS）。因此一个被攻陷的 app_rw 能拿到一枚令牌，'
  '但拿不到「这枚令牌会授予什么」，而进场写入的角色与组号仍恒取自 invite_links。';

/* ──────────────────── project_participants ──────────────────── */

CREATE TABLE IF NOT EXISTS project_participants (
  id         text PRIMARY KEY,
  org_id     text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,

  -- 邀请载体二选一（domain.md：email / phone 二选一）。一列 + 一个判别列，
  -- 而不是两个可空列：两个可空列要一条 num_nonnulls CHECK 才等价，
  -- 而去重索引就得 COALESCE 两次——同一件事写两遍。
  contact_kind text NOT NULL CHECK (contact_kind IN ('email', 'phone')),
  -- 规范化后的原值。email 恒小写（与 credentials.email / org_invites.email 同一口径）。
  -- ⚠ 手机号的存储形态是 domain.md [待定 A]，见文件头：这里是**现状**不是裁决。
  contact      text NOT NULL CHECK (contact_kind <> 'email' OR contact = lower(contact)),
  -- 界面恒展示这个（`138 •••• 2049`）。I-22：他人手机号不以完整形式出现在响应体里。
  masked       text NOT NULL,
  -- 展示层代称。生成规则是 [待定 D] ⇒ 可空，**不发明一个默认代称**。
  display_alias text,

  group_id     text REFERENCES groups (id) ON DELETE SET NULL,
  project_role text NOT NULL CHECK (project_role IN ('facilitator', 'groupLead', 'member', 'observer')),

  -- 「9 / 12 已确认」的分子。⚠ 不是第三个状态：「待接受 · 已发送 N 天」是
  -- confirm_state='invited' + last_sent_at 的**投影**（domain.md 逐字）。
  confirm_state text NOT NULL DEFAULT 'invited' CHECK (confirm_state IN ('invited', 'confirmed')),
  confirmed_at  timestamptz,
  -- null = 名单里有这个人但一次都还没发出去。[群发邀请] / [重发] 写这一列。
  last_sent_at  timestamptz,

  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT project_participants_confirm_is_atomic
    CHECK ((confirm_state = 'confirmed') = (confirmed_at IS NOT NULL))
);

-- A2 去重：同一项目同一联系方式至多一条名单条目。
-- 用索引而不是「先查后插」：后者两路都查到「没有」，两路都插入成功，
-- 同一个人在名单里两条、计数分母多 1，而没有任何报错。
CREATE UNIQUE INDEX IF NOT EXISTS project_participants_contact_uniq
  ON project_participants (project_id, contact);

CREATE INDEX IF NOT EXISTS project_participants_project_idx
  ON project_participants (org_id, project_id);

/* ─────────────────────────── RLS ─────────────────────────── */

-- 与 0003 / 0022 同一形状：租户表一律 ENABLE + FORCE + 单条 org_id 策略。
-- current_setting(..., true) 未设置时为 NULL ⇒ 未设租户的查询读到零行（fail-closed）。
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['invite_links', 'project_participants']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (org_id = current_setting(''app.current_org'', true)) '
      'WITH CHECK (org_id = current_setting(''app.current_org'', true))',
      t || '_tenant', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO app_rw', t);
  END LOOP;
END
$$;

-- F22 的停用冻结（三条 RESTRICTIVE 策略：INSERT / UPDATE / DELETE）。
--
-- ⚠ 必须显式调用一次，**不能**指望 0014 自己扫到这两张表：0014 的编号在前，
--   首次跑迁移时它们还不存在。漏掉这一行的表现极具欺骗性——新库上这两张表
--   **没有**冻结（组织已停用却还能签发新的进场链接），而 F22 的断言仍然全绿。
--   0020 / 0022 各记录过同一个坑，这是第三次。
-- ⚠ 规则本身只声明在 0014；在这里抄一遍三条 CREATE POLICY 才是第二份事实源。
SELECT kernel_apply_org_freeze_policies();

-- 令牌索引表没有 DELETE：一条链接被撤销/核销后它的令牌行仍在，
-- 好让「这枚令牌属于哪条链接」在事后仍答得出来——删掉它，
-- 「已撤销」与「从来不存在」在服务端就变成同一件事，而 I-15 的单条撤销恰好要区分得开。
GRANT SELECT, INSERT ON invite_link_tokens TO app_rw;
