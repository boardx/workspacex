/*
 * Phase 18 F06 再追加（组织级抽取开关默认改成开，用户直接交办，非 sprint 排期）——
 * 人类两次明确指令：组织级记忆抽取开关「默认是打开的」。
 *
 * ## 改了什么
 *
 * 迁移 20260925110000（issue #4178）把 `kg_org_extraction_settings` 设计成「没有行 = 默认关」：
 * 列默认 `false`，`kg_enqueue_extraction()` 的闸门二写成 `IF NOT EXISTS (... AND enabled)`——
 * 组织从没设置过就不排队。本迁移把这条语义反过来：
 *
 * 1. `enabled` 列默认值改成 `true`（admin 第一次写入时不显式带值，也是开）。
 * 2. 闸门二改成「**显式关**的行才拦」：`IF EXISTS (... AND NOT enabled)`。没有行 = 从未设置过
 *    = 默认开；只有组织管理员明确关掉（落了一条 `enabled = false`）才不排队。
 *
 * 闸门一（部署级 `kg_extraction_state.enabled`，迁移 20260925120000 已默认开、平台管理员可切换）
 * 与另外两条前置判断（空白 / 原始转录流、单条消息可见范围更窄）一字不改；函数体其余部分逐字
 * 照抄 20260925110000 的定义（20260925120000 没有重定义这个函数），`SECURITY DEFINER` 与
 * `search_path` 钉法不变。
 *
 * ## 为什么不回填既有行
 *
 * 一条已存在的 `enabled = false` 行是组织管理员**明确的选择**（开关 UI 之后才有人能写它），
 * 必须继续关着——把它翻成开等于替管理员推翻他自己的决定。所以这里**不** UPDATE 任何行。
 * devapp 上这张表此时应当还是空的（开关 UI 从未部署过），但这不影响正确性：空表时本迁移的
 * 效果就是「所有组织默认开」，有行时每一行保持原值。
 *
 * ## 隐私取舍（记录在 usecases.md 待决问题里）
 *
 * 新组织的对话内容会被抽取进组织知识图谱，除非管理员主动关闭——这是人类指令明确接受的取舍。
 * 单条消息比会话更窄的可见范围（member-private 等）仍然不抽，那条闸门不变。
 */

ALTER TABLE kg_org_extraction_settings ALTER COLUMN enabled SET DEFAULT true;

-- 与 20260925110000 定义的同一个函数，唯一改动是闸门二：`IF NOT EXISTS (... AND enabled)`
-- → `IF EXISTS (... AND NOT enabled)`。
CREATE OR REPLACE FUNCTION kg_enqueue_extraction() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  -- 原始转录流（raw_transcript）另有管线；只有空白的消息没有可抽的东西。
  -- \s 不含不换行空格 / 零宽空格 / BOM，单独列出（全角空格 \s 已含，列上无妨）。
  IF NEW.raw_transcript OR NEW.body ~ '^[\s ​　﻿]*$' THEN RETURN NULL; END IF;
  -- 单条消息比会话更窄的可见范围（member-private 等）：从它抽出的知识会按整个会话可见，所以不抽。
  IF NEW.visibility_scope IS NOT NULL THEN RETURN NULL; END IF;
  -- 闸门一：这次部署的抽取开关（`kg_extraction_state`，迁移 20260925120000 起默认开、平台管理员可切换）。
  IF NOT EXISTS (SELECT 1 FROM public.kg_extraction_state WHERE enabled) THEN RETURN NULL; END IF;
  -- 闸门二：这个组织自己的开关。默认开（没有行 = 从未设置过 = 开）；只有管理员显式关掉的行才拦。
  IF EXISTS (SELECT 1 FROM public.kg_org_extraction_settings WHERE org_id = NEW.org_id AND NOT enabled) THEN RETURN NULL; END IF;
  INSERT INTO public.kg_extraction_queue (message_id, org_id, thread_id)
  VALUES (NEW.id, NEW.org_id, NEW.thread_id)
  ON CONFLICT (message_id) DO NOTHING;
  RETURN NULL;
END
$$;
-- 触发器本身（DROP/CREATE TRIGGER）不必重来：函数体已 CREATE OR REPLACE，绑定不变。

SELECT kernel_apply_org_freeze_policies();
