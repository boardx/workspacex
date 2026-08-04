-- #463: canvas 模板注册表的存储层 —— F100/F101/F102 的领域层早就绿了，而它们从来没有过一张表。
--
-- ## 两张表，各自封一件事
--
-- `canvas_templates`          —— 一个 (org, key, version) 的生命周期状态。O-10 的「归档」是
--                                这一行上的一次**置位**，不是一次删除，也不是一个过滤条件。
-- `canvas_template_bindings`  —— 议程环节 ↔ 模板版本 的绑定。它同时是**两个契约字段**的唯一
--                                事实源：`listTemplates.out.usageCount` 与
--                                `archiveTemplate.out.stillBoundSegmentCount`。
--
-- ## 为什么没有 usage_count 列
--
-- 契约逐字写着 `usageCount` **必须真实统计，不得估算**。一个可写的计数列意味着它可能与
-- 实际绑定数不一致，而「统计值」三个字的全部意义就是它必须**恒等于**实际数量。现查
-- `COUNT(*)` 没有漂移的可能，因为它就是那个定义本身。同 F82 `interview_template_applications`
-- 的理由（见那份迁移的文件头），此处不再复述第二遍。
--
-- ## ⚠ `canvas_template_bindings` 目前没有写入方，这是**已知且刻意**的
--
-- 写它的操作是契约里的 `bindTemplateToSegment`（F102 那条 HTTP 边界），不在 #463 范围内。
-- 那为什么现在就建它：上面两个契约字段是**数出来的**，没有这张表，唯一能返回的是常数 0——
-- 而「返回 0」与「没有可数的东西」在响应体上完全同形，恰好是契约那句「不得估算」要防的事。
-- 建一张空表让计数从第一天起就是真的，比先返回 0、等以后有人记得回来改要诚实。
--
-- ## 这里没有什么
--
-- **没有任何 INSERT。** 19 个内置 A0 模板的 key 在 `@repo/contracts` 的
-- `BUILTIN_CANVAS_TEMPLATES` 里声明，但把它们 seed 进这张表就是把内置清单写进产品，
-- 正是 `scripts/lint-no-builtin-capabilities.mjs` 与 F15 验收 V1 要挡的事：
-- 一个没配置过的组织，模板库必须是**空的**。
--
-- 可独立重放：全程 IF NOT EXISTS / DROP-then-CREATE。

CREATE TABLE IF NOT EXISTS canvas_templates (
  org_id          text    NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  key             text    NOT NULL,
  version         integer NOT NULL CHECK (version > 0),
  -- 展示名。内置 key 的权威是契约的 `BUILTIN_CANVAS_TEMPLATES`；组织自建模板用自己的。
  display_name    text    NOT NULL CHECK (length(display_name) > 0),
  status          text    NOT NULL CHECK (status IN ('draft', 'trial', 'published', 'archived')),
  -- `domain/canvas/template-lifecycle.ts` 的 `TemplateVersionState.archivedFrom`。
  -- restore 的落点是它算出来的，所以它必须**落库**——只记「archived」的实现，
  -- 恢复时无从分辨该回 draft 还是 published，只能猜。
  archived_from   text    NULL CHECK (archived_from IN ('draft', 'trial', 'published')),
  builtin         boolean NOT NULL,
  visibility      text    NOT NULL CHECK (visibility IN ('org-wide', 'team-only')),
  -- 判定所需、**永不出现在响应体里**的事实：`team-only` 归哪个团队。
  --
  -- ⚠ 契约 `listTemplates.out` 有 `visibility` 却没有「哪个团队」这一栏，`publishTemplate.in`
  --   也没有——与 `CapabilityListing` 的同一处缺口逐字同型（已记在
  --   `application/identity/capability-ports.ts` 的文件头）。所以这一列存在于库里、
  --   喂给 `decideCapabilityVisibility`，但不进任何 out。
  -- ⚠ 可空且**不加 CHECK**：`team-only` 而没有 owner 的行对**所有人**不可见
  --   （`decide()` 的 scopePassed 要求 `org.teamId === ownerTeamId`，null 谁都对不上）。
  --   这是 fail-closed，而给它编一个默认团队才是发明。
  owner_team_id   text    NULL REFERENCES teams (id) ON DELETE SET NULL,
  underlying_type text    NOT NULL,
  -- `SectionDef[]`，契约 `listTemplates.out.templates[].sections` 的存储形态。
  sections        jsonb   NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, key, version),
  -- 状态与来处必须同时成立或同时不成立。少了它，一行可以既是 `published` 又带着
  -- `archived_from`，而那种行在恢复路径上会走出一个没人写过的分支。
  CONSTRAINT canvas_templates_archived_from_shape CHECK (
    (status = 'archived' AND archived_from IS NOT NULL) OR
    (status <> 'archived' AND archived_from IS NULL)
  )
);

