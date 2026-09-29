import { describe, expect, it, vi } from 'vitest';
import type { ResolveVisibilityDeps } from '../../src/application/chat/resolve-visibility';
import { canReadChatArtifactSource } from '../../src/application/chat/artifact-source-access';
import { chatArtifactAccess } from '../../src/infrastructure/whiteboard/chat-artifact-access';
import { PgWhiteboardOperationRepository } from '../../src/infrastructure/whiteboard/pg-operation-repository';
import type { TenantSession } from '../../src/application/ports/database.port';
import type { Principal } from '../../src/domain/principal';
const policy = vi.hoisted(() => vi.fn());
vi.mock('../../src/application/chat/resolve-visibility', () => ({ resolveVisibility: policy }));
const principal = { orgId: 'org', userId: 'user' } as Principal;
const deps = {} as ResolveVisibilityDeps;
const input = { orgId: principal.orgId, userId: 'user', projectId: 'project', threadId: 'thread', mode: 'draft', createdBy: 'user' };
function session(landing: unknown) {
  const query = vi.fn(async () => ({ rows: landing ? [landing] : [] }));
  return { query } as unknown as TenantSession & { query: typeof query };
}
describe('Chat source transport uses the existing source visibility boundary', () => {
  it('denies even the artifact creator when the original thread is no longer visible', async () => {
    policy.mockResolvedValue({kind:'denied'});
    expect(await canReadChatArtifactSource(deps,input)).toBe(false);
    expect(policy).toHaveBeenLastCalledWith(deps,input);
  });
  it('denies another user reading a draft even if org-wide authorization allows the thread', async () => {
    policy.mockResolvedValue({kind:'allow'});
    expect(await canReadChatArtifactSource(deps,{...input,createdBy:'other'})).toBe(false);
    expect(await canReadChatArtifactSource(deps,{...input,mode:'pinned',createdBy:'other'})).toBe(true);
  });
  it('fails closed when the original thread has been deleted instead of falling back to artifact ownership', async () => {
    const db=session({thread_id:'thread',existing_thread_id:null,project_id:null,mode:'draft',created_by:'user'});
    expect(await chatArtifactAccess(db,principal,'artifact')).toBe(false);
  });
  it('does not fall back to generic artifact ownership after deletion cascaded the Chat landing',async()=>{
    const query=vi.fn(async(sql:string)=>({rows:sql.includes('provenance_events')?[{}]:[]}));
    expect(await chatArtifactAccess({query} as TenantSession,principal,'artifact')).toBe(false);
    expect(query).toHaveBeenCalledTimes(2);
  });
  it.each(['readArtifactSource','canReadArtifact'] as const)('%s rechecks the Chat policy before reading bytes or an existing layout binding', async method => {
    policy.mockResolvedValue({kind:'denied'});
    const db=session({thread_id:'thread',existing_thread_id:'thread',project_id:'project',mode:'pinned',created_by:'user'});
    const repository=new PgWhiteboardOperationRepository();
    const result=method==='readArtifactSource'?await repository.readArtifactSource(db,principal,'artifact','artifact-v1:1'):await repository.canReadArtifact(db,principal,'artifact','artifact-v1:1','layout');
    expect(result).toBe(method==='readArtifactSource'?null:false);
    expect(db.query).toHaveBeenCalledTimes(1);
  });
  it('marks an authorized Chat source for real materialization integrity verification', async()=>{
    policy.mockResolvedValue({kind:'allow'});
    const query=vi.fn(async(sql:string)=>({rows:sql.includes('chat_artifact_landings')?[{thread_id:'thread',existing_thread_id:'thread',project_id:'project',mode:'draft',created_by:'user'}]:[{version_id:'v7',object_key:'org/artifacts/artifact/v7/content.md',content_hash:'version-digest',version_number:7}]}));
    const result=await new PgWhiteboardOperationRepository().readArtifactSource({query} as TenantSession,principal,'artifact','artifact-v1:7');
    expect(result).toMatchObject({chatMaterialization:{orgId:'org',artifactId:'artifact',versionNumber:7}});
  });
  it('stores layout variants idempotently without replacing the previously verified digest', async () => {
    const values=new Set<string>();
    const query=vi.fn(async(sql:string,params?:readonly unknown[])=>{
      const digest=String(params?.[3]);
      if(sql.startsWith('INSERT')) { expect(sql).toContain('ON CONFLICT(org_id,artifact_id,artifact_version_id,layout_digest) DO NOTHING'); values.add(digest); return {rows:[]}; }
      return {rows:values.has(digest)?[{}]:[]};
    });
    const repository=new PgWhiteboardOperationRepository();
    for(const digest of ['layout-one','layout-two','layout-one']) await repository.issueArtifactLayoutBinding({query} as TenantSession,principal,'artifact','v1',digest);
    expect([...values]).toEqual(['layout-one','layout-two']);
  });
  it('does not swallow a permission dependency outage', async () => {
    policy.mockRejectedValueOnce(new Error('authz_unavailable'));
    await expect(canReadChatArtifactSource(deps,input)).rejects.toThrow('authz_unavailable');
  });
});
