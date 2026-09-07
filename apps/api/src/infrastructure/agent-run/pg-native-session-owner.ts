import { createCipheriv,createDecipheriv,createHash,randomBytes,randomUUID } from "node:crypto";
import { NativeSessionResolved,NativeInputManifest,canonicalNativeInputs,canonicalNativePackageSet } from "@repo/contracts/native-session-binding";
import { TrustedSkillPackage } from "@repo/contracts/standard-capabilities";
import { canonicalSkillPackageManifest } from "@repo/contracts/skill-package-manifest";
import type { DatabasePort } from "../../application/ports/database.port";
import type { NativeSessionOwner,NativeSessionTransport,NativePins } from "../../application/agent-run/native-session-owner";
import type { ExecutionAuthorityContext,ToolAuthorityReader } from "../../application/agent-run/tool-execution-authority";
import type { NativeRunInputs } from "../../application/agent-run/native-run-inputs";
import { limits } from "@repo/contracts/sandbox-session";
type Row={input_manifest:unknown;input_digest:string|null;id:string;org_id:string;run_id:string;status:string;session_id:string;token_cipher:string;expires_at:string;package_digest:string;interrupt_on:Record<string,boolean>};
const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
export class PgNativeSessionOwner implements NativeSessionOwner {
 #key:Buffer;
 constructor(private db:DatabasePort,private authority:ToolAuthorityReader,private transport:NativeSessionTransport,keyHex:string,private inputs?:NativeRunInputs){
  if(!/^[a-f0-9]{64}$/.test(keyHex))throw new Error('native_session_key_unavailable');this.#key=Buffer.from(keyHex,'hex');
 }
 private authorized<T>(context:ExecutionAuthorityContext,fn:()=>Promise<T>){
  return this.authority.withSnapshot(context,async s=>{
   if(!s||!s.active||s.cancelRequested||!s.leaseValid||s.attemptId!==context.attemptId)throw new Error('native_session_authority_denied');
   return fn();
  });
 }
 private crypt(row:Pick<Row,'id'|'org_id'|'run_id'|'session_id'>,value:string,encrypt:boolean){
  const aad=Buffer.from(JSON.stringify([row.id,row.org_id,row.run_id,row.session_id]));
  try {
   if(encrypt){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.#key,iv);cipher.setAAD(aad);const body=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64');}
   const bytes=Buffer.from(value,'base64'),dec=createDecipheriv('aes-256-gcm',this.#key,bytes.subarray(0,12));dec.setAAD(aad);dec.setAuthTag(bytes.subarray(12,28));return Buffer.concat([dec.update(bytes.subarray(28)),dec.final()]).toString('utf8');
  }catch{throw new Error('native_session_secret_unavailable');}
 }
 async provision(context:ExecutionAuthorityContext,pins:NativePins,interruptOn:Record<string,boolean>){
  const parsed=pins.map(p=>({...p,package:TrustedSkillPackage.parse(p.package)}));
  const digest=hash(canonicalNativePackageSet(parsed.map(p=>({stableName:p.stableName,skillId:p.package.skillId,versionId:p.package.versionId,packageDigest:hash(canonicalSkillPackageManifest(p.package.files))}))));
  for(const p of parsed)for(const f of p.package.files)if(hash(Buffer.from(f.contentBase64,'base64'))!==f.digest)throw new Error('native_package_digest_mismatch');
  const policy=NativeSessionResolved.shape.interruptOn.parse(interruptOn);
  const inputSet=await this.authorized(context,async()=>this.inputs?this.inputs.read(context):{manifest:[],files:[]});
  const inputManifest=NativeInputManifest.parse(inputSet.manifest);
  if(inputManifest.length!==inputSet.files.length)throw new Error("native_input_manifest_mismatch");
  for(const item of inputManifest){const file=inputSet.files.find(f=>f.path===item.path);if(!file)throw new Error("native_input_manifest_mismatch");const bytes=Buffer.from(file.contentBase64,"base64");if(bytes.toString("base64")!==file.contentBase64||bytes.length!==item.sizeBytes||hash(bytes)!==item.digest)throw new Error("native_input_manifest_mismatch");}
  const inputDigest=hash(canonicalNativeInputs(inputManifest));
  const skillFiles=parsed.flatMap(p=>p.package.files.map(f=>({path:`/skills/${p.stableName}/${f.path}`,contentBase64:f.contentBase64})));
  if(Buffer.byteLength(JSON.stringify({skills:skillFiles,inputs:inputSet.files}))>limits.maxRequestBytes)throw new Error("native_input_limit");
  const row=await this.authorized(context,()=>this.db.withTenant(context.orgId,async s=>{
   const id=randomUUID();const inserted=await s.query<Row>(`INSERT INTO native_session_bindings(id,org_id,run_id,status,package_digest,interrupt_on,input_manifest,input_digest) VALUES($1,$2,$3,'provisioning',$4,$5::jsonb,$6::jsonb,$7) ON CONFLICT(org_id,run_id) DO NOTHING RETURNING *`,[id,context.orgId,context.parentRunId,digest,JSON.stringify(policy),JSON.stringify(inputManifest),inputDigest]);
   if(inserted.rows[0])return {...inserted.rows[0],fresh:true};
   const existing=(await s.query<Row>('SELECT * FROM native_session_bindings WHERE org_id=$1 AND run_id=$2',[context.orgId,context.parentRunId])).rows[0]!;
   if((existing.input_digest??hash(canonicalNativeInputs([])))!==inputDigest||canonicalNativeInputs(NativeInputManifest.parse(existing.input_manifest))!==canonicalNativeInputs(inputManifest)||existing.status!=='ready'||Number(existing.expires_at)<=Date.now()||existing.package_digest!==digest||JSON.stringify(Object.entries(existing.interrupt_on).sort())!==JSON.stringify(Object.entries(policy).sort()))throw new Error('native_session_existing_binding_unavailable');
   return {...existing,fresh:false};
  }));
  if(row.fresh){
   let known: {sessionId:string;token:string;expiresAt:number}|undefined;
   try{
    known=await this.transport.create(skillFiles,inputSet.files);
    const valid=NativeSessionResolved.parse({...known,interruptOn:policy,packageDigest:digest});
    const cipher=this.crypt({...row,session_id:valid.sessionId},valid.token,true);
    await this.authorized(context,()=>this.db.withTenant(context.orgId,async s=>{
     const updated=await s.query("UPDATE native_session_bindings SET status='ready',session_id=$3,token_cipher=$4,expires_at=$5 WHERE org_id=$1 AND id=$2 AND status='provisioning' RETURNING id",[context.orgId,row.id,valid.sessionId,cipher,valid.expiresAt]);
     if(updated.rows.length!==1)throw new Error('native_session_ready_conflict');
     await s.query("UPDATE agent_runs SET runtime_profile='native-v1' WHERE org_id=$1 AND id=$2",[context.orgId,context.parentRunId]);
    }));
   }catch{
    if(known){
     const cipher=this.crypt({...row,session_id:known.sessionId},known.token,true);
     // Keep known credentials for retry if compensation is interrupted. If DB is
     // unavailable, still attempt physical cleanup; never report that it succeeded.
     try{await this.db.withTenant(context.orgId,s=>s.query("UPDATE native_session_bindings SET status='release_pending',session_id=$3,token_cipher=$4,expires_at=$5 WHERE org_id=$1 AND id=$2",[context.orgId,row.id,known!.sessionId,cipher,known!.expiresAt]));}catch{}
     try{
      await this.transport.destroy(known.sessionId,known.token);
      await this.db.withTenant(context.orgId,s=>s.query("UPDATE native_session_bindings SET status='released',token_cipher=NULL WHERE org_id=$1 AND id=$2",[context.orgId,row.id]));
     }catch{throw new Error('native_session_compensation_unconfirmed');}
    }else{
     await this.db.withTenant(context.orgId,s=>s.query("UPDATE native_session_bindings SET status='failed' WHERE org_id=$1 AND id=$2 AND status='provisioning'",[context.orgId,row.id]));
    }
    throw new Error('native_session_provision_failed_no_replay');
   }
  }
  return {bindingId:row.id,profile:'native-v1' as const,policy:'native-v1' as const};
 }
 async resolve(bindingId:string,context:ExecutionAuthorityContext){return this.authorized(context,()=>this.db.withTenant(context.orgId,async s=>{
  const row=(await s.query<Row>('SELECT * FROM native_session_bindings WHERE org_id=$1 AND run_id=$2 AND id=$3',[context.orgId,context.parentRunId,bindingId])).rows[0];
  if(!row||row.status!=='ready'||Number(row.expires_at)<=Date.now())throw new Error('native_session_binding_unavailable');
  return NativeSessionResolved.parse({sessionId:row.session_id,token:this.crypt(row,row.token_cipher,false),expiresAt:Number(row.expires_at),interruptOn:row.interrupt_on,packageDigest:row.package_digest,inputs:NativeInputManifest.parse(row.input_manifest)});
 }));}
 async releaseForRun(orgId:ExecutionAuthorityContext['orgId'],runId:string){
  const id=await this.db.withTenant(orgId,async s=>(await s.query<{id:string}>('SELECT id FROM native_session_bindings WHERE org_id=$1 AND run_id=$2',[orgId,runId])).rows[0]?.id);
  if(!id)throw new Error('native_session_binding_unavailable');
  await this.release(id,orgId,runId);
 }
 async release(bindingId:string,orgId:ExecutionAuthorityContext['orgId'],runId:string){
  const row=await this.db.withTenant(orgId,async s=>{const r=(await s.query<Row>('SELECT * FROM native_session_bindings WHERE org_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE',[orgId,runId,bindingId])).rows[0];if(!r)throw new Error('native_session_binding_unavailable');
   if(r.status==='released')return null;
   if(!r.session_id||!r.token_cipher)throw new Error('native_session_release_unknown');
   await s.query("UPDATE native_session_bindings SET status='release_pending' WHERE org_id=$1 AND id=$2",[orgId,bindingId]);return r;});
  if(!row)return;
  await this.transport.destroy(row.session_id,this.crypt(row,row.token_cipher,false));
  await this.db.withTenant(orgId,s=>s.query("UPDATE native_session_bindings SET status='released',token_cipher=NULL WHERE org_id=$1 AND id=$2 AND status='release_pending'",[orgId,bindingId]));
 }
}
