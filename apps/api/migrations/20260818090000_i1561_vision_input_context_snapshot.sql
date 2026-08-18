-- P2（#1561，缺口背景 #1558）：给 F157 的 `agent_run_context_snapshots` 补三列，记录
-- 「本轮到底有几张图真的送进了模型的眼睛、有几张没送成、为什么」。
--
-- 同 F156 的 `l3_retrieval_scope` / F190 的 `tool_trace_*` 一样是最小映射列，不新建表——
-- 遵循该表自己头注写下的既有先例（"一份可独立检索的结构化事实 = 一张表，追加列而不是
-- 发明第二套记录方式"）。
--
-- ## 为什么 `vision_status` 是四态而不是复用三态
--
-- L2/L3/tool_trace 用的 `ok/degraded/not_configured` 三态里，没有「这一轮根本没图」与
-- 「有图但这个模型看不到」的区别。#1558 里用户实际撞上的正是后者（产品允许传图、模型
-- 看不到、且没有任何一层告诉过用户），把它和"没图"糊成同一个值，等于让审计链恰好在
-- 最需要看清的那一格上失明。语义唯一事实源在 `context-snapshot.ts` 的
-- `AgentRunContextSnapshotInput.visionStatus` 文档，这里不复述。
--
-- 可重放：ADD COLUMN IF NOT EXISTS 全程。

ALTER TABLE agent_run_context_snapshots
  ADD COLUMN IF NOT EXISTS vision_status text
    CHECK (vision_status IS NULL OR vision_status IN ('none', 'not_configured', 'not_supported', 'degraded', 'ok')),
  ADD COLUMN IF NOT EXISTS vision_image_count integer
    CHECK (vision_image_count IS NULL OR vision_image_count >= 0),
  ADD COLUMN IF NOT EXISTS vision_omitted_count integer
    CHECK (vision_omitted_count IS NULL OR vision_omitted_count >= 0);

-- 历史行（本迁移之前写入的快照）这三列是 NULL——那些 run 确实没有图像输入这一层参与
-- （本 PR 落地前 `ModelCallInput` 根本没有图像位，见 #1558 的逐层确诊），读侧按 `null`
-- 视为 `"none"` 处理（`pg-agent-run-context-snapshot.ts` 的 `toVisionStatus`），
-- 不回填一个编造的值。

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'agent_run_context_snapshots' AND column_name = 'vision_status'
  ) THEN
    RAISE EXCEPTION 'agent_run_context_snapshots.vision_status did not get created';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'agent_run_context_snapshots' AND column_name = 'vision_image_count'
  ) THEN
    RAISE EXCEPTION 'agent_run_context_snapshots.vision_image_count did not get created';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'agent_run_context_snapshots' AND column_name = 'vision_omitted_count'
  ) THEN
    RAISE EXCEPTION 'agent_run_context_snapshots.vision_omitted_count did not get created';
  END IF;
END
$$;
