-- 0018 F10: 组织成员邀请与激活（UC-1.6 / contracts/org-admin `InviteOrgMember` `ActivateOrgMember`）
--
-- 三张表，**分表的理由是租户键，不是整洁**：
--
--   org_invites                邀请事实。带 org_id ⇒ 租户表 ⇒ FORCE RLS。
--   org_invite_tokens          令牌。**不带租户键**——激活请求是匿名的，
--                              点链接的人还没有会话、也还不是任何组织的成员，
--                              所以查这一行时 `app.current_org` 只能是未设置的。
--                              带 org_id 的 RLS 策略会让**恰好要被找到的那一行**读不到，
--                              即功能根本跑不起来（0011 对 invite_codes 的同一段推理）。
--   org_invite_tamper_attempts 篡改留痕。带 org_id ⇒ 租户表。
--
-- ## 为什么令牌表上那一列叫 `org_id_hint` 而不是 `org_id`
--
-- 它是**打开哪个租户上下文**的线索，不是**授予什么**的依据。名字写成 `org_id`
-- 会让下一个人顺手拿它去 INSERT org_memberships——那正是 I-2（链接身份以服务端为准）
-- 要挡的那一步，而且挡不住：值是对的，测试全绿，直到有人把它接到请求参数上。
-- 授予恒读 `org_invites` 那一行（见 pg-org-invite-repository.ts）。
-- 顺带：`lint-permission-paths` 按 `^\s*org_id\b` 认租户表，改名也让这张表如实地
-- 不被认成租户表——这是**同一件事实的两个后果**，不是绕过门控。
--
-- ## 幂等与并发（I-5）
--
-- `org_invites_live_uniq` 是**部分唯一索引**：同一 (org, email) 同时只允许一条未失效邀请。
-- 两名管理员同时邀同一邮箱时，恰好一条 INSERT 成功，另一条拿 23505 →`INVITE_DUPLICATE`。
-- 用索引而不是「先查后插」：后者两路都能查到「没有」，然后两路都插入成功，
-- 两条链接同时可用，而两次授予的角色可能不同——没有任何报错。
--
-- Replayable：全部 IF NOT EXISTS / DROP-then-CREATE，`migrate:check` 会忽略版本表重放每个文件。

/* ─────────────────────────── org_invites ─────────────────────────── */

CREATE TABLE IF NOT EXISTS org_invites (
  id       text PRIMARY KEY,
  org_id   text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- 小写规范化后比较（与 credentials.email 同一口径，domain/auth/registration.normalizeEmail）。
  -- CHECK 而不是「应用层记得 lower()」：两处口径不一致时的症状不是报错，
  -- 是 `org_invites_live_uniq` 拦不住 `Bob@x.com` 与 `bob@x.com` 的两条并存邀请。
  email    text NOT NULL CHECK (email = lower(email)),
  -- ⚠ 四值与 org_memberships.org_role 同一集合（0003）。这里不是「第二份枚举」——
  -- 它是**授予值的暂存**，激活时逐字搬进 org_memberships，两处取值集合必须相同；
  -- 不同的那一天，邀请能存下一个成员表存不下的角色，失败发生在激活的最后一步。
  org_role text NOT NULL CHECK (org_role IN ('admin', 'lead', 'consultant', 'compliance')),
  -- O-12：一人一组织一团队。可为 NULL（组织尚无团队时的邀请）。
  team_id  text REFERENCES teams (id) ON DELETE SET NULL,
  status   text NOT NULL CHECK (status IN ('pending', 'awaiting-review', 'revoked', 'used', 'send-failed')),
  invited_by      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- NULL = 尚未发出（awaiting-review）或发送失败（契约 OrgInvite.sentAt 逐字）
  sent_at         timestamptz,
  used_at         timestamptz,
  used_by_user_id text,

  -- 「谁核销的」与「什么时候核销的」一起动或都不动。少一半的行不是更严格的状态，
  -- 是审计问「这条邀请是谁用掉的」时没有答案的状态。
  CONSTRAINT org_invites_used_is_atomic CHECK ((used_by_user_id IS NULL) = (used_at IS NULL)),
  CONSTRAINT org_invites_used_implies_user CHECK (status <> 'used' OR used_by_user_id IS NOT NULL),
  -- I-3 / O-28 ⑥：待复核的管理员邀请**不签发也不发送**。
  -- 写成约束而不是注释：`awaiting-review` 且 sent_at 非空的行，
  -- 意味着某条路径在复核前就把链接发了出去，而那一步没有任何别的东西会报错。
  CONSTRAINT org_invites_awaiting_review_not_sent CHECK (status <> 'awaiting-review' OR sent_at IS NULL)
);

-- I-5：同一 (org, email) 同时最多一条未失效邀请。`used` / `revoked` 不占位，
-- 所以一个人离开后可以被重新邀请。
CREATE UNIQUE INDEX IF NOT EXISTS org_invites_live_uniq
  ON org_invites (org_id, email)
  WHERE status IN ('pending', 'awaiting-review', 'send-failed');

/* ──────────────────────── org_invite_tokens ──────────────────────── */

