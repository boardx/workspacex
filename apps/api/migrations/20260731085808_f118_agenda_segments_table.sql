-- F118: `agenda_segments` 独立表 —— 四态 + mergedInto + 同工作坊至多一个 active 的
--        部分唯一索引 + `artifact_bindings` 补外键
-- (uc-00-1 R3 / contracts/project/domain.md I-P42 / I-P43 / I-P44 /
--  contracts/project/MIGRATION-IMPACT.md 第二节)
--
-- ## 这个文件在防什么
--
-- 议程环节此前只是 `artifact_bindings.step_id` 里的一个裸字符串——没有身份、没有状态、
-- 没有「这个环节属于哪个工作坊」的可查询关系。Q-2① 裁决 A（建独立表）+ Q-2② 裁决 B
-- （四态 + mergedInto）+ Q-8 裁决 2（补外键）把它从「大家心里知道的字符串约定」
-- 变成数据库能替我们守住的东西。
--
-- ⚠ 挂 `workshops` 不是 `projects`——议程环节是**工作坊机件**（人类 2026-07-30 逐字，
--   `usecases.md` UC-P6）。超类型模型下 `workshops.id ≡ projects.id`（F116/0018 已落库），
--   所以 `artifact_bindings.project_id` 与某条环节的 `workshop_id` 是同一个值域，
--   两句不冲突——见下方第三节的复合外键。
--
-- ⚠ **不得**退化成 `started_at` / `ended_at` 时间戳：临时提权的失效条件是
--   「流程节点不是时间点」（uc-1-4:98 逐字），时间戳表达不了「被跳过」与「被合并」。
--
-- ## 序号
-- 时间戳前缀（20260731085808）而非下一个顺序数字——多个 worker 并行认领
-- phase-01 的不同 feature 时，各自选「下一个可用序号」会互相撞号（本仓已因此出过
-- 「共享开发库被别的分支迁移污染」的并发事故）。时间戳在文件名排序上仍晚于全部既有
-- 0001-0031，migrator 按文件名字典序 apply，效果与顺序数字等价。
--
-- ## 可重放
-- `migrate:check` 用 `force: true` 在**同一个已迁移过的库**上重放每个文件（不是清空重来），
-- 所以任何 `ALTER TABLE ... ADD CONSTRAINT` 必须走 `DO $$ IF NOT EXISTS ... END $$`，
-- 不能裸写一句 `ADD CONSTRAINT`（同 0018 对 `projects_id_kind_uniq` 的处理）。

/* ═══════════════ 一、`workshops` 补一条复合唯一约束 ═══════════════ */

-- `agenda_segments.workshop_id` 要用复合外键钉在“这个工作坊自己的组织”上
-- （同 0018 对三张子类型表的处理：单列外键只能保证「指向某个存在的工作坊」，
-- 保证不了「指向本租户的那个工作坊」），而 Postgres 要求外键的目标列组
-- 必须被一个唯一约束覆盖 —— `workshops` 目前只有单列 PK，没有 `(id, org_id)`。
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'workshops_id_org_uniq' AND conrelid = 'workshops'::regclass
  ) THEN
    ALTER TABLE workshops ADD CONSTRAINT workshops_id_org_uniq UNIQUE (id, org_id);
  END IF;
END $$;

/* ═══════════════ 二、`agenda_segments` 独立表（Q-2① 裁 A） ═══════════════ */