-- I-4「发布新版本时旧版自动归档」的机械形态。
--
-- ⚠ 这是**索引**而不是应用层的一次 UPDATE，理由是这条不变量的失败方式：把「归档旧版」
--   写成用例里的一段代码，漏掉任何一条分支（并发发布、恢复到 published、直接改状态的
--   后台脚本）都会留下两个 published，而所有只检查「我点名的那两行」的测试仍然全绿。
--   索引没有分支可漏。
CREATE UNIQUE INDEX IF NOT EXISTS canvas_templates_one_published_per_key
  ON canvas_templates (org_id, key) WHERE status = 'published';

CREATE TABLE IF NOT EXISTS canvas_template_bindings (
  id                text    PRIMARY KEY,
  org_id            text    NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  agenda_segment_id text    NOT NULL,
  workshop_id       text    NOT NULL,
  template_key      text    NOT NULL,
  template_version  integer NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT canvas_template_bindings_segment_fk
    FOREIGN KEY (agenda_segment_id, workshop_id, org_id)
    REFERENCES agenda_segments (id, workshop_id, org_id) ON DELETE CASCADE,
  -- ⚠ **没有 ON DELETE CASCADE，也没有任何状态条件**，这两条缺失就是 O-10 本身：
  --   归档是模板行上的一次置位，绑定行既不该被连带删掉，也不该因为对面变成 `archived`
  --   而解析不出来。一场正在进行的工作坊切到该环节时必须照常实例化（I-5 后半）。
  CONSTRAINT canvas_template_bindings_template_fk
    FOREIGN KEY (org_id, template_key, template_version)
    REFERENCES canvas_templates (org_id, key, version),
  -- I-6 的一半：同一议程环节对同一个 key 只能有一条绑定。
  -- 「同一环节最多两个模板」那条上限属 `bindTemplateToSegment`（F102），不在本迁移。
  CONSTRAINT canvas_template_bindings_segment_key_uniq
    UNIQUE (org_id, agenda_segment_id, template_key)
);

CREATE INDEX IF NOT EXISTS canvas_template_bindings_template_idx
  ON canvas_template_bindings (org_id, template_key, template_version);

COMMENT ON TABLE canvas_template_bindings IS
  '#463: usageCount 与 stillBoundSegmentCount 的唯一事实源（COUNT(*)，本表没有可写的计数列）。'
  '写入方是 bindTemplateToSegment（F102），不在 #463 范围内。';

ALTER TABLE canvas_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE canvas_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE canvas_template_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE canvas_template_bindings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS canvas_templates_tenant ON canvas_templates;
CREATE POLICY canvas_templates_tenant ON canvas_templates
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

DROP POLICY IF EXISTS canvas_template_bindings_tenant ON canvas_template_bindings;
CREATE POLICY canvas_template_bindings_tenant ON canvas_template_bindings
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON canvas_templates, canvas_template_bindings FROM app_rw;
-- ⚠ 没有 DELETE：归档是置位，不是删除（O-10）。授予 DELETE 会让「把归档实现成删除」
--   这个最省事的错误实现变得**可能**，而那正是 F146 在 research 模块踩过的那一次。
GRANT SELECT, INSERT, UPDATE ON canvas_templates TO app_rw;
GRANT SELECT, INSERT ON canvas_template_bindings TO app_rw;

-- F22：组织冻结策略只看得见它运行时已经存在的表。加完租户表要重新应用一次，
-- 否则一个被停用的组织仍然能发布/归档模板。
SELECT kernel_apply_org_freeze_policies();
