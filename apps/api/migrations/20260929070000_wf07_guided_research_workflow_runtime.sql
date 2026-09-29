/*
 * WF07（Phase 20 work-stack-foundation）—— 引导式研究迁到通用 Workflow Runtime（ADR-118 第 8 条 Stage 1；
 * 02-workflow-runtime.md R3-12 / E12）。数字访谈不迁（Stage 2）。
 *
 * ① checkpoint：langgraph_interview 里 checkpoint_ns = 'guided-research:v1' 的线程，逐线程搬到
 *    langgraph_workflow（checkpoint_ns = 'guided-research:1' = 图工厂注册键，thread_id 不变 = sessionId）。
 *    每个线程一个子事务（BEGIN … EXCEPTION）：搬不动的线程回滚、原数据只读保留，不静默丢弃；
 *    未迁清单由 `reportGuidedResearchMigration`（scripts/lib/guided-research-stage1-migration.ts）读出（期望 0）。
 *    旧行不删：回滚窗口内仍可对照；新运行时再也不读它们。
 * ② receipt：guided_research_node_receipts → workflow_receipts（scope='command'，
 *    request_key = 'guided-research:<sessionId>:<requestId>'，沿用 begin/finalize 形状：pending→begun）。
 *    两张表都 FORCE RLS，所以按组织设置 app.current_org 再搬（迁移账号不一定有 BYPASSRLS）。
 * 全部 ON CONFLICT DO NOTHING：可重放。
 */
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT DISTINCT thread_id FROM langgraph_interview.checkpoints WHERE checkpoint_ns = 'guided-research:v1'
  LOOP
    BEGIN
      INSERT INTO langgraph_workflow.checkpoints
        (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata)
      SELECT thread_id, 'guided-research:1', checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata
        FROM langgraph_interview.checkpoints
       WHERE thread_id = t.thread_id AND checkpoint_ns = 'guided-research:v1'
      ON CONFLICT DO NOTHING;
      INSERT INTO langgraph_workflow.checkpoint_blobs (thread_id, checkpoint_ns, channel, version, type, blob)
      SELECT thread_id, 'guided-research:1', channel, version, type, blob
        FROM langgraph_interview.checkpoint_blobs
       WHERE thread_id = t.thread_id AND checkpoint_ns = 'guided-research:v1'
      ON CONFLICT DO NOTHING;
      INSERT INTO langgraph_workflow.checkpoint_writes
        (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, blob)
      SELECT thread_id, 'guided-research:1', checkpoint_id, task_id, idx, channel, type, blob
        FROM langgraph_interview.checkpoint_writes
       WHERE thread_id = t.thread_id AND checkpoint_ns = 'guided-research:v1'
      ON CONFLICT DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'WF07: guided research thread % not migrated: %', t.thread_id, SQLERRM;
    END;
  END LOOP;
END $$;

DO $$
DECLARE
  o record;
BEGIN
  FOR o IN SELECT id FROM organizations LOOP
    PERFORM set_config('app.current_org', o.id, true);
    INSERT INTO workflow_receipts
      (org_id, scope, request_key, fingerprint, status, checkpoint_id, stable_response, created_at, finalized_at)
    -- 不丢行（WF07 review / E12）：finalized 但 stable_response 为 NULL 的旧 receipt 没有可回放的响应，
    -- 迁成 'begun'（保留指纹）——旧实现对它的行为本来就是「无 stableResponse → REPLAY_MISMATCH」，
    -- 新适配器 find() 对 begun 行给出同样结果，所以语义不变且没有任何旧 receipt 被静默丢弃。
    SELECT org_id, 'command', 'guided-research:' || session_id || ':' || request_id, payload_fingerprint,
           CASE WHEN status = 'finalized' AND stable_response IS NOT NULL THEN 'finalized' ELSE 'begun' END,
           checkpoint_id,
           CASE WHEN status = 'finalized' AND stable_response IS NOT NULL THEN stable_response ELSE NULL END,
           created_at,
           CASE WHEN status = 'finalized' AND stable_response IS NOT NULL THEN COALESCE(finalized_at, created_at) ELSE NULL END
      FROM guided_research_node_receipts
     WHERE org_id = o.id
    ON CONFLICT DO NOTHING;
  END LOOP;
  PERFORM set_config('app.current_org', '', true);
END $$;