-- 字段名单源：`agenda_segment` / `agenda_segment_id`（D-03a）。列名照抄契约
-- `packages/contracts/src/project.ts` 的 `AgendaSegment`，蛇形/驼峰的对应关系
-- 与本仓其它表一致（`workshop_id` ↔ `workshopId` 等）。
--
-- ⚠ `org_id` 不是冗余列：`kernel_tenant_table_audit()` 从 pg_catalog 推导租户表，
--   没有 `org_id` 的新表会被判 `UNTENANTED_BUT_GRANTED`，`verify-rls.sh` 当场变红
--   （同 0018 对三张子类型表的处理）。
CREATE TABLE IF NOT EXISTS agenda_segments (
  id     text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,

  -- 议程环节是工作坊机件，不挂 `projects`（U-9 A 之后 `projects` 只剩五列封闭清单）。
  workshop_id text NOT NULL,

  -- 指回蓝本侧的环节定义（O-02 裁②：引用而非内联）。null = 未套蓝本时手工搭出来的环节。
  -- ⚠ 蓝本域（`templates` 束）尚未在本迁移里落库对应表，所以这里**不加外键**——
  --   一个指向不存在表的外键写不出来；等蓝本域的环节定义表落地后再补，
  --   补外键是那一侧的交付物，不在本 feature 里发明。
  agenda_segment_definition_id text,

  ordinal  integer NOT NULL CHECK (ordinal >= 0),
  title    text NOT NULL CHECK (length(title) > 0),
  -- ⚠ 单位无出处（`KNOWN_CONTRACT_GAPS.P5`）：原型只给「时长档位」。只保证是正整数，
  --   不在这里替人定单位。
  duration integer NOT NULL CHECK (duration > 0),

  -- 四态（Q-2② 裁 B）。**没有默认值之外的第五个值**——CHECK 逐个等于契约
  -- `AgendaSegmentState` 枚举成员（技法同 0006/0008），而不是「大概四个」。
  -- ⚠ 显式命名（不用 Postgres 自动生成的 `_state_check`）：`merged_into` 那条
  --   CHECK 的表达式里也含 `state`，两条约束都能被一个粗糙的 `LIKE '%state%'`
  --   误中，测试要靠这个名字精确定位到这一条。
  state text NOT NULL DEFAULT 'pending'
    CONSTRAINT agenda_segments_state_check CHECK (state IN ('pending', 'active', 'closed', 'skipped')),

  -- 并入的目标环节。自引用外键：目标必须是一条真实存在的环节，孤儿指向不可能存在。
  -- ⚠ 故意不用 ON DELETE CASCADE / SET NULL：本束没有删除环节的操作（同 Q-9 的推理），
  --   NO ACTION（默认）足够。
  merged_into text REFERENCES agenda_segments (id),

  -- 本环节接受哪些来源的产出（Q-2③）。空数组 = 不限制（默认全接受）。
  -- ⚠ 元素集合是契约 `ArtifactSource` 七值闭集的字面量复制——这里用 CHECK 的 `<@`
  --   （子集）钉住，而不是留一个不校验的 text[]。改契约枚举要求同时改这条 CHECK，
  --   否则库里能存进契约不认识的来源字符串，`bindToProjectStep` 的白名单判断会静默失真。
  accepted_sources text[] NOT NULL DEFAULT '{}'
    CHECK (accepted_sources <@ ARRAY[
      'survey', 'conversation', 'interview', 'prototype-run',
      'research-run', 'upload', 'ai-generated'
    ]::text[]),

  created_at timestamptz NOT NULL DEFAULT now(),

  -- **I-P43**：`merged_into` 只在 `closed` / `skipped` 上可非空。
  -- ⚠ 这条不是「建议」，是断言：违反即数据损坏（一个 `pending`/`active` 的环节
  --   不该同时声称「我已经并入了别的环节」）。
  CONSTRAINT agenda_segments_merged_into_terminal_only
    CHECK (merged_into IS NULL OR state IN ('closed', 'skipped')),

  -- 支撑复合外键的目标：`(id, workshop_id, org_id)` 唯一，供
  -- `artifact_bindings` 的三元复合外键引用（见第四节）。
  CONSTRAINT agenda_segments_id_workshop_org_uniq UNIQUE (id, workshop_id, org_id)
);

