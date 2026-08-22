-- #1705（#728 D-1，人类裁决见 issue #831 2026-08-09 + 本 issue 2026-08-21 补裁）：
-- 给 agent 加一个独立的「角色头衔」短标签（如「战略分析师」），与既有 `agents.role`
-- （「职责一句话」，见 `20260807030000_i617_create_agent.sql`）分开——不复用同名字段。
--
-- ## 为什么不叫 `role`（人类 2026-08-21 裁决）
--
-- `agents.role` 已经存在、已经有明确语义（「职责一句话」，
-- `design-deltas/agent-instructions/design-signoff.md:65-67` 明文保护它不得挪作他用），
-- 且已经单向投影进 `capability_listings.duty`（见 `pg-self-publish-agent-repository.ts`
-- 的 `INSERT INTO capability_listings` 那段注释）。#831 想加的是「短头衔」
-- （D2 格式「Ava · 战略分析师」的后半段），与「职责一句话」是不同的展示位——
-- 沿用 `role` 这个名字会让同一个词在同一张表里出现两次不同的含义。本迁移用
-- `role_label` 区分二者：`role` 继续是「职责一句话」，`role_label` 是新的「简短头衔」。
--
-- ## 为什么两张表都要加（`agents` + `capability_listings`）
--
-- 人类原话（2026-08-21）：「战略分析师 这个就是一个 agent，数据来源应该是后台的 agent。
-- 原来的只是一个 mock 的数据」——即新字段要挂在真实的 `agents` 表上，随
-- `createAgent`/自助发布一起产生，而不是只能通过「能力目录」admin 表单
-- （`capability-mutate.tsx`，走 `mutateCapability`，可以完全绕开 `agents` 表造一条
-- 纯展示、不可执行的 capability_listings 行）单独编辑。
--
-- 但 chat 面板（`getAgentPanel`）读的是 `capability_listings`，不是 `agents`
-- （`pg-chat-repository.ts:414,502`），且两表只在自助发布那一刻做**单向投影**——
-- 与既有 `role → duty` 完全同构，本迁移开一条平行的 `role_label → role_label` 投影
-- 通道（`pg-self-publish-agent-repository.ts` 同一处 INSERT 里新增一列，不混进
-- duty/role 那条既有管道）。
--
-- ## 存量回填 + 待人工确认标记（裁决原文「存量回填 duty 前 8 字并标记待人工确认」，
-- 本迁移把回填源从「`duty`」换成「`agents.role`」——理由见下）
--
-- 新字段挂在 `agents` 表，`agents` 表本身没有 `duty` 列（`duty` 只存在于
-- `capability_listings`，且是从 `agents.role` 投影出去的派生值，不是独立事实源）。
-- 直接回填源用同一张表里语义最接近的 `agents.role`（「职责一句话」）比隔着一次投影
-- 去读 `capability_listings.duty` 更直接、也不会漏掉从未发布过（因此没有
-- capability_listings 行）的草稿 agent。`capability_listings.role_label` 再从
-- （回填后的）`agents.role_label` 投影一次，与 `role→duty` 的既有回填形状
-- （`20260807000000_i619_agent_roster_capability_convergence.sql`）保持同一套逻辑。
--
-- 可重放：全程 IF NOT EXISTS / DROP CONSTRAINT IF EXISTS。

/* ═══════════════ 一、agents 表：role_label + 待确认标记 ═══════════════ */

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS role_label text,
  ADD COLUMN IF NOT EXISTS role_label_needs_confirmation boolean NOT NULL DEFAULT false;

-- 回填既有行：优先取 `role`（「职责一句话」）前 8 个字符；`role` 本身为空（早于 #617
-- 建列、或从未填过）时退到 `name` 前 8 个字符——两条都是「这行已经存在的事实」，
-- 不发明新文本。回填出来的行一律标 `role_label_needs_confirmation = true`：
-- 这是机械截断出来的占位头衔，不是人取的名字，管理员应尽快去改。
UPDATE agents
   SET role_label = left(trim(COALESCE(NULLIF(trim(role), ''), name)), 8),
       role_label_needs_confirmation = true
 WHERE role_label IS NULL OR trim(role_label) = '';

