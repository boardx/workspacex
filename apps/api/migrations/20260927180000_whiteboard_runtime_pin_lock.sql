-- app_rw retains SELECT-only registry access. Row locks require UPDATE privilege,
-- so expose exactly one tenant-scoped read/lock operation, never a registry writer.
CREATE OR REPLACE FUNCTION whiteboard_lock_ai_runtime(p_org text,p_actor text,p_delegator text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE published jsonb; registered jsonb;
BEGIN
  IF p_org IS DISTINCT FROM current_setting('app.current_org',true) THEN RETURN NULL; END IF;
  -- Lock order is board (caller), published agent/version, then registry.
  SELECT jsonb_build_object('agentVersionId',v.id,'model',v.model_provider||'/'||v.model_id,'skillVersionIds',v.skill_version_ids)
    INTO published
    FROM public.agents a JOIN public.agent_versions v
      ON v.id=a.published_version_id AND v.agent_id=a.id AND v.org_id=a.org_id AND v.published_at IS NOT NULL
    WHERE a.org_id=p_org AND a.id=p_actor AND a.status='enabled'
    FOR SHARE OF a,v;
  IF published IS NULL THEN RETURN NULL; END IF;
  SELECT jsonb_build_object('actorId',i.actor_id,'kind',i.kind,'delegatedBy',i.delegated_by,
    'scopes',i.scopes,'model',i.model_snapshot,'skill',i.skill_snapshot)
    INTO registered FROM public.whiteboard_actor_identities i
    WHERE i.org_id=p_org AND i.actor_id=p_actor AND i.delegated_by=p_delegator AND i.enabled=true AND i.kind='ai'
    FOR SHARE OF i;
  IF registered IS NULL THEN RETURN NULL; END IF;
  RETURN published||jsonb_build_object('actor',registered);
END;
$$;
REVOKE ALL ON FUNCTION whiteboard_lock_ai_runtime(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whiteboard_lock_ai_runtime(text,text,text) TO app_rw;
