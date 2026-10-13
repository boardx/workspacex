import { interviewMarkdown } from '@repo/contracts';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { InterviewReportFileSource } from '../../src/application/interview/interview-report-file-source';
import { guard } from '../../src/application/security/permission-filter';
import { toOrgId } from '../../src/domain/org-id';
const orgId = toOrgId('org-file-source');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function fixture(projectId: string | null = null) {
 const report: interviewMarkdown.InterviewMarkdownDocument = {documentId:'report-doc',step:'report' as const,version:2,markdown:'# 中文报告\n\n保存的正文',contentHash:digest('# 中文报告\n\n保存的正文'),evidenceMode:'simulated' as const,references:[]};
 const state = {documentId:report.documentId,status:'draft',failure:null};
 const current = {revisionId:'revision-a',version:9,documents:guard({kind:'interview',id:'interview'},[report]),states:[state],review:guard({kind:'interview',id:'interview'},null)};
 const findVisibleById = vi.fn(async (requestedOrg: string) => requestedOrg === orgId ? {item:guard({kind:'interview',id:'interview'},{interviewId:'interview'}),facts:{projectId,createdBy:'owner',isExplicitCollaborator:false}} : null);
 const readCurrent = vi.fn(async()=>current);
 const deps = {repo:{findVisibleById},scope:{projectIdsOf:async()=>projectId?[projectId]:[],orgMembershipOf:async()=>({orgRole:'consultant',teamId:null})},decisions:{next:()=> 'decision'},reader:{readCurrent}};
 return {report,state,current,deps,readCurrent,resolver:new InterviewReportFileSource(deps as never)};
}
describe('canonical interview report file source',()=>{
 it('preserves canonical bytes, document version, personal scope and unapproved simulation notices',async()=>{
  const f=fixture(); const value=await f.resolver.read({orgId,userId:'owner'},'interview');
  expect(value.markdown).toBe(f.report.markdown);expect(value.reportHash).toBe(digest(value.markdown));expect(value.reportVersion).toBe(2);expect(value.notices.join(" ")).toContain(`文档版本 2 · 内容哈希 ${value.reportHash}`);expect(value.projectId).toBeNull();expect(value.notices.join(' ')).toContain('模拟');expect(value.notices.join(' ')).toContain('未批准');
 });
 it('takes project identity from authorized visibility facts',async()=>{expect((await fixture('project').resolver.read({orgId,userId:'owner'},'interview')).projectId).toBe('project');});
 it('rejects outsiders and cross-org without reading canonical content',async()=>{
  for(const actor of [{orgId,userId:'outsider'},{orgId:toOrgId('other'),userId:'owner'}]){const f=fixture();await expect(f.resolver.read(actor,'interview')).rejects.toMatchObject({code:'REPORT_NOT_FOUND'});expect(f.readCurrent).not.toHaveBeenCalled();}
 });
 it.each(['generating','failed','missing'])('rejects unavailable state %s',async status=>{const f=fixture();if(status==='missing')f.current.states=[];else f.state.status=status;await expect(f.resolver.read({orgId,userId:'owner'},'interview')).rejects.toMatchObject({code:'REPORT_UNAVAILABLE'});});
 it('rejects stored hash mismatch',async()=>{const f=fixture();f.report.contentHash='a'.repeat(64);await expect(f.resolver.read({orgId,userId:'owner'},'interview')).rejects.toMatchObject({code:'REPORT_CHANGED'});});
 it('binds revision and document identity even with identical bytes and version',async()=>{
  const f=fixture();const a=await f.resolver.read({orgId,userId:'owner'},'interview');f.current.revisionId='revision-b';const b=await f.resolver.read({orgId,userId:'owner'},'interview');f.report.documentId='other-doc';f.state.documentId='other-doc';const c=await f.resolver.read({orgId,userId:'owner'},'interview');expect(a.reportHash).toBe(c.reportHash);expect(a.bindingKey).not.toBe(b.bindingKey);expect(b.bindingKey).not.toBe(c.bindingKey);
 });
 it('invalidates old bindings when review notes change A to B to A',async()=>{
  const f=fixture();
  const review={reviewId:'review-a',revisionId:f.current.revisionId,documentId:f.report.documentId,documentVersion:f.report.version,contentHash:f.report.contentHash,status:'approved' as const,note:'A',reviewedBy:'owner',reviewedAt:'2026-10-13T00:00:00Z'};
  f.current.review=guard({kind:'interview',id:'interview'},review) as never;
  const a=await f.resolver.read({orgId,userId:'owner'},'interview');
  for(const note of ['B','A']){
   f.current.version++;
   f.current.review=guard({kind:'interview',id:'interview'},{...review,note}) as never;
  }
  const restored=await f.resolver.read({orgId,userId:'owner'},'interview');
  expect(restored.notices).toEqual(a.notices);
  expect(restored.reportVersion).toBe(a.reportVersion);
  expect(restored.reportHash).toBe(a.reportHash);
  expect(restored.bindingKey).not.toBe(a.bindingKey);
 });
 it('rejects a review update between source snapshot and the final version check',async()=>{
  const f=fixture();
  f.readCurrent.mockResolvedValueOnce({...f.current}).mockResolvedValueOnce({...f.current,version:f.current.version+1});
  await expect(f.resolver.read({orgId,userId:'owner'},'interview')).rejects.toMatchObject({code:'REPORT_CHANGED'});
 });
});

