-- #1493（UC-7.3 第一块）: 画布实例 + 不可变版本链 —— `instantiateForSegment` /
-- `getSource` / `updateSource` 三条契约操作的存储层。
--
-- ## 两张表，各自封一件事
--
-- `canvas_instances`         —— 实例头。冻结 (template_key, template_version)（I-4，见
--                               `domain/canvas/instance-version-freeze.ts`：写入后永不改变，
--                               模板发新版/归档不改动任何已建实例）+ `head_version` 指针。
-- `canvas_instance_versions` —— 追加式 immutable 版本行。**没有 UPDATE 它的路径**：
--                               `updateSource` 只追加新行并推进 head 指针，历史版本
--                               逐字节不动（uc-7-3「另一侧存版本，不丢弃」的存储前提）。
--
-- ## 存储方案是人类 2026-08-17 选的
--
-- 轻量 PG 表，不走 S3/ObjectStore。`content_hash` 是 markdown 的 sha256（先例：
-- `application/skill/edit-skill-version-content.ts` 的 `contentDigest`）。
--
-- ## 幂等键为什么在唯一约束里
--
-- 契约 `instantiateForSegment` 逐字要求「同 `idempotencyKey` 返回**同一批** `instanceId`」
-- ——现场网络抖动重试是常态。判定与写入必须收在数据库层（ON CONFLICT DO NOTHING +
-- 唯一约束，同 `canvas_template_bindings_segment_key_uniq` 的纪律）：先查后写在并发
-- 重试下两条都会进去，每组开出两张空画布正是契约点名要防的事。
--
-- RLS/tenant 纪律照抄 `20260805030000_canvas_template_registry.sql`。
-- 可独立重放：全程 IF NOT EXISTS / DROP-then-CREATE。

CREATE TABLE IF NOT EXISTS canvas_instances (
  id                text    PRIMARY KEY,
  org_id            text    NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  agenda_segment_id text    NOT NULL,
  workshop_id       text    NOT NULL,
  -- 本组画布归本组（uc-7-3 A2：别组只读、写回被服务端拒 NOT_IN_GROUP）。
  group_id          text    NOT NULL REFERENCES groups (id),
  -- I-4 冻结对：实例建成那一刻的模板引用，此后**没有任何 UPDATE 路径**碰这两列。
  template_key      text    NOT NULL,
  template_version  integer NOT NULL CHECK (template_version > 0),
  -- 幂等重放的判定列（见文件头）。
  idempotency_key   text    NOT NULL,
  -- 乐观并发的 head 指针：当前最新版本号。推进只发生在 `updateSource` 的
  -- 「判定与写入同一条语句」CTE 里（pg-canvas-instance-repository.ts）。
  head_version      integer NOT NULL CHECK (head_version >= 1),
  created_by        text    NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT canvas_instances_segment_fk
    FOREIGN KEY (agenda_segment_id, workshop_id, org_id)
    REFERENCES agenda_segments (id, workshop_id, org_id) ON DELETE CASCADE,
  -- ⚠ 指向模板行但**没有 ON DELETE CASCADE、没有状态条件**——同
  --   `canvas_template_bindings_template_fk` 的理由：归档是模板行上的置位，
  --   已实例化的画布必须继续解析得出来（I-5 / O-10 ②）。
  CONSTRAINT canvas_instances_template_fk
    FOREIGN KEY (org_id, template_key, template_version)
    REFERENCES canvas_templates (org_id, key, version),
  -- 幂等重放的机械形态：同 (环节, 幂等键, 组, 模板) 至多一个实例。
  -- 并发重试的第二个请求在这里撞约束、安静地退回零行，然后重读既有那一批。
  CONSTRAINT canvas_instances_idempotency_uniq
    UNIQUE (org_id, agenda_segment_id, idempotency_key, group_id, template_key)
);

CREATE INDEX IF NOT EXISTS canvas_instances_segment_idx
  ON canvas_instances (org_id, agenda_segment_id);

CREATE TABLE IF NOT EXISTS canvas_instance_versions (
  id            text    PRIMARY KEY,
  org_id        text    NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  instance_id   text    NOT NULL REFERENCES canvas_instances (id) ON DELETE CASCADE,
  version       integer NOT NULL CHECK (version >= 1),
  markdown      text    NOT NULL,
  -- markdown 的 sha256（hex）。契约 `getSource.out.contentHash` 的唯一事实源——
  -- 存而不是现算，是为了让「响应里的 hash」与「写入那一刻的内容」可事后对账。
  content_hash  text    NOT NULL,
  created_by    text    NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- 一个实例的版本号不重号。`updateSource` 的追加行号 = 推进后的 head_version，
  -- 两者在同一条 CTE 语句里产生，这条唯一约束是那条语句写错时的最后防线。
  CONSTRAINT canvas_instance_versions_instance_version_uniq
    UNIQUE (instance_id, version)
);

CREATE INDEX IF NOT EXISTS canvas_instance_versions_instance_idx
  ON canvas_instance_versions (org_id, instance_id, version);

ALTER TABLE canvas_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE canvas_instances FORCE ROW LEVEL SECURITY;
ALTER TABLE canvas_instance_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE canvas_instance_versions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS canvas_instances_tenant ON canvas_instances;
CREATE POLICY canvas_instances_tenant ON canvas_instances
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

DROP POLICY IF EXISTS canvas_instance_versions_tenant ON canvas_instance_versions;
CREATE POLICY canvas_instance_versions_tenant ON canvas_instance_versions
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

-- app_rw：实例头要 UPDATE（head_version 指针推进）；版本行**只有 SELECT, INSERT**——
-- 库权限层面就没有 UPDATE/DELETE，immutable 不是应用层自律。
GRANT SELECT, INSERT, UPDATE ON canvas_instances TO app_rw;
GRANT SELECT, INSERT ON canvas_instance_versions TO app_rw;

COMMENT ON TABLE canvas_instances IS
  '#1493: 画布实例头。(template_key, template_version) 是 I-4 冻结对，写入后永不 UPDATE；'
  'head_version 由 updateSource 的单条 CTE 原子推进。';
COMMENT ON TABLE canvas_instance_versions IS
  '#1493: 追加式 immutable 版本链。updateSource 只追加，历史版本行没有任何改写路径。';

-- 组织冻结（org disabled → 只读）：新租户表必须进冻结范围，三条 AS RESTRICTIVE 策略
-- 由 catalog 推导的帮助函数统一补齐（照 20260817090000_f960 的写法，不手写第二份）。
SELECT kernel_apply_org_freeze_policies();
