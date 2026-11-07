import {execFileSync} from 'node:child_process';
import {writeFileSync,mkdirSync} from 'node:fs';
import {resolveImageProfile} from '@repo/contracts/standard-image-tools';
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
it.each([['square',1024],['square-hd',2048]] as const)('verifies real %s PNG bytes with Pillow and persists the selected model',async(sizeProfile,dimension)=>{
 const f=await setup(),selected=resolveImageProfile({sizeProfile});
 Object.assign(f.provider,{resolveRequest:resolveImageProfile});
 const bytes=execFileSync(process.env.WX_IMAGE_PYTHON??'python3',['-c',`from PIL import Image; import sys; Image.new('RGB',(${dimension},${dimension}),'blue').save(sys.stdout.buffer,format='PNG')`]);
 f.downloader.download.mockResolvedValue({bytes,mime:'image/png'});
 f.provider.generateImage.mockImplementation(async(_prompt,_signal,_context,options)=>{expect(options?.sizeProfile).toBe(sizeProfile);return {delivery:'url',url:'https://provider.test/image.png',taskId:'real-pixel-task',modelRef:selected.modelId};});
 const root=await mkdtemp(join(tmpdir(),'wx-pillow-'));roots.push(root);
 f.session.execute.mockImplementation(async input=>{
  for(const [path,data]of f.files){mkdirSync(root+'/workspace',{recursive:true});writeFileSync(root+path,data);}
  const output=execFileSync('sh',['-c',input.command.replace(/^python3 /,`${process.env.WX_IMAGE_PYTHON??'python3'} `).replaceAll('/workspace/',root+'/workspace/')],{encoding:'utf8'});
  return {executionId:input.executionId,exitCode:0,output,timedOut:false,cancelled:false,truncated:false};
 });
 const result=await f.service().generate(context,{...args,sizeProfile});expect(result).toMatchObject({modelRef:selected.modelId,width:dimension,height:dimension});
 expect(await f.service().generate(context,{...args,sizeProfile})).toEqual(result);expect(f.provider.generateImage).toHaveBeenCalledTimes(1);
});
