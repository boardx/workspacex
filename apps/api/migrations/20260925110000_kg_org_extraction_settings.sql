/*
 * Phase 18 F06 追加（issue #4178）—— 记忆抽取的开关从「部署启动参数 + 全库单例」
 * 改成「按组织、落库、可来回切换」。
 *
 * ## 为什么要改
 *
 * 迁移 20260924210000 的 `kg_extraction_state` 是**全库单例、只能 false → true**：
 * 打开/关闭都要改部署配置（`KG_EXTRACTION_ENABLED`）+ 重启，运维成本高，组织管理员做不到；
 * 一旦打开，同一部署下所有组织一起开——抽取涉及从对话内容里提炼知识，是否启用理应是
 * 组织自己的选择，不该由部署方单方面替所有组织决定。
 *
 * ## 两级开关，职责分开
 *
 * 1. **部署级（不变，仍是启动参数）**：这次部署有没有配置抽取用的模型 provider——本质是
 *    密钥 / 基础设施可用性，不适合放进组织可写的表（没有 provider，组织开了也跑不动）。
 *    `kg-extraction-model-config.ts` 的 `enabled` 字段就是这件事，语义收窄为「部署具备能力」。
 * 2. **组织级（本迁移新增）**：`kg_org_extraction_settings`——`org_id` 主键、默认关（新组织
 *    不默认抽取对话内容）、admin 在组织后台可读写、可来回切换（不是只能开一次）。
 *
 * `kg_enqueue_extraction()`（原定义见 20260924210000）改为两个都为真才排队：部署具备能力
 * AND 该组织打开了。`kg_extraction_state` 本身、`kg_extraction_enable()` 与 worker 何时启动
 * 轮询不变——它们回答的仍是「这次部署有没有能力」，不是「该不该对这个组织抽」。
 *
 * ## 写权限怎么落
 *
 * 与 `tool_permission_grants`（Phase 14 F06，issue #3068 的 `listStanding`/`revokeStanding`）
 * 同一形状：这张表背后没有 `ObjectRef` 能表达的 ACL 对象，是组织配置元数据，不是要按内容
 * 披露的租户数据。判据在**应用层**——`knowledge-graph.controller.ts` 的 `requireOrgAdmin`
 * （与 `tool-permission-grant.controller.ts` 同名方法同一实现思路：查 `org_memberships`，
 * `orgRole !== 'admin'` 则 403）。数据库这一侧只按普通租户 RLS 放行同组织读写，
 * 不再叠一层 DB 级角色判定——管理员不是超级用户，但「是不是这个组织的行」已经是 RLS 管的事，
 * 「是不是这个组织的 admin」是应用层的事，两层分工不重叠。
 */

-- ─────────────────────────────── 组织级开关 ───────────────────────────────
CREATE TABLE IF NOT EXISTS kg_org_extraction_settings (
  org_id     text PRIMARY KEY REFERENCES organizations (id) ON DELETE CASCADE,
  enabled    boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- 谁最后改的；系统迁移/回填没有用户身份时为 null。
  updated_by text
);

ALTER TABLE kg_org_extraction_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_org_extraction_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kg_org_extraction_settings_tenant ON kg_org_extraction_settings;
-- 表属主例外（同 F02 kg_is_table_owner 的约定）：`kg_enqueue_extraction` 触发器以属主身份跑，
-- 云上的属主角色不是超级用户、没有 BYPASSRLS（FORCE RLS 对它生效）；它自己的 WHERE org_id = NEW.org_id
-- 已经把范围钉死到这一条消息所属的组织，这里的例外只是让它在会话上下文缺失时也读得到那一行。
CREATE POLICY kg_org_extraction_settings_tenant ON kg_org_extraction_settings
  USING (org_id = current_setting('app.current_org', true) OR (SELECT public.kg_is_table_owner()))
  WITH CHECK (org_id = current_setting('app.current_org', true) OR (SELECT public.kg_is_table_owner()));
-- 读写都走 app_rw（应用层已判过组织 admin 才会调用写方法，见文件头）；没有第二道 DB 角色判定。
REVOKE ALL ON kg_org_extraction_settings FROM app_rw;
GRANT SELECT, INSERT, UPDATE ON kg_org_extraction_settings TO app_rw;

-- ─────────────────────────────── 触发器：加第二个闸门 ───────────────────────────────
-- 与 20260924210000 定义的同一个函数，多加一行 `IF NOT EXISTS ... kg_org_extraction_settings`。
-- 两个 IF NOT EXISTS ... THEN RETURN NULL 都不满足才继续——部署没能力，或组织没打开，都不排队。
CREATE OR REPLACE FUNCTION kg_enqueue_extraction() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  -- 原始转录流（raw_transcript）另有管线；只有空白的消息没有可抽的东西。
  -- \s 不含不换行空格 / 零宽空格 / BOM，单独列出（全角空格 \s 已含，列上无妨）。
  IF NEW.raw_transcript OR NEW.body ~ '^[\s ​　﻿]*$' THEN RETURN NULL; END IF;
  -- 单条消息比会话更窄的可见范围（member-private 等）：从它抽出的知识会按整个会话可见，所以不抽。
  IF NEW.visibility_scope IS NOT NULL THEN RETURN NULL; END IF;
  -- 闸门一：这次部署有没有配置抽取用的模型（`KgExtractionModelConfig.enabled`，worker 启动时置真）。
  IF NOT EXISTS (SELECT 1 FROM public.kg_extraction_state WHERE enabled) THEN RETURN NULL; END IF;
  -- 闸门二（issue #4178 新增）：这个组织自己有没有打开抽取。默认关——新组织不默认抽取对话内容。
  IF NOT EXISTS (SELECT 1 FROM public.kg_org_extraction_settings WHERE org_id = NEW.org_id AND enabled) THEN RETURN NULL; END IF;
  INSERT INTO public.kg_extraction_queue (message_id, org_id, thread_id)
  VALUES (NEW.id, NEW.org_id, NEW.thread_id)
  ON CONFLICT (message_id) DO NOTHING;
  RETURN NULL;
END
$$;
-- 触发器本身（DROP/CREATE TRIGGER）不必重来：函数体已 CREATE OR REPLACE，绑定不变。

SELECT kernel_apply_org_freeze_policies();
