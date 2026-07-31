-- 0027 F32: 单个下载的短时效 · 一次性 · 绑定 principal 的授予，以及下载留痕。
--
-- 契约：`files.operations.issueDownloadUrl`（已签核）
--   「🔴 短时效 + 绑定 principal + 一次性，不得签发可转发的长期公开链接（N-24）」
--   「下载动作写 provenance_events —— 它是 N-19『回执须如实说明已出域内容』的数据来源」
--
-- ## 一张表，`download_grants`
--
-- 带 org_id ⇒ 租户表 ⇒ ENABLE + FORCE + 租户策略 + F22 三条 RESTRICTIVE。
--
-- ⚠ 它**不**走 `invite_link_tokens` / `org_invite_tokens` 那条「无租户键的令牌索引表」的路。
--   那两张表脱离租户是因为**点链接的人还不是任何组织的成员**，查行时不可能有
--   `app.current_org`。下载不是这样：契约要求链接**绑定 principal**，兑付方必须是已登录的
--   那个人，会话里就带着 org。⇒ 令牌行留在租户内，多一层 RLS 白拿。
--   把它做成无租户表反而会削弱它：那样一枚泄露的令牌在**任何**租户上下文下都可查。
--
-- ## 🔴 为什么「已用过」这个条件必须长在 UPDATE 的 WHERE 里
--
-- 这张表的全部价值是「同一条链接第二次用必须失败」。写成
--
--     SELECT ... WHERE token_hash = $1;          -- 还没用过吧？
--     if (row.consumed_at !== null) throw;       -- 应用层判定
--     UPDATE ... SET consumed_at = now() WHERE token_hash = $1;
--
-- 在并发下**挡不住任何人**：两个请求都读到 `consumed_at IS NULL`、都通过前置判定、都更新
-- 成功、都拿到文件。没有异常、没有报错、没有日志——一枚一次性码被两个人用掉。
-- F15 的 agent 正是在邀请核销路径上查出这个缺陷。
--
-- ⇒ 兑付是**一条语句**，全部条件都在 WHERE：
--     UPDATE download_grants SET consumed_at = now()
--      WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now() AND ...
--  RETURNING ...
--   返回零行即拒绝。`consumed_at IS NULL` 之所以能起作用，靠的是 UPDATE 对同一行取行级锁：
--   第二个事务阻塞、待第一个提交后**重新求值** WHERE、发现已非 NULL、更新零行。
--
-- ⚠ 部分唯一索引 `download_grants_live_token_uniq` 是**第二道**，不是同一道：
--   它管「同一枚令牌不可能有两条在世行」，与「一条在世行只能被消费一次」是两件事。
--
-- ## provenance_events：ADR-101 的落库半边
--
-- 🔴 **这是对已签核跨束契约 `packages/contracts/src/provenance.ts` 的一次增值，需人类追认。**
--   出处与完整论证在 `docs/adr/ADR-101-provenance-event-type-missing-members.md`（Proposed）。
--   这里只记「为什么它落在 F32 的迁移里」以及「改了哪两条 CHECK」。
--
-- 一句话：本枚举由 identity + artifact **两束**合并而成，phase-01 有十个束要写审计事件，
-- 三个束各自撞上「已签核的 UC 要求写审计、枚举里没有可写的类型」——
-- `design-coherence.md` **XC-10** 早就记着它，逐字写着「`ProvenanceEventType` 扩四值（走 ADR）」。
-- F32 是第三个撞上的，而前两个各用了一种处理方式 ⇒ 一次补齐，不再留第四种。
--
--   ① `provenance_events.type`        + `downloaded`（F32 · files）
--                                      + `project-created` / `project-archived` /
--                                        `project-unarchived` / `agenda-segment-state-changed`
--                                        （代 F117 · project，名字照抄 project.ts P3 与 XC-10）
--                                      + `thread-created` / `thread-renamed` / `thread-deleted`
--                                        （代 F109 · chat，名字与「三个不合并」的理由见契约长注）
--   ② `provenance_events.target_kind` + `interview`（代 F80）+ `thread`（代 F109）
--
-- ⚠ ②**是另一个枚举**，容易被当成同一件事：F80 / F109 缺的不是事件类型，是 target 的种类。
--   没有它，「这一场访谈被谁探过」「这条线程发生过什么」都查不出来
--   （`queryProvenance` 只按 `(targetKind, targetId)` 过滤，`detail` 不可检索），
--   于是 F80 把 target 记成 `organization`、F109 记成 `project`，各自把 id 塞进 `detail`。
--
-- 🔴 **只补枚举补不完这个洞，ADR-101 第二节把它写在了明处：**
--   target 改成具体对象之后，「列出本项目下的某类审计」就没有可筛的列了 ——
--   `projectId` 只活在 `detail` 这个 `z.record` 里。四个 feature 会各自往 detail 塞一份
--   projectId 兜底，那是同一事实的第四、五、六处声明。**该条未裁**，本迁移不发明列。
--
-- ⚠ 两条 CHECK 与契约枚举的**双向相等**由
--   `apps/api/tests/files/provenance-enum-single-source.test.ts` 机械门控：
--   两个方向各一条断言（契约有而 CHECK 没有 / CHECK 有而契约没有），不是长度比较。
--   `admin-audit-access-visible-to-lead.test.ts` 对 `type` 那条也仍在。
--
-- Replayable：全部 IF NOT EXISTS / DROP-then-CREATE，`migrate:check` 忽略版本表重放每个文件。