-- `workshop_id` 的复合外键单独用 DO $$ 加：与「不能裸写 ADD CONSTRAINT」的理由相同，
-- 统一走 IF NOT EXISTS 守卫，风格与 0018 对三张子类型表复合外键的处理一致。
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'agenda_segments_workshop_org_fkey' AND conrelid = 'agenda_segments'::regclass
  ) THEN
    ALTER TABLE agenda_segments
      ADD CONSTRAINT agenda_segments_workshop_org_fkey
      FOREIGN KEY (workshop_id, org_id) REFERENCES workshops (id, org_id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS agenda_segments_workshop_idx ON agenda_segments (org_id, workshop_id, ordinal);

-- **I-P44** 🔴 ——「同一工作坊内 `active` 的议程环节至多一个」是**数据库层的部分唯一索引**，
-- 不是应用层「先查后写」。「议程环节状态是三视角首屏的唯一驱动源」这句话只有这样才可断言：
-- 并发把两条环节同时置为 `active`，数据库保证恰好一条成功，另一条拿到
-- `23505 unique_violation`（应用层把它翻译成 `SEGMENT_ALREADY_ACTIVE` 是 F119 的交付物，
-- 本迁移只建索引）。
CREATE UNIQUE INDEX IF NOT EXISTS agenda_segments_one_active_per_workshop
  ON agenda_segments (workshop_id) WHERE state = 'active';

/* ═══════════════ 三、RLS + 冻结策略 ═══════════════ */

ALTER TABLE agenda_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda_segments FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agenda_segments_tenant ON agenda_segments;
CREATE POLICY agenda_segments_tenant ON agenda_segments
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON agenda_segments FROM app_rw;
-- 无 DELETE：本束没有删除环节的操作（Q-9 同理推出）。删除仅通过工作坊/容器级联发生。
GRANT SELECT, INSERT, UPDATE ON agenda_segments TO app_rw;

-- 新建的租户表默认不会自动获得 F22 的三条 RESTRICTIVE 冻结策略——
-- `kernel_apply_org_freeze_policies()` 只在被**调用**时才重算（0014/0018 已各调一次）。
-- 漏了这一行的表现是：新库上 `agenda_segments` 没有冻结，而 F22 的全部断言依旧全绿
-- （它们测的是当时已存在的那些表），只有 `migrate:check` 的强制重放会报
-- 「重放后 schema 摘要不一致」（`contracts/project/MIGRATION-IMPACT.md` §3.2①）。
SELECT kernel_apply_org_freeze_policies();

/* ═══════════════ 四、`artifact_bindings` 补外键（Q-8 裁决 2） ═══════════════ */

-- **I-P42** 🔴 —— `artifact_bindings.step_id` 此前无外键（0008 头部注释逐字：
-- 「there is no `steps` table anywhere in phase-00」），`STEP_CLOSED` /
-- `STEP_REJECTS_ARTIFACT_TYPE` 两个已签核失败码因此不可评估。`agenda_segments` 建成后
-- 第一次能评估——但本迁移**不改 0008**（那是已 passing 的迁移），补外键是新增的一条
-- `ALTER TABLE`。
--
-- ⚠ 复合外键 `(step_id, project_id, org_id) → agenda_segments (id, workshop_id, org_id)`
--   而不是单列 `step_id → agenda_segments(id)`：单列只能保证「指向某个存在的环节」，
--   保证不了「指向**这个绑定所在项目**的那个环节」。不加 `project_id` 这一位，
--   一个绑定可以合法地把 `step_id` 指向**另一个工作坊**的环节——三视角首屏据此渲染出
--   一个属于别的工作坊的环节标题，而「外键存在」这条断言完全看不见这个洞。
--   `workshops.id ≡ projects.id`（F116 超类型模型）使得 `project_id` 与 `workshop_id`
--   同值域，这条外键因此可以直接写，不需要额外的转换表。
--
-- ⚠ 这条约束只对**新插入 / 更新**的行生效；本仓当前没有生产数据，
--   迁移执行时表为空，ADD CONSTRAINT 不需要回填。已知的、写在
--   `contracts/project/MIGRATION-IMPACT.md` §3.1 里的连带后果：一部分 phase-00
--   遗留的绑定测试夹具（`binding-three-modes.test.ts` 等）用的是不对应任何
--   `agenda_segments` 行的裸 `step_id` 字符串，补上这条外键后那些 INSERT 会变成
--   外键冲突。该文件已把这一点登记为「会变红的（好事）」，且明确建议作为独立的
--   issue / PR 处理（不在本 feature 范围内顺手改 F06 的验收测试）。
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'artifact_bindings_segment_fkey' AND conrelid = 'artifact_bindings'::regclass
  ) THEN
    ALTER TABLE artifact_bindings
      ADD CONSTRAINT artifact_bindings_segment_fkey
      FOREIGN KEY (step_id, project_id, org_id)
      REFERENCES agenda_segments (id, workshop_id, org_id);
  END IF;
END $$;

COMMENT ON TABLE agenda_segments IS
  'F118 / Q-2① A + Q-2② B: 独立议程环节表，挂 workshops。四态 pending/active/closed/skipped，'
  'closed 与 skipped 均可带 merged_into。workshop_id 内 active 至多一条由部分唯一索引'
  '(agenda_segments_one_active_per_workshop) 保证，不是应用层先查后写。';

COMMENT ON CONSTRAINT artifact_bindings_segment_fkey ON artifact_bindings IS
  'F118 / Q-8 裁决 2: artifact_bindings.step_id 首次获得外键，指向 agenda_segments，'
  '并要求同一工作坊（project_id = workshop_id，F116 超类型模型下同值域）。'
  '孤儿绑定（指向不存在或不同工作坊的环节）从此不可能存在。';
