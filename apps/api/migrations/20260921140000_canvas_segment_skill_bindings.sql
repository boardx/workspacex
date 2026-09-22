-- #1468: `bindSkillToSegment` / `listSegmentSkills` 的存储层 —— 议程环节 ↔ skill 的绑定。
--
-- ## 它是什么，以及为什么不是 `canvas_template_bindings` 的一列
--
-- `contracts/canvas/domain.md` 把两种绑定写成**同构但不同实体**：
--   `SegmentTemplateBinding` = `agendaSegmentId` × `templateKey` × `boundTemplateVersion`
--   `SegmentSkillBinding`    = `agendaSegmentId` × `skillKey`    × `runMode`
-- 同构不是同一张表：模板绑定有「绑定时冻结的版本号」和 I-6 的「同一环节最多两个」，
-- skill 绑定两者都没有，而多出一个模板绑定没有的 `runMode`。塞进一张表意味着每行有一半
-- 列恒为 NULL，且 `canvas_template_bindings_segment_key_uniq`（I-6 的一半）会开始数 skill。
--
-- ## ⚠ 没有指向 `skills` 的外键，这是**已知且刻意**的
--
-- 契约 `bindSkillToSegment.err` 逐字只有 `ROLE_INSUFFICIENT | DEPENDENCY_UNAVAILABLE`——
-- **没有** `SKILL_NOT_FOUND`。加一条外键就等于给这条操作造出第三种拒绝，而它在契约里
-- 没有码可回：调用方只会收到一个 500 或一个裸 409，两者都不是签核过的行为。
-- 「绑定一个当前不存在的 skillKey」因此是**允许**的，`listSegmentSkills` 对这种行的
-- 处置写在 `application/canvas/list-segment-skills.ts` 的文件头（不丢行，displayName 退回
-- skillKey 本身）。缺口记在本文件与那份文件头，不靠一条外键替产品做没人签过的裁决。
--
-- ## ⚠ `last_run_at` 今天**没有写入方**，同 `canvas_template_bindings` 当初的处境
--
-- 契约 `listSegmentSkills.out.skills[].lastRunAt` 是 `string | null`，写它的操作是
-- `runSegmentSkill`（`POST /canvas/agenda-segments/:id/skill-runs`）——那条操作需要
-- context pack + 后台任务/轮次运行时，不在 #1468 范围内（见 PR 正文「没有做什么」）。
-- 那为什么现在就建这一列：不建，`lastRunAt` 唯一能返回的就是常数 `null`，而「没跑过」
-- 与「这个字段是假的」在响应体上完全同形——这正是 `20260805030000_canvas_template_registry.sql`
-- 文件头那段「建一张空表让计数从第一天起就是真的」要防的事，此处同理不再复述第二遍。
--
-- ## 权限
--
-- `GRANT` 里没有 DELETE：契约里**没有解绑操作**。授予 DELETE 会让「换 runMode 实现成
-- 先删后插」这个最省事的错误实现变得可能，而那会把 `bindingId` 悄悄换掉——
-- `application/canvas/bind-skill-to-segment.ts` 的 `UPDATE` 语义正是为了不换它。
--
-- 可独立重放：全程 IF NOT EXISTS / DROP-then-CREATE。

CREATE TABLE IF NOT EXISTS canvas_segment_skill_bindings (
  id                text    PRIMARY KEY,
  org_id            text    NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  agenda_segment_id text    NOT NULL,
  workshop_id       text    NOT NULL,
  skill_key         text    NOT NULL,
  -- 契约 `SkillRunMode` 的闭集。`[运行]` 与 `[已开]` 是这两个值的呈现，
  -- domain.md 逐字写着**不可混用**，所以它是一个 CHECK 而不是一段自由文本。
  run_mode          text    NOT NULL CHECK (run_mode IN ('once', 'always-on')),
  -- 见文件头：今天没有写入方，写它的是 `runSegmentSkill`。
  last_run_at       timestamptz NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- 同 `canvas_template_bindings_segment_fk`：复合外键把绑定钉在「这个工作坊自己的组织」
  -- 上，跨工作坊/跨组织的环节 id 在这里插不进来（F118 建表时的理由，不复述）。
  CONSTRAINT canvas_segment_skill_bindings_segment_fk
    FOREIGN KEY (agenda_segment_id, workshop_id, org_id)
    REFERENCES agenda_segments (id, workshop_id, org_id) ON DELETE CASCADE,
  -- 一个环节对同一个 skillKey 只有**一条**绑定。
  -- ⚠ 这条唯一约束是 `listSegmentSkills` 能成立的前提：契约的 out 是一张白名单，
  --   同一个 skillKey 出现两行（比如一行 `once`、一行 `always-on`）时，左栏第三区
  --   要么显示两个同名条目、要么得自己挑一个——domain.md 那句「两种 runMode 不可混用」
  --   在那种数据下无从执行。改 runMode 因此是 UPDATE 这一行，不是插第二行。
  CONSTRAINT canvas_segment_skill_bindings_segment_skill_uniq
    UNIQUE (org_id, agenda_segment_id, skill_key)
);

CREATE INDEX IF NOT EXISTS canvas_segment_skill_bindings_skill_idx
  ON canvas_segment_skill_bindings (org_id, skill_key);

COMMENT ON TABLE canvas_segment_skill_bindings IS
  '#1468: listSegmentSkills 的唯一事实源，写入方是 bindSkillToSegment。'
  'last_run_at 的写入方是 runSegmentSkill，该操作尚未实现（见本表所在迁移的文件头）。';

ALTER TABLE canvas_segment_skill_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE canvas_segment_skill_bindings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS canvas_segment_skill_bindings_tenant ON canvas_segment_skill_bindings;
CREATE POLICY canvas_segment_skill_bindings_tenant ON canvas_segment_skill_bindings
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON canvas_segment_skill_bindings FROM app_rw;
-- 见文件头「权限」：没有 DELETE。
GRANT SELECT, INSERT, UPDATE ON canvas_segment_skill_bindings TO app_rw;

-- F22：组织冻结策略只看得见它运行时已经存在的表。加完租户表要重新应用一次，
-- 否则一个被停用的组织仍然能绑定 skill。
SELECT kernel_apply_org_freeze_policies();