/* ────────── provenance_events：ADR-101 补齐两条封闭枚举 ────────── */

-- DROP + ADD 而不是「若不存在则建」：0005 已经建过这两条约束，要**改**它们就必须先删。
-- 名字沿用 0005 自动生成的，于是重放到底是同一条约束而不是并存两条。
DO $$
BEGIN
  ALTER TABLE provenance_events DROP CONSTRAINT IF EXISTS provenance_events_type_check;
  ALTER TABLE provenance_events ADD CONSTRAINT provenance_events_type_check CHECK (type IN (
    'ingested', 'transformed', 'generated', 'human-edited', 'pinned', 'bound', 'unbound',
    'superseded', 'evidence-withdrawn',
    'capability-added', 'capability-updated', 'capability-disabled', 'role-changed',
    'team-changed', 'admin-project-access', 'local-export',
    -- ADR-101（Proposed，需人类追认）。见文件头。
    'downloaded',                      -- F32 · files：单个原件下载
    'project-created',                 -- 代 F117 · project（project.ts P3 / XC-10 逐字）
    'project-archived',
    'project-unarchived',
    'agenda-segment-state-changed',
    'thread-created',                  -- 代 F109 · chat（三个分开，理由见契约长注）
    'thread-renamed',
    'thread-deleted',
    'unauthorized-attempt'
  ));

  -- ⚠ 另一个枚举。F80 缺的不是事件类型，是 target 的种类——没有它，
  --   「这一场访谈被谁探过」查不出来。见文件头 ②。
  ALTER TABLE provenance_events DROP CONSTRAINT IF EXISTS provenance_events_target_kind_check;
  ALTER TABLE provenance_events ADD CONSTRAINT provenance_events_target_kind_check CHECK (
    target_kind IN (
      'artifact', 'artifact-version', 'capability', 'membership', 'project', 'organization',
      'interview',                     -- 代 F80 · interview（ADR-101）
      'thread'                         -- 代 F109 · chat（ADR-101）
    ));
END
$$;

/* ─────────────────────── download_grants ─────────────────────── */

