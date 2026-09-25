/*
 * Phase 18 F13 —— 每一轮回答用到了哪些记忆（uc-18-2 R8 引用 chip / 「为什么用到它」，uc-18-4 R3-6）。
 *
 * 执行器在召回之后写一行（一个 agent run 一行，重试覆盖）；读接口经 chat_messages.agent_run_id 找到
 * 这条回答对应的那一行。这里只存 id 与召回理由，不存结论正文：读的时候按查看者重新读 canonical，
 * 已失效的条目自然不再返回，个人空间的条目由 claims 的 RLS 只放给本人（I-14）。
 */
CREATE TABLE IF NOT EXISTS kg_turn_recalls (
  run_id            text PRIMARY KEY,
  org_id            text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  thread_id         text NOT NULL,
  requester_user_id text NOT NULL,
  -- [{ claimId, channels, retrievalReasons, score, graphPath: [{ src, relation, dst }] | null }]，按召回名次
  items             jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(items) = 'array'),
  -- 这一轮计划走图路，但图路没能执行（AGE 不可用）
  graph_degraded    boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kg_turn_recalls_thread_idx ON kg_turn_recalls (org_id, thread_id);

ALTER TABLE kg_turn_recalls ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_turn_recalls FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kg_turn_recalls_tenant ON kg_turn_recalls;
CREATE POLICY kg_turn_recalls_tenant ON kg_turn_recalls
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));
REVOKE ALL ON kg_turn_recalls FROM app_rw;
GRANT SELECT, INSERT, UPDATE ON kg_turn_recalls TO app_rw;

-- 停用组织的冻结策略（F22 单一事实源，新租户表建完调用一次）
SELECT kernel_apply_org_freeze_policies();
