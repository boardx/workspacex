import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';
const repo=readFileSync(new URL('../../src/infrastructure/whiteboard/pg-operation-repository.ts',import.meta.url),'utf8');
const service=readFileSync(new URL('../../src/application/whiteboard/operation-service.ts',import.meta.url),'utf8');
describe('whiteboard operation permission boundary',()=>{
  it('limits SQL to private Board, registered actor, artifact ACL and audit tables with tenant predicates',()=>{const tables=[...repo.matchAll(/(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_]+)/gi)].map(match=>match[1]).filter(table=>table!=='OF');expect(new Set(tables)).toEqual(new Set(['whiteboard_operations','whiteboard_documents','whiteboards','whiteboard_members','whiteboard_operation_events','whiteboard_actor_identities','artifacts','artifact_versions','acl_bindings','whiteboard_artifact_layout_bindings']));expect(repo).not.toContain('withoutTenant');expect(repo).toContain('owner_id,archived FROM whiteboards WHERE org_id=$1 AND id=$2 FOR UPDATE');expect(repo).toContain('role FROM whiteboard_members WHERE org_id=$1 AND board_id=$2 AND user_id=$3');expect(repo).toContain('revision_seq>$3');expect(repo).toContain('org_id=$1 AND board_id=$2');});
  it('uses collaboration lock order, authorizes before replay/mutation and gates event disclosure',()=>{expect(repo.indexOf('FROM whiteboards WHERE')).toBeLessThan(repo.indexOf('FROM whiteboard_documents WHERE'));const execute=service.slice(service.indexOf('async execute'),service.indexOf('async events'));expect(execute.indexOf("request.actor.kind==='human'")).toBeLessThan(execute.indexOf('writeCommandsInTransaction'));expect(execute.indexOf('audit.lockHead')).toBeLessThan(execute.indexOf('audit.replay'));expect(execute.indexOf("head.actorRole!=='owner'&&head.actorRole!=='editor'")).toBeLessThan(execute.indexOf('writeCommandsInTransaction'));const events=service.slice(service.indexOf('async events'));expect(events.indexOf('audit.canRead')).toBeLessThan(events.indexOf('audit.events'));});
});
it('uses a tenant/delegator scoped lock function without granting registry UPDATE',async()=>{
 const sql=readFileSync(new URL('../../migrations/20260927180000_whiteboard_runtime_pin_lock.sql',import.meta.url),'utf8');
 expect(sql).toContain("p_org IS DISTINCT FROM current_setting('app.current_org',true)");
 expect(sql).toContain('SECURITY DEFINER SET search_path=pg_catalog');expect(sql).toContain('FOR SHARE OF a,v');expect(sql).toContain('FOR SHARE OF i');
 expect(sql.indexOf('FOR SHARE OF a,v')).toBeLessThan(sql.indexOf('FOR SHARE OF i'));
 expect(sql).toContain("i.delegated_by=p_delegator AND i.enabled=true AND i.kind='ai'");
 expect(sql).toContain('REVOKE ALL ON FUNCTION');expect(sql).not.toMatch(/GRANT[^;]*UPDATE/i);
 const{PgWhiteboardOperationRepository}=await import('../../src/infrastructure/whiteboard/pg-operation-repository');
 const calls:unknown[]=[];const binding={agentVersionId:'v1',model:'p/m',skillVersionIds:['s1'],actor:{skill:'s1'}};
 const session={query:async(sql:string,params:readonly unknown[])=>{calls.push([sql,params]);return{rows:[{binding}]};}};
 expect(await new PgWhiteboardOperationRepository().lockRuntimeActor(session as never,{orgId:'org',userId:'user'} as never,'agent')).toEqual(binding);
 expect(calls).toEqual([['SELECT public.whiteboard_lock_ai_runtime($1,$2,$3) AS binding',['org','agent','user']]]);
});