-- 新建 agent 必填（`createAgent.in.roleLabel` 契约层已要求非空）——但这条纪律只在
-- `createAgent` 这条写路径上强制，**不**在 DB 层对 `agents` 表加 NOT NULL/CHECK。
--
-- ⚠ 这是刻意的收窄，与 `role`/`visibility`/`source`/`publish_state` 等 #617 同批列
-- 的既有做法一致（`20260807030000_i617_create_agent.sql` 那批列全部允许 NULL，
-- `agents_visibility_closed` 等 CHECK 也全是 `col IS NULL OR col IN (...)` 的宽松形状）：
-- `agents` 是一张被多条不经过 `createAgent` 的写路径共享的表（starter-pack 导入、
-- 系统预置 agent、以及数十个测试文件里直接 `INSERT INTO agents` 造最小行的场景，
-- 实测 `grep -rl "INSERT INTO agents\b" apps/api/tests` 命中 20+ 个文件，覆盖
-- itv/skill/chat/agent-runtime 多个不相关模块）——对整张表加 NOT NULL 会让这些
-- 与 `roleLabel` 语义无关的写路径全部被迫补一个它们不关心的字段，属于本 feature
-- 范围之外的连带破坏面。真正的「建 agent 时必填」由契约 `createAgent.in.roleLabel`
-- 的 `.min(1)` 与应用层 `create-agent.ts` 保证，不需要也不应该在 DB 层对整张表加锁。
ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_role_label_present;
ALTER TABLE agents
  ADD CONSTRAINT agents_role_label_present
  CHECK (role_label IS NULL OR length(trim(role_label)) > 0);

/* ═══════ 二、capability_listings 表：平行投影列，不混进 duty ═══════ */

ALTER TABLE capability_listings
  ADD COLUMN IF NOT EXISTS role_label text,
  ADD COLUMN IF NOT EXISTS role_label_needs_confirmation boolean NOT NULL DEFAULT false;

-- 与 i619 的 duty 回填同一形状：`capability_listings.id = agents.id`（自助发布建立的
-- 等式，见 `pg-self-publish-agent-repository.ts` 文件头）用它关联回刚回填好的
-- `agents.role_label`；没有对应 `agents` 行的（走 `capability-mutate.tsx` 单独造的
-- 纯展示 agent 条目）退到自己的 `duty` 前 8 字——它是这类行唯一存在的描述性事实。
UPDATE capability_listings cl
   SET role_label = left(trim(a.role_label), 8),
       role_label_needs_confirmation = a.role_label_needs_confirmation
  FROM agents a
 WHERE cl.kind = 'agent' AND cl.id = a.id AND cl.org_id = a.org_id
   AND (cl.role_label IS NULL OR trim(cl.role_label) = '');

UPDATE capability_listings
   SET role_label = left(trim(COALESCE(NULLIF(trim(duty), ''), name)), 8),
       role_label_needs_confirmation = true
 WHERE kind = 'agent' AND (role_label IS NULL OR trim(role_label) = '');

-- ⚠ 这里**不**照抄 `capability_listings_agent_needs_abbr_duty` 的强制形状（kind='agent'
-- 时非空）。理由与 `agents.role_label` 那条同款收窄一致，但触发条件不同：
-- `capability_listings` 除了自助发布投影这条路径，还有一条**完全独立**的写路径——
-- 「能力目录」admin 表单（`capability-mutate.tsx` → `mutateCapability(op:'add',
-- kind:'agent')`）——它今天不收 `roleLabel`，人类 2026-08-21 的裁决原话「数据来源
-- 应该是后台的 agent，原来的只是一个 mock 的数据」明确说的正是**不**要把这条路径
-- 变成 role_label 的事实源。若在这里加 NOT NULL 式的强制，等于逼这条独立写路径也要
-- 交出一个它不该产出的字段，或者直接把它堵死——两者都不是这次要做的事。
-- 面板读侧（`pg-chat-repository.ts` 的 `toAgentPanelAgent`）对 NULL 的处理是回退到
-- `duty`，不是让请求 500——同 `agents.role_label` 一样，只做"非空则非空白"的宽松校验。
ALTER TABLE capability_listings DROP CONSTRAINT IF EXISTS capability_listings_role_label_present;
ALTER TABLE capability_listings
  ADD CONSTRAINT capability_listings_role_label_present
  CHECK (role_label IS NULL OR length(trim(role_label)) > 0);