CREATE TABLE IF NOT EXISTS org_invite_tokens (
  -- 256 位 CSPRNG（domain/auth/org-invite.ts）。主键 ⇒ 撞了是约束冲突不是覆盖。
  token       text PRIMARY KEY,
  invite_id   text NOT NULL REFERENCES org_invites (id) ON DELETE CASCADE,
  -- 见文件头：打开哪个租户上下文的线索，**不是授予依据**。
  org_id_hint text NOT NULL,
  -- 7 天（O-28 ④）。列而不是 `issued_at + interval`：重发签发的新令牌可以有不同窗口，
  -- 且策略延长后已过期的令牌保持过期。
  expires_at  timestamptz NOT NULL,
  -- 一次性。非空 = 已核销。标记而不是删除，所以「这条链接已经用过了」仍然可回答。
  consumed_at timestamptz,
  issued_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS org_invite_tokens_invite_idx ON org_invite_tokens (invite_id);
-- I-6：重发 = 签发新令牌 + 作废旧令牌。这条部分索引是「一条邀请同时最多一枚可用令牌」，
-- 否则重发之后旧链接仍然能激活，而 I-6 的整个意义就是它不能。
CREATE UNIQUE INDEX IF NOT EXISTS org_invite_tokens_live_uniq
  ON org_invite_tokens (invite_id) WHERE consumed_at IS NULL;

COMMENT ON TABLE org_invite_tokens IS
  'kernel-no-tenant-data: 组织邀请链接的令牌。激活请求是匿名的——点链接的人还没有会话、'
  '也还不是任何组织的成员——所以这张表必须在没有 app.current_org 的情况下可查；'
  '带租户键的 RLS 策略会让恰好要被找到的那一行读不到，功能无法工作（同 invite_codes）。'
  'WHAT app_rw CAN ACTUALLY SEE HERE，如实写而不是一句「没有租户数据」：未核销的令牌值、'
  '它们指向的 invite_id、以及 org_id_hint（即「存在某个组织 id」这一事实）。'
  '它不含邮箱、不含角色、不含团队、不含任何组织内容——授予值全在 org_invites（租户表，FORCE RLS）。'
  '因此一个被攻陷的 app_rw 能拿到一枚令牌，但拿不到「这枚令牌会授予什么」，'
  '而激活写入的角色与团队仍恒取自 org_invites（不变量 I-2）。';

/* ───────────────────── org_invite_tamper_attempts ───────────────────── */

-- usecases.md `ActivateOrgMember`：「篡改尝试写安全审计」。
--
-- ⚠ 这张表存在的前提是**服务端确实收到了链接里的声明值**。契约的 `in` 里没有
-- orgId/orgRole/teamId（「字段不存在是契约事实」），所以声明值只能从**查询串**过来，
-- 由激活落地页把链接原样带上——它对授予**没有任何影响**，唯一用途是留在这里。
-- 不收就没得审计：那样「篡改无效」只能证明到「我们没读」，证明不到「有人试过」。
CREATE TABLE IF NOT EXISTS org_invite_tamper_attempts (
  id        bigserial PRIMARY KEY,
  org_id    text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  invite_id text NOT NULL,
  -- 客户端声明的三值。可为 NULL（链接里没带这一项）。
  claimed_org_id   text,
  claimed_org_role text,
  claimed_team_id  text,
  -- 服务端记录值，即**实际授予的那一份**。两边一起存，审计才不用再去 join 一次
  -- 才知道当时到底差了多少。
  actual_org_role  text NOT NULL,
  actual_team_id   text,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS org_invite_tamper_attempts_invite_idx
  ON org_invite_tamper_attempts (org_id, invite_id);

/* ─────────────────────────── RLS ─────────────────────────── */

-- 与 0003 同一形状：租户表一律 ENABLE + FORCE + 单条 org_id 策略。
-- current_setting(..., true) 未设置时为 NULL ⇒ 未设租户的查询读到零行（fail-closed）。
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['org_invites', 'org_invite_tamper_attempts']
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

GRANT USAGE, SELECT ON SEQUENCE org_invite_tamper_attempts_id_seq TO app_rw;

-- F22 的停用冻结（三条 RESTRICTIVE 策略：INSERT / UPDATE / DELETE）。
--
-- ⚠ 必须显式调用一次，**不能**指望 0014 自己扫到这两张表：0014 的编号在前，
--   首次跑迁移时它们还不存在。漏掉这一行的表现极具欺骗性——新库上这两张表
--   **没有**冻结（组织已停用却还能往里发新邀请），而 F22 的断言仍然全绿，
--   因为它们测的是当时已存在的那些表。F80 的 0020 记录过同一个坑。
-- ⚠ 规则本身只声明在 0014；在这里抄一遍三条 CREATE POLICY 才是第二份事实源。
-- ⚠ 与上面的 GRANT 是两件事：GRANT 管角色权限，策略管行级准入。
--   `org_invite_tokens` 不在这个函数的扫描范围内（它没有指向租户根的 org_id 外键），
--   这是对的：一枚令牌的可用性由 `org_invites` 那一行决定，而那一行是冻结的。
SELECT kernel_apply_org_freeze_policies();

-- ⚠ 令牌表没有 DELETE：核销是打标记（consumed_at），删掉一枚用过的令牌等于
-- 让「这条链接已经用过了」变成「这条链接从来不存在」，而 I-1 的幂等重放
-- 恰好要区分不了这两者的**响应**、却要区分得了这两者的**审计**。
GRANT SELECT, INSERT, UPDATE ON org_invite_tokens TO app_rw;
