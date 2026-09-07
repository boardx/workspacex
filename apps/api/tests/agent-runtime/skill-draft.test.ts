import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DefaultSkillDraftService} from '../../src/application/agent-run/skill-draft';
import type {NativeSessionOwner} from '../../src/application/agent-run/native-session-owner';
import type {ToolExecutionAuthority} from '../../src/application/agent-run/tool-execution-authority';
import {FsObjectStore} from '../../src/infrastructure/storage/fs-object-store';
import {toOrgId} from '../../src/domain/org-id';
import {verifySkillStarterPack} from '../../src/domain/skill/starter-pack';
const roots:string[]=[];afterEach(async()=>{for(const path of roots.splice(0))await rm(path,{recursive:true,force:true});});
const context={orgId:toOrgId('draft-org'),parentRunId:'run',attemptId:'run:0',leaseEpoch:1,bindingId:randomUUID(),toolCallId:'actual-call'};
const input={stableName:'example',name:'Example',description:'Example description',semanticVersion:'1.0.0',inputSchema:{},outputSchema:{},dependencies:[{runtime:'python' as const,packages:[]}],files:[{workspacePath:'/workspace/SKILL.md',packagePath:'SKILL.md'},{workspacePath:'/workspace/script.py',packagePath:'scripts/report.py'}]};
async function setup(){
 const dir=await mkdtemp(join(tmpdir(),'wx-draft-'));roots.push(dir);const objects=new FsObjectStore(dir);
 const files=new Map([['/workspace/SKILL.md',Buffer.from('---\nname: example\ndescription: Example description\n---\nRun scripts/report.py.\n')],['/workspace/script.py',Buffer.from('print("ok")\n')]]);
 const session={read:vi.fn(async(path:string)=>{const bytes=files.get(path);if(!bytes)throw new Error('missing');return {path,sizeBytes:bytes.length,contentBase64:bytes.toString('base64')};}),write:vi.fn(async(file:{path:string;contentBase64:string})=>{files.set(file.path,Buffer.from(file.contentBase64,'base64'));return {};})};
 const owner={resolve:vi.fn(async()=>({}))} as unknown as NativeSessionOwner;
 const authority={check:vi.fn<ToolExecutionAuthority['check']>().mockResolvedValue({allowed:true})};
 return {service:new DefaultSkillDraftService(owner,()=>session,authority,objects),session,files,objects,authority};
}
it('writes complete verified draft using real immutable object store and replays without new identity',async()=>{
 const f=await setup(),first=await f.service.create(context,input),second=await f.service.create(context,input);expect(second).toEqual(first);
 const pack=verifySkillStarterPack(JSON.parse(f.files.get(first.workspacePath)!.toString()),first);expect(pack.skills[0]!.files).toHaveLength(2);expect(pack.skills[0]!.manifest.risk_level).toBe('L2');expect(first.status).toBe('artifact_draft');expect(first).not.toHaveProperty('skillId');
 f.files.set('/workspace/script.py',Buffer.from('print("changed")'));
 await expect(f.service.create(context,input)).rejects.toThrow('idempotency_conflict');
 await expect(f.service.create(context,{...input,name:'Changed'})).rejects.toThrow('idempotency_conflict');
});
it('rejects missing dependencies/references, path traversal, binary bytes and unauthorized access before persistence',async()=>{
 const f=await setup();f.authority.check.mockResolvedValueOnce({allowed:false,reason:'approval_required'});await expect(f.service.create(context,input)).rejects.toThrow('denied');expect(f.session.read).not.toHaveBeenCalled();
 await expect(f.service.create(context,{...input,dependencies:[]})).rejects.toThrow('runtime_undeclared');
 await expect(f.service.create(context,{...input,files:[input.files[0]!]})).rejects.toThrow('reference_missing');
 await expect(f.service.create(context,{...input,files:[{workspacePath:'/workspace/../secret',packagePath:'SKILL.md'}]})).rejects.toThrow();
 f.files.set('/workspace/script.py',Buffer.from([255]));await expect(f.service.create(context,input)).rejects.toThrow();expect(f.session.write).not.toHaveBeenCalled();
});
it('concurrent different metadata on the same call has one winner and never overwrites saved draft',async()=>{
 const f=await setup();const result=await Promise.allSettled([f.service.create(context,input),f.service.create(context,{...input,name:'Other'})]);expect(result.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(result.filter(x=>x.status==='rejected')).toHaveLength(1);
 const winner=result.find(x=>x.status==='fulfilled')!;if(winner.status!=='fulfilled')throw new Error();expect(JSON.parse(f.files.get(winner.value.workspacePath)!.toString()).skills[0].name).toBe(result[0]!.status==='fulfilled'?'Example':'Other');
});

it('does not confirm a draft after permission is revoked during workspace write',async()=>{
 const f=await setup();f.authority.check.mockResolvedValueOnce({allowed:true}).mockResolvedValueOnce({allowed:true}).mockResolvedValueOnce({allowed:false,reason:'cancel_requested'});
 await expect(f.service.create(context,input)).rejects.toThrow('denied');expect(f.session.write).toHaveBeenCalledTimes(1);
});
