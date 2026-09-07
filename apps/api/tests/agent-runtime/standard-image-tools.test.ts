import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {DefaultStandardImageService} from '../../src/infrastructure/agent-run/standard-image-service';
import {FsObjectStore} from '../../src/infrastructure/storage/fs-object-store';
import type {NativeSessionOwner} from '../../src/application/agent-run/native-session-owner';
import type {ImageGenerator,ImageSession} from '../../src/application/agent-run/standard-image-tools';
import type {ToolExecutionAuthority} from '../../src/application/agent-run/tool-execution-authority';
import type {IdentityRepository} from '../../src/application/identity/ports';
import {toOrgId} from '../../src/domain/org-id';
const context={orgId:toOrgId('image-org'),parentRunId:'run',attemptId:'run:0',leaseEpoch:1,bindingId:randomUUID(),toolCallId:'call'};
const args={prompt:'A blue square',sizeProfile:'square' as const,idempotencyKey:'image-1'};
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function setup(){
 const root=await mkdtemp(join(tmpdir(),'wx-image-'));roots.push(root);const objects=new FsObjectStore(root),files=new Map<string,Buffer>();
 const owner={resolve:vi.fn(async()=>({inputs:[]}))} as unknown as NativeSessionOwner;
 const inputs={read:vi.fn(async()=>({manifest:[],files:[]}))};
 const session={read:vi.fn(async(path:string)=>({path,sizeBytes:files.get(path)!.length,contentBase64:files.get(path)!.toString('base64')})),write:vi.fn(async(f:{path:string;contentBase64:string})=>{files.set(f.path,Buffer.from(f.contentBase64,'base64'));}),execute:vi.fn<ImageSession['execute']>(async input=>({executionId:input.executionId,exitCode:0,output:'VERIFIED_IMAGE',timedOut:false,truncated:false,cancelled:false}))};
 const authority={check:vi.fn<ToolExecutionAuthority['check']>().mockResolvedValue({allowed:true})};
 const identities={findOrganization:vi.fn<IdentityRepository['findOrganization']>().mockResolvedValue({kind:'shared'} as never)};
 const intentKey=`image-generation/${hash(context.orgId)}/${hash(context.parentRunId)}/${hash(args.idempotencyKey)}/intent.json`;
 const provider={modelRef:'fixed-model',generateImage:vi.fn<ImageGenerator['generateImage']>(async()=>{expect(await objects.get(intentKey)).not.toBeNull();return {url:'https://provider.test/image.png',taskId:'task-1',modelRef:'fixed-model'};})};
 const downloader={download:vi.fn(async()=>({bytes:Buffer.from('fake unit bytes; real image codec verified in fullchain'),mime:'image/png' as const}))};
 const service=()=>new DefaultStandardImageService(owner,inputs,()=>session,authority,identities,objects,provider,downloader);
 return {service,provider,session,authority,identities,inputs,owner,objects,files};
}
it('persists intent before submission and restores completed bytes across service restart/new toolCall without resubmission',async()=>{
 const f=await setup(),first=await f.service().generate(context,args);expect(first.status).toBe('generated');expect(first).not.toHaveProperty('artifactId');expect(first).not.toHaveProperty('url');
 expect(await f.service().generate({...context,toolCallId:'recovery-call'},args)).toEqual(first);expect(f.provider.generateImage).toHaveBeenCalledTimes(1);
 await expect(f.service().generate(context,{...args,prompt:'changed'})).rejects.toThrow('idempotency_conflict');expect(f.provider.generateImage).toHaveBeenCalledTimes(1);
});
it('never resubmits an unknown outcome after a restart',async()=>{
 const f=await setup();f.provider.generateImage.mockRejectedValueOnce(new Error('submission acknowledgement lost'));
 await expect(f.service().generate(context,args)).rejects.toThrow();await expect(f.service().generate(context,args)).rejects.toThrow('unknown_outcome_no_resubmit');expect(f.provider.generateImage).toHaveBeenCalledTimes(1);
});
it('concurrent same-key intents allow only one vendor submission',async()=>{
 const f=await setup();const results=await Promise.allSettled([f.service().generate(context,args),f.service().generate({...context,toolCallId:'call-2'},args)]);
 expect(results.some(r=>r.status==='fulfilled')).toBe(true);expect(f.provider.generateImage).toHaveBeenCalledTimes(1);
});
it('denies local egress, unauthorized tool calls and inaccessible references before vendor submission',async()=>{
 const f=await setup();f.authority.check.mockResolvedValueOnce({allowed:false,reason:'approval_required'});await expect(f.service().generate(context,args)).rejects.toThrow('denied');
 await expect(f.service().generate(context,{...args,referenceAttachmentIds:['another-user-image']})).rejects.toThrow('reference_denied');
 f.identities.findOrganization.mockResolvedValueOnce({kind:'personal-local'} as never);await expect(f.service().generate(context,args)).rejects.toThrow('egress_denied');expect(f.provider.generateImage).not.toHaveBeenCalled();
});
it('a permitted reference is explicitly unsupported rather than silently ignored',async()=>{
 const f=await setup(),reference={attachmentId:'own',digest:'a'.repeat(64),sizeBytes:10,mediaType:'image/png'};
 vi.mocked(f.owner.resolve).mockResolvedValue({inputs:[reference]} as never);f.inputs.read.mockResolvedValue({manifest:[reference],files:[]} as never);
 await expect(f.service().generate(context,{...args,referenceAttachmentIds:['own']})).rejects.toThrow('editing_unsupported');expect(f.provider.generateImage).not.toHaveBeenCalled();
});
it('a codec failure returns no image receipt and no retry of the vendor',async()=>{
 const f=await setup();f.session.execute.mockImplementation(async input=>({executionId:input.executionId,exitCode:1,output:'bad image',timedOut:false,truncated:false,cancelled:false}));
 await expect(f.service().generate(context,args)).rejects.toThrow('generated_image_invalid');await expect(f.service().generate(context,args)).rejects.toThrow('unknown_outcome');expect(f.provider.generateImage).toHaveBeenCalledTimes(1);
});
