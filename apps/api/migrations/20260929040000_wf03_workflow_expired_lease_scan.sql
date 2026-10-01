/*
 * WF03（Phase 20 work-stack-foundation）—— requirements 02 R3「进程重启后 lease 过期的实例由 worker 接管 resume」。
 *
 * 过期 lease 扫描跨组织，而 workflow_instances / workflow_leases 都是 FORCE RLS（按 app.current_org）。
 * 与 kg_embedding_pending_orgs 同一做法：SECURITY DEFINER 函数只返回 (org_id, instance_id) 两个标识，
 * 不返回任何实例内容；接管本身（epoch CAS 获取 lease、读 checkpoint、推进）全部在该 org 的 withTenant 里做。
 *
 * 只挑仍需 worker 推进的状态（running / cancelling）且**已有** lease 行、lease 已过期的实例：
 *  - 没有 lease 行的实例不挑——start 在建实例与首次 acquire 之间，扫描器抢先会让 start 自己撞 lease_conflict；
 *  - awaiting_gate_decision 等挂起态主动 release 过（expires_at = now()），不是 worker 该接管的。
 * 按过期先后取前 p_limit 条，接管方仍须过 epoch CAS：并发多个扫描器时只有一个赢。
 */
CREATE OR REPLACE FUNCTION wf_expired_lease_instances(p_limit integer DEFAULT 50)
RETURNS TABLE (org_id text, instance_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT i.org_id, i.id
    FROM workflow_instances i
    JOIN workflow_leases l ON l.instance_id = i.id AND l.org_id = i.org_id
   WHERE i.status IN ('running', 'cancelling')
     AND l.expires_at <= now()
   ORDER BY l.expires_at
   LIMIT greatest(1, least(coalesce(p_limit, 50), 500))
$$;

REVOKE ALL ON FUNCTION wf_expired_lease_instances(integer) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT EXECUTE ON FUNCTION wf_expired_lease_instances(integer) TO app_rw;
  END IF;
END
$$;
