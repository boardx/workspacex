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
 const provider={modelRef:'fixed-model',generateImage:vi.fn<ImageGenerator['generateImage']>(async()=>{expect(await objects.get(intentKey)).not.toBeNull();return {delivery:'url' as const,url:'https://provider.test/image.png',taskId:'task-1',modelRef:'fixed-model'};})};
 const downloader={download:vi.fn(async()=>({bytes:Buffer.from('fake unit bytes; real image codec verified in fullchain'),mime:'image/png' as const}))};
 const service=()=>new DefaultStandardImageService(owner,inputs,()=>session,authority,identities,objects,provider,downloader);
 return {service,provider,session,authority,identities,inputs,owner,objects,files,downloader};
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

/**
 * inline 交付（OpenAI `gpt-image-*` 只回 base64，没有 URL 可下载）。
 *
 * 两条断言缺一不可：
 *  ① 走 inline 时**一次也不碰 downloader**——碰了就说明服务还在假设「结果总有个第二跳」，
 *    而 OpenAI 那条根本没有第二跳可走。
 *  ② inline 的字节要在服务这一层就嗅探格式。url 那一支的 `sniffKind` 长在
 *    `GeneratedImageDownloader` 里，inline 根本不经过它；少了这一行，供应商回一段 HTML
 *    错误页也会被原样写进 workspace，直到沙箱里的 Pillow 才炸、还报在错的地方。
 */
const PNG_1X1=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
it('accepts inline bytes without any download hop, and stores the same bytes it was handed',async()=>{
 const f=await setup();
 f.provider.generateImage.mockImplementation(async()=>({delivery:'inline' as const,bytes:PNG_1X1,taskId:'openai:gpt-image-1:1',modelRef:'fixed-model'}));
 const receipt=await f.service().generate(context,args);
 expect(receipt.status).toBe('generated');expect(receipt.mime).toBe('image/png');expect(receipt.taskId).toBe('openai:gpt-image-1:1');
 expect(f.downloader.download).not.toHaveBeenCalled();
 expect(f.files.get(receipt.workspacePath)!.equals(PNG_1X1)).toBe(true);
 expect(receipt.sizeBytes).toBe(PNG_1X1.length);
});
it('rejects inline bytes that are not a real png/jpeg instead of writing them to the workspace',async()=>{
 const f=await setup();
 f.provider.generateImage.mockImplementation(async()=>({delivery:'inline' as const,bytes:Buffer.from('<html>rate limited</html>'),taskId:'t',modelRef:'fixed-model'}));
 await expect(f.service().generate(context,args)).rejects.toThrow('generated_image_format');
 expect(f.files.size).toBe(0);
});