CREATE TABLE IF NOT EXISTS download_grants (
  id     text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,

  -- 授予的对象。契约的 `issueDownloadUrl.in` 只给 versionId；artifact_id 一并存下来是因为
  -- 审计事件的 target 是 `artifact-version`，而「这条下载属于哪份材料」在删除影响面与
  -- 出域回执里都要按 artifact 聚合，跨表 JOIN 一张 append-only 审计表拿不到历史真相
  -- （版本行可能已随 artifact 级联删掉，而审计必须仍然答得出「谁下过什么」）。
  artifact_id text NOT NULL,
  version_id  text NOT NULL,
  -- 对象键在签发时定格。签发后 artifact_versions 那行若被改指向别处，本次授予仍只
  -- 兑付当初判定过的那份字节——授权与被授权物之间不留一层可移动的间接。
  object_key  text NOT NULL CHECK (length(object_key) > 0),

  -- 🔴 绑定 principal。链接转发给同事，同事兑付不了——这才是「不得可转发」。
  -- 只有短时效 + 一次性的话，转发出去的链接对**先点的人**照样有效。
  principal_user_id text NOT NULL,

  -- 回指 identity.authorize 的判定，使「为什么给你下」可回溯（契约 out.permissionDecisionId）。
  permission_decision_id text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('download', 'export')),

  -- ⚠ 只存哈希，不存原始令牌。一条下载授予是**对字节的持有者凭证**：库里存原文，
  -- 任何能读到这张表的人（一份备份、一次支持查询、一个泄露的转储）都能把尚未过期的
  -- 链接全部下走。与会话令牌同一处置。
  token_hash text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),

  -- ⚠ 时长**不在 SQL 里**：没有 `DEFAULT now() + interval '2 minutes'`。
  -- 一旦有，它就是第二份数值声明点，漂移方向恒为「有人改了 TS 侧，库里的默认值纹丝不动」。
  -- 唯一声明点是 domain/files/download-grant.ts 的 DOWNLOAD_URL_TTL_SECONDS。
  expires_at timestamptz NOT NULL,
  -- null = 尚未兑付。兑付路径把它从 NULL 改成 now()，且那个 NULL 判定在 WHERE 里（见文件头）。
  consumed_at timestamptz,
  -- 「谁兑付的」。与 consumed_at 一起动或都不动——少一半就是审计问「这枚码是谁用掉的」
  -- 时没有答案的状态（同 invite_links.used_by / used_at 的处置）。
  consumed_by text,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT download_grants_consumed_is_atomic
    CHECK ((consumed_at IS NULL) = (consumed_by IS NULL))
);

-- 同一枚令牌至多一条在世授予。撞了是约束冲突，不是覆盖。
-- ⚠ 「在世」这里就是「未兑付」；过期不进谓词，因为 now() 不是 IMMUTABLE，写不进部分索引
-- （与 0025 的 invite_links_live_slot_uniq 同一处置与同一理由）。
CREATE UNIQUE INDEX IF NOT EXISTS download_grants_live_token_uniq
  ON download_grants (token_hash) WHERE consumed_at IS NULL;

-- 兑付的查找路径：(token_hash) 单列。已兑付的行也要查得到——否则「用过了」与
-- 「从来不存在」在服务端变成同一件事，而 DOWNLOAD_URL_CONSUMED 与 ARTIFACT_NOT_FOUND
-- 恰好是契约里两个不同的错误码。
CREATE INDEX IF NOT EXISTS download_grants_token_idx ON download_grants (token_hash);
-- 「谁下过这份材料」按 artifact 反查（出域回执 / 删除影响面的输入）。
CREATE INDEX IF NOT EXISTS download_grants_artifact_idx
  ON download_grants (org_id, artifact_id, created_at DESC);

/* ─────────────────────────── RLS ─────────────────────────── */

-- 与 0003 / 0022 / 0025 同一形状：租户表一律 ENABLE + FORCE + 单条 org_id 策略。
-- current_setting(..., true) 未设置时为 NULL ⇒ 未设租户的查询读到零行（fail-closed）。
DO $$
BEGIN
  ALTER TABLE download_grants ENABLE ROW LEVEL SECURITY;
  ALTER TABLE download_grants FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS download_grants_tenant ON download_grants;
  CREATE POLICY download_grants_tenant ON download_grants
    USING (org_id = current_setting('app.current_org', true))
    WITH CHECK (org_id = current_setting('app.current_org', true));
END
$$;

-- ⚠ 没有 DELETE。一条已兑付的授予是审计线索的一半（另一半在 provenance_events），
-- 删掉它，「这枚链接是谁用掉的」在事后就答不出来了。清理属 owner 侧的留存作业。
GRANT SELECT, INSERT, UPDATE ON download_grants TO app_rw;

-- F22 的停用冻结（三条 RESTRICTIVE：INSERT / UPDATE / DELETE）。
--
-- ⚠ 必须显式调用一次，**不能**指望 0014 自己扫到这张表：0014 的编号在前，
--   首次跑迁移时它还不存在。漏掉这一行的表现极具欺骗性——新库上这张表**没有**冻结
--   （组织已停用却还能签发并兑付下载链接，即已停用组织仍在出域），而 F22 的断言仍全绿。
--   0020 / 0022 / 0025 各记录过同一个坑，这是第四次。
-- ⚠ 规则本身只声明在 0014；在这里抄一遍三条 CREATE POLICY 才是第二份事实源。
SELECT kernel_apply_org_freeze_policies();
