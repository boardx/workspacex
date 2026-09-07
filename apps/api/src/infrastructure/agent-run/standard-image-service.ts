import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {ImageGenerateInput,ImageGenerated,IMAGE_GENERATE_TOOL,IMAGE_GENERATE_LIMITS as L} from '@repo/contracts/standard-image-tools';
import {schemas} from '@repo/contracts/sandbox-session';
import type {z} from 'zod';
import type {NativeSessionOwner,NativeResolved} from '../../application/agent-run/native-session-owner';
import type {NativeRunInputs} from '../../application/agent-run/native-run-inputs';
import type {ToolExecutionAuthority} from '../../application/agent-run/tool-execution-authority';
import type {ImageContext,StandardImageService,ImageGenerator,ImageSession,GeneratedImageDownloader} from '../../application/agent-run/standard-image-tools';
import {ObjectExistsError,type ObjectStore} from '../../application/artifact/ports';
import type {IdentityRepository} from '../../application/identity/ports';
import {isLocalOrg} from '../../domain/identity/local-org';
const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const quote=(value:string)=>"'"+value.replaceAll("'","'\\''")+"'";
export class DefaultStandardImageService implements StandardImageService{
 constructor(private owner:NativeSessionOwner,private inputs:NativeRunInputs,private sessions:(bound:NativeResolved)=>ImageSession,
  private authority:Pick<ToolExecutionAuthority,'check'>,private identities:Pick<IdentityRepository,'findOrganization'>,private objects:ObjectStore,private provider:ImageGenerator,private downloader:GeneratedImageDownloader){}
 async generate(context:ImageContext,raw:z.infer<typeof ImageGenerateInput>){
  const input=ImageGenerateInput.parse(raw),signal=AbortSignal.timeout(L.deadlineMs);
  const authorize=async()=>{signal.throwIfAborted();if(!(await this.authority.check({...context,toolName:IMAGE_GENERATE_TOOL,toolArgs:input})).allowed)throw new Error('image_generation_denied');};
  await authorize();const bound=await this.owner.resolve(context.bindingId,context),session=this.sessions(bound);
  const org=await this.identities.findOrganization(context.orgId);if(!org||isLocalOrg(org.kind))throw new Error('image_generation_egress_denied');
  if(input.referenceAttachmentIds?.length){
   const current=await this.inputs.read(context);
   for(const id of input.referenceAttachmentIds){const pinned=bound.inputs.find(f=>f.attachmentId===id),actual=current.manifest.find(f=>f.attachmentId===id);
    if(!pinned||!actual||pinned.digest!==actual.digest||pinned.sizeBytes!==actual.sizeBytes||!['image/png','image/jpeg'].includes(actual.mediaType))throw new Error('image_reference_denied');}
   throw new Error('image_editing_unsupported');
  }
  const prefix=`image-generation/${hash(context.orgId)}/${hash(context.parentRunId)}/${hash(input.idempotencyKey)}`;
  const intent=Buffer.from(JSON.stringify({request:input,modelRef:this.provider.modelRef}));
  await authorize();await this.owner.resolve(context.bindingId,context);
  let created=false;
  try{await this.objects.putOnce(`${prefix}/intent.json`,intent,'application/json');created=true;}catch(e){if(!(e instanceof ObjectExistsError))throw e;}
  const persisted=await this.objects.get(`${prefix}/intent.json`);if(!persisted||!Buffer.from(persisted).equals(intent))throw new Error('image_generation_idempotency_conflict');
  let receipt:z.infer<typeof ImageGenerated>,bytes:Uint8Array;
  if(!created){
   const head=await this.objects.head(`${prefix}/result.json`);if(!head||head.sizeBytes>L.responseBytes)throw new Error('image_generation_unknown_outcome_no_resubmit');
   const result=await this.objects.get(`${prefix}/result.json`);if(!result||result.length!==head.sizeBytes)throw new Error('image_generation_result_unavailable');
   receipt=ImageGenerated.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(result)));
   const imageHead=await this.objects.head(`${prefix}/image`);if(!imageHead||imageHead.sizeBytes!==receipt.sizeBytes||imageHead.mime!==receipt.mime)throw new Error('image_generation_result_unavailable');
   const saved=await this.objects.get(`${prefix}/image`);if(!saved||saved.length!==receipt.sizeBytes||hash(saved)!==receipt.sha256)throw new Error('image_generation_result_unavailable');bytes=saved;
  }else{
   // The immutable intent is durable before any billable vendor submission.
   const cancellation=new AbortController(),stopWatch=new AbortController();
   const watch=(async()=>{try{while(true){await delay(1000,undefined,{signal:stopWatch.signal});await this.owner.resolve(context.bindingId,context);}}catch{if(!stopWatch.signal.aborted)cancellation.abort();}})();
   let generated:Awaited<ReturnType<ImageGenerator['generateImage']>>;
   try{await authorize();generated=await this.provider.generateImage(input.prompt,AbortSignal.any([signal,cancellation.signal]));}
   finally{stopWatch.abort();await watch;}
   if(generated.modelRef!==this.provider.modelRef)throw new Error('image_generation_model_changed');
   await authorize();await this.owner.resolve(context.bindingId,context);
   const downloaded=await this.downloader.download(generated.url,signal);bytes=downloaded.bytes;
   if(!bytes.length||bytes.length>L.maxBytes)throw new Error('generated_image_size');
   const workspacePath=`/workspace/generated-${hash(input.idempotencyKey)}.${downloaded.mime==='image/png'?'png':'jpg'}`;
   await session.write({path:workspacePath,contentBase64:Buffer.from(bytes).toString('base64')});
   const code="from PIL import Image; import io,hashlib; from pathlib import Path; p="+JSON.stringify(workspacePath)+"; data=Path(p).read_bytes(); assert hashlib.sha256(data).hexdigest()=='"+hash(bytes)+"'; im=Image.open(io.BytesIO(data)); assert im.format in ('PNG','JPEG'); assert im.size==("+L.dimension+","+L.dimension+"); im.verify(); im=Image.open(io.BytesIO(data)); im.load(); print('VERIFIED_IMAGE')";
   await authorize();await this.owner.resolve(context.bindingId,context);
   const execution={executionId:randomUUID(),command:`python3 -c ${quote(code)}`,timeoutMs:L.verifyMs},verification=await session.execute(execution);
   if(verification.executionId!==execution.executionId||verification.exitCode!==0||verification.timedOut||verification.cancelled||verification.truncated||!verification.output.includes('VERIFIED_IMAGE'))throw new Error('generated_image_invalid');
   receipt=ImageGenerated.parse({status:'generated',workspacePath,mime:downloaded.mime,width:L.dimension,height:L.dimension,sha256:hash(bytes),sizeBytes:bytes.length,modelRef:generated.modelRef,taskId:generated.taskId});
   await this.objects.putOnce(`${prefix}/image`,bytes,receipt.mime);
   const saved=await this.objects.get(`${prefix}/image`);if(!saved||saved.length!==bytes.length||hash(saved)!==receipt.sha256)throw new Error('image_generation_readback_failed');
   await this.objects.putOnce(`${prefix}/result.json`,Buffer.from(JSON.stringify(receipt)),'application/json');
  }
  const expectedPath=`/workspace/generated-${hash(input.idempotencyKey)}.${receipt.mime==='image/png'?'png':'jpg'}`;
  if(receipt.workspacePath!==expectedPath||receipt.modelRef!==this.provider.modelRef)throw new Error('image_generation_result_invalid');
  await authorize();await this.owner.resolve(context.bindingId,context);
  await session.write({path:receipt.workspacePath,contentBase64:Buffer.from(bytes).toString('base64')});
  const check=schemas.file.parse(await session.read(receipt.workspacePath));if(check.path!==receipt.workspacePath||check.sizeBytes!==bytes.length||check.contentBase64!==Buffer.from(bytes).toString('base64'))throw new Error('image_generation_readback_failed');
  await authorize();await this.owner.resolve(context.bindingId,context);return receipt;
 }
}