describe('saved source and access boundaries',()=>{
 it('rechecks visibility after canonical read',async()=>{
  const f=fixture(); const visible=await f.deps.repo.findVisibleById(orgId);f.deps.repo.findVisibleById.mockReset().mockResolvedValueOnce(visible).mockResolvedValue(null);
  await expect(f.resolver.read({orgId,userId:'owner'},'interview')).rejects.toMatchObject({code:'REPORT_NOT_FOUND'});expect(f.readCurrent).toHaveBeenCalledOnce();
 });
 it('keeps verified saved quotes separate from canonical bytes and omits mismatched private text',async()=>{
  const f=fixture(); const markdown='保存的中文回答';const source={...f.report,documentId:'runs-doc',step:'runs' as const,version:1,markdown,contentHash:digest(markdown)};
  f.report.references=[{anchor:'answer',documentId:source.documentId,version:1,locator:{sourceHash:source.contentHash,start:0,end:markdown.length,quote:markdown,taskKey:null,expertId:null,evidenceMode:'simulated'}}];
  f.current.documents=guard({kind:'interview',id:'interview'},[f.report,source]);
  const result=await f.resolver.read({orgId,userId:'owner'},'interview');expect(result.appendixMarkdown).toContain(markdown);expect(result.reportHash).toBe(digest(f.report.markdown));expect(result.markdown).toBe(f.report.markdown);
  source.markdown='changed private material';source.contentHash=digest(source.markdown);
  const stale=await f.resolver.read({orgId,userId:'owner'},'interview');expect(stale.appendixMarkdown).toBeUndefined();expect(stale.notices.join(' ')).toContain('不可核验');expect(JSON.stringify(stale)).not.toContain('changed private material');
 });
 it('does not trust a stale approved review or remove simulation notices',async()=>{
  const f=fixture();f.current.review=guard({kind:'interview',id:'interview'},{reviewId:'review',revisionId:'older',documentId:f.report.documentId,documentVersion:2,contentHash:f.report.contentHash,status:'approved',note:null,reviewedBy:'owner',reviewedAt:'2026-10-13T00:00:00Z'}) as never;
  expect((await f.resolver.read({orgId,userId:'owner'},'interview')).notices.join(' ')).toContain('未批准');
 });
});

describe('generation eligibility',()=>{
 it.each(['draft','confirmed','completed'])('allows saved %s without an invented approval gate',async status=>{const f=fixture();f.state.status=status;await expect(f.resolver.read({orgId,userId:'owner'},'interview')).resolves.toMatchObject({reportVersion:2});});
 it('propagates storage failures rather than disguising them as denial',async()=>{const f=fixture();f.readCurrent.mockRejectedValue(new Error('storage unavailable'));await expect(f.resolver.read({orgId,userId:'owner'},'interview')).rejects.toThrow('storage unavailable');});
 it('retains mixed evidence and uses actor-scoped reads',async()=>{const f=fixture();f.report.evidenceMode='mixed';expect((await f.resolver.read({orgId,userId:'owner'},'interview')).notices.join(' ')).toContain('混合证据');expect(f.readCurrent).toHaveBeenCalledWith(orgId,'interview');expect(f.deps.repo.findVisibleById).toHaveBeenLastCalledWith(orgId,'owner','interview');});
});

it('keeps long canonical text intact while source metadata respects the shared limits',async()=>{
 const f=fixture();f.report.markdown='# '+ '长标题'.repeat(150)+'\n\n原文不截断。';f.report.contentHash=digest(f.report.markdown);f.report.references=Array.from({length:35},(_,i)=>({anchor:'missing-'+i,documentId:'unavailable-'+i,version:1}));
 const value=await f.resolver.read({orgId,userId:'owner'},'interview');expect(value.title.length).toBe(300);expect(value.markdown).toBe(f.report.markdown);expect(value.notices.length).toBeLessThanOrEqual(30);expect(value.notices.join(' ')).toContain('35 项引用');
});
