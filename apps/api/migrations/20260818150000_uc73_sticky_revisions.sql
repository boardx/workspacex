-- #1493（UC-7.3 第三块）: 便签级修订链 —— `applyStickyChange`（LWW，D-09）的存储层。
--
-- ## 为什么要一张独立的修订表
--
-- 契约 `applyStickyChange` 的注释逐字要求（I-19）：「不弹冲突条，但
-- `supersededRevisionId` 必须能查到被覆盖的那次」。markdown 版本链
-- （canvas_instance_versions）只记「整篇文本长什么样」，不记「哪张便签的哪次
-- 改动覆盖了哪次」——LWW 的判定输入（clientTs）与判定结果（谁生效/谁被覆盖）
-- 需要自己的持久面。每次 applyStickyChange 追加一行；**没有 DELETE 路径**，
-- 输掉 LWW 的迟到改动也落一行（is_current=false）——「不弹冲突条」≠「没有留痕」。
--
-- ## `is_current` 是唯一会被 UPDATE 的列
--
-- 新的生效修订把旧的 current 置 false（同一事务里，见
-- pg-canvas-instance-repository.ts `applyStickyRevision`）。其余列写入后不变——
-- 修订内容 immutable 与版本行同一条纪律，只是 current 指针需要落在行上
-- （部分唯一索引把「每张便签至多一个 current」交给数据库判，不靠应用层自律）。
--
-- ## `client_ts` 存 ISO-8601 原文
--
-- LWW 的「更晚」按 `clientTs` 字符串时间序比较（domain/canvas/sticky-lww.ts
-- 文件头的论证：断线重连的重放请求可能后到但时间戳更早）。存客户端原文
-- 而不是 to_timestamp 解析后的值：判定用的就是这个字符串，解析再序列化
-- 会制造第二份可能漂移的事实。
--
-- RLS/tenant 纪律照抄 20260818090000_uc73_canvas_instances.sql。可独立重放。

CREATE TABLE IF NOT EXISTS canvas_sticky_revisions (
  id           text    PRIMARY KEY,
  org_id       text    NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  instance_id  text    NOT NULL REFERENCES canvas_instances (id) ON DELETE CASCADE,
  -- 文档序派生 id（source-projection.ts：`st-<n>`，不落库、跨版本可能重排——
  -- 修订按「调用那一刻的 stickyId」记账，这是契约 in/out 用的同一个 id 空间）。
  sticky_id    text    NOT NULL,
  -- 契约 `applyStickyChange.in.patch` 原形（text/color/size/position/sectionId 的子集）。
  patch        jsonb   NOT NULL,
  -- LWW 判定输入，客户端 ISO-8601 原文（见文件头）。
  client_ts    text    NOT NULL,
  -- true = 这张便签当前生效的修订；false = 历史（被覆盖的，或输掉 LWW 的迟到写）。
  is_current   boolean NOT NULL,
  created_by   text    NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- 每张便签至多一个 current——判定在数据库，不先查后写。
CREATE UNIQUE INDEX IF NOT EXISTS canvas_sticky_revisions_current_uniq
  ON canvas_sticky_revisions (instance_id, sticky_id) WHERE is_current;

CREATE INDEX IF NOT EXISTS canvas_sticky_revisions_sticky_idx
  ON canvas_sticky_revisions (org_id, instance_id, sticky_id);

ALTER TABLE canvas_sticky_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE canvas_sticky_revisions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS canvas_sticky_revisions_tenant ON canvas_sticky_revisions;
CREATE POLICY canvas_sticky_revisions_tenant ON canvas_sticky_revisions
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

-- UPDATE 仅为 is_current 指针翻转（见文件头）；没有 DELETE——历史修订不可删。
GRANT SELECT, INSERT, UPDATE ON canvas_sticky_revisions TO app_rw;

COMMENT ON TABLE canvas_sticky_revisions IS
  '#1493: applyStickyChange 的便签级 LWW 修订链（I-19：supersededRevisionId 可回查）。'
  '追加式；仅 is_current 指针可 UPDATE，无 DELETE 路径。';

SELECT kernel_apply_org_freeze_policies();
