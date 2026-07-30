-- 0018 F108: 对话可见性 —— 线程 / 消息两张表 + 三条数据库级不变量
-- (phase-01 contracts/chat/domain.md A 组 I-1 / I-9，uc-8-5)
--
-- ## 这个文件在防什么
--
-- F108 的三条断言里，有三条**只有数据库能保证**，写在应用层就只保证到「下一个写入者」为止：
--
--   · I-1  `visibility_scope` 五值封闭 —— 应用层枚举挡不住直接写库的迁移脚本 / 数据修复
--   · I-9  agent 私聊恒为项目层 —— 「永不为 personal」如果只是 TypeScript 的联合类型，
--          它在 `INSERT ... ownership_layer='personal'` 面前不存在
--   · 租户隔离 —— 没有策略的表就是洞（0005 头部那条），对话正文是本仓最敏感的一类内容
--
-- 其余的（两层交集、观察者降级、跨组、私聊三方可读）**不是**数据库属性：它们要读
-- org_memberships × project_memberships × 线程属性三方，判定必须在 domain 层，
-- 由 `apps/api/src/domain/chat/thread-visibility.ts` 一处回答。
--
-- ⚠ 这里**没有**给 chat_threads 写一条「按可见性过滤」的 RLS 策略，是刻意的。
--   RLS 只认得 `app.current_org`，认不得「本组组长」；写一条只做租户隔离的策略，
--   再让人以为可见性也被数据库兜住了，比没有更危险。租户由 RLS 兜，
--   可见性由 domain 兜，两处各自可断言、互不冒充。
--
-- 可重放：全部 IF NOT EXISTS / DROP-then-ADD，`migrate:check` 会强制重放每个文件。

/* ═══════════════ 一、线程 ═══════════════ */

CREATE TABLE IF NOT EXISTS chat_threads (
  id               text PRIMARY KEY,
  org_id           text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- 恒非空：**对话不存在于项目之外**（domain.md 实体 1，含 agent 私聊）。
  -- 可空的话，「项目层」这个词就没有指代对象，两层交集也没有第二层可交。
  project_id       text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  -- NULL = 全场 / 研究阶段线程；非空 = 该组的线程。跨组判定（I-6）读这一列。
  group_id         text REFERENCES groups (id) ON DELETE SET NULL,
  visibility_scope text NOT NULL,
  phase            text NOT NULL DEFAULT 'onsite' CHECK (phase IN ('onsite', 'research')),
  archived         boolean NOT NULL DEFAULT false,
  -- I-9。DEFAULT 'project' 且 CHECK 只允许 'project'：
  -- 「agent 私聊归项目层」这句话在这里的形式是「personal 这个值写不进去」。
  ownership_layer  text NOT NULL DEFAULT 'project',
  -- agent 私聊标记。它**不改变** ownership_layer（那正是 I-9 要防的），
  -- 也**不进入在场态计数**（I-10，计数由 agent roster 决定，不由线程数决定）。
  agent_private    boolean NOT NULL DEFAULT false,
  created_by       text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 0
);

-- 五值封闭（I-1）。DROP-then-ADD 而不是 CREATE TABLE 里内联：
-- 内联的 CHECK 在表已存在时是静默空操作，于是「改了枚举」和「没改成」长得一模一样。
--
-- ⚠ 这五个值是 `packages/contracts/src/chat.ts` 的 `ChatVisibility` 的副本，而副本是本仓
--   踩过五次的坑。所以它**不被当作副本对待**：`visibility-two-layer-intersection.test.ts`
--   把这条约束从 pg_catalog 里读出来，逐值断言它等于契约枚举。改了契约不改这里，
--   那条测试会红并指名缺哪个值。
--
-- ⚠ 「全场」那一档取 `plenary` 还是 `all-hands` 是 **D05，待人类裁决**
--   （`apps/web/lib/contract-divergences.ts`）。这里跟随**契约**，不是选边：
--   契约是 ADR-020 的唯一事实源，裁决落地时改契约，上面那条测试会立刻要求这里跟上。
-- I-9 也走 DROP-then-ADD，理由同上：写成 CREATE TABLE 里的内联 CHECK，在**表已存在**的库上
-- 是静默空操作。反证时发现的正是这一点——把内联 CHECK 删掉后，已建库照旧拒绝 'personal'，
-- 只有全新库才复现，于是「约束还在不在」取决于跑的是谁的机器。
ALTER TABLE chat_threads DROP CONSTRAINT IF EXISTS chat_threads_ownership_layer;
ALTER TABLE chat_threads ADD CONSTRAINT chat_threads_ownership_layer
  CHECK (ownership_layer = 'project');

ALTER TABLE chat_threads DROP CONSTRAINT IF EXISTS chat_threads_visibility_scope;
ALTER TABLE chat_threads ADD CONSTRAINT chat_threads_visibility_scope
  CHECK (visibility_scope IN ('member-private', 'group-shared', 'plenary', 'team-visible', 'private'));

-- 组员私聊必须挂在某个组上，否则 I-7 的「本组组长」没有指代对象——
-- 一个无组的 member-private 线程，其可读集里的「组长」是谁，无人能回答，
-- 而无人能回答的规则会被下一个实现者解成「那就都能读」。
ALTER TABLE chat_threads DROP CONSTRAINT IF EXISTS chat_threads_member_private_needs_group;
ALTER TABLE chat_threads ADD CONSTRAINT chat_threads_member_private_needs_group
  CHECK (visibility_scope <> 'member-private' OR group_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS chat_threads_project_idx
  ON chat_threads (org_id, project_id, last_activity_at DESC);

/* ═══════════════ 二、消息 ═══════════════ */

CREATE TABLE IF NOT EXISTS chat_messages (
  id          text PRIMARY KEY,
  org_id      text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  thread_id   text NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
  author_kind text NOT NULL CHECK (author_kind IN ('human', 'agent')),
  author_id   text NOT NULL,
  agent_id    text,
  body        text NOT NULL,
  -- **原始转写**。观察者的响应体里不存在这类消息（I-5），而「不存在」要能被判定，
  -- 就得有一列说明哪条是转写——靠 body 前缀猜是把安全规则建在字符串上。
  raw_transcript boolean NOT NULL DEFAULT false,
  -- 消息可比线程更严，不可更松（domain.md 实体 3）。NULL = 继承线程。
  visibility_scope text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_visibility_scope;
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_visibility_scope
  CHECK (visibility_scope IS NULL OR visibility_scope IN
    ('member-private', 'group-shared', 'plenary', 'team-visible', 'private'));

CREATE INDEX IF NOT EXISTS chat_messages_thread_idx
  ON chat_messages (org_id, thread_id, created_at);

/* ═══════════════ 三、RLS：与其余租户表同一条规则 ═══════════════ */

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['chat_threads', 'chat_messages']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    -- FORCE：表属主也受策略约束。少了它，以属主身份跑的任何路径都是一条无声的旁路。
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant', t);
    -- current_setting(..., true) 未设置时为 NULL ⇒ 无租户上下文的查询看到零行（fail-closed）。
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (org_id = current_setting(''app.current_org'', true)) '
      'WITH CHECK (org_id = current_setting(''app.current_org'', true))',
      t || '_tenant', t);
  END LOOP;
END
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON chat_threads TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON chat_messages TO app_rw;

-- 组织停用后只读降级（F22 / 迁移 0014）：**新建的租户表必须自己补这一次调用**。
--
-- 0014 的编号在本文件之前，所以首次跑迁移时它见不到 chat_threads / chat_messages，
-- 这两张表就拿不到三条 RESTRICTIVE 冻结策略——而 F22 的断言依旧全绿，因为它们测的是
-- 当时已存在的那些表。0014 头部把这个坑写得很清楚（F17 踩过一次），规则只声明在那一处，
-- 这里只是调用它。
--
-- ⚠ 这一句是被 `migrate:check` 抓出来的，不是预先想到的：没有它，强制重放后的
--   schema 摘要与首次迁移不一致（多出六条 chat_* 的冻结策略），门控当场变红。
SELECT kernel_apply_org_freeze_policies();

COMMENT ON CONSTRAINT chat_threads_visibility_scope ON chat_threads IS
  'I-1: 可见范围五值封闭，新增必须走 ADR。该约束由 tests/chat/visibility-two-layer-intersection.test.ts '
  '从 pg_catalog 读出并与 contracts ChatVisibility 逐值比对——它不是契约的第二份副本，是被门控的投影。';

COMMENT ON COLUMN chat_threads.ownership_layer IS
  'I-9: agent 私聊恒为项目层，永不为 personal。CHECK 让「永不」在 INSERT 面前也成立。';
