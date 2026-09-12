import { z } from "zod";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, open, readFile } from "node:fs/promises";
import { resolveSecret } from "./secrets";

const secretRef=z.string().regex(/^(?:env:[A-Z][A-Z0-9_]*|file:\/[^\r\n\0]+)$/);
const bucket=z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/);
const prefix=z.string().regex(/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/?$/);
export const initialProductionSyncSchema=z.object({schemaVersion:z.literal(1),migrationId:z.string().uuid(),
 sourceDatabase:z.discriminatedUnion("mode",[
  z.object({mode:z.literal("secret-ref"),secretRef}).strict(),
  z.object({mode:z.literal("devapp-docker"),container:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/),database:z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/),user:z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/)}).strict(),
 ]),targetDatabaseSecretRef:secretRef,
 sourceObjects:z.discriminatedUnion("mode",[
  z.object({mode:z.literal("oss"),bucket,prefix}).strict(),
  z.object({mode:z.literal("filesystem"),root:z.string().regex(/^\/(?:[a-zA-Z0-9_-][a-zA-Z0-9._-]*\/)*[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/)}).strict(),
 ]),targetOss:z.object({bucket,prefix}).strict(),
 workDirectory:z.string().regex(/^\/(?:[a-zA-Z0-9_-][a-zA-Z0-9._-]*\/)*[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/),
 schemaRevision:z.string().regex(/^[a-f0-9]{40}$/),
 keyMigration:z.discriminatedUnion("mode",[
  z.object({mode:z.literal("same-key-confirmed"),confirmedBy:z.string().min(1).max(128),keyId:z.string().min(1).max(256)}).strict(),
  z.object({mode:z.literal("rotate-required")}).strict(),
 ]),
}).strict().superRefine((value,ctx)=>{
 if(value.sourceDatabase.mode==="secret-ref"&&value.sourceDatabase.secretRef===value.targetDatabaseSecretRef)ctx.addIssue({code:"custom",path:["targetDatabaseSecretRef"],message:"SOURCE_TARGET_DATABASE_MUST_DIFFER"});
 if(value.sourceObjects.mode==="oss"&&value.sourceObjects.bucket===value.targetOss.bucket&&value.sourceObjects.prefix===value.targetOss.prefix)ctx.addIssue({code:"custom",path:["targetOss"],message:"SOURCE_TARGET_OSS_MUST_DIFFER"});
});
export type InitialProductionSyncConfig=z.infer<typeof initialProductionSyncSchema>;
const databaseSecret=z.object({host:z.string().min(1),port:z.number().int().min(1).max(65535).default(5432),database:z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/),user:z.string().min(1),password:z.string().min(16),sslmode:z.enum(["verify-full","disable"]),sslrootcert:z.string().startsWith("/").optional()}).strict();
export const initialSyncStateSchema=z.object({schemaVersion:z.literal(1),migrationId:z.string().uuid(),schemaRevision:z.string().regex(/^[a-f0-9]{40}$/),completed:z.array(z.enum(["database-dump","database-restore","oss-baseline","oss-delta"])),dumpSha256:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict();
export type InitialSyncState=z.infer<typeof initialSyncStateSchema>;
export type InitialSyncRun=(executable:string,args:readonly string[],options:{env?:NodeJS.ProcessEnv;stdoutFile?:string})=>Promise<string>;

/** Secret-free argv plan. Credentials are resolved into process environments by the runner. */
export function initialProductionSyncPlan(input:unknown){
 const value=initialProductionSyncSchema.parse(input), root=`${value.workDirectory}/${value.migrationId}`;
 return {migrationId:value.migrationId,dryRun:true,commands:[
  value.sourceDatabase.mode==="devapp-docker"
   ?["docker","exec","-i",value.sourceDatabase.container,"pg_dump","--format=custom","--serializable-deferrable","--lock-wait-timeout=10000","--username",value.sourceDatabase.user,"--dbname",value.sourceDatabase.database,`<stdout:${root}/database.dump>`]
   :["pg_dump","--format=custom","--serializable-deferrable","--lock-wait-timeout=10000",`<stdout:${root}/database.dump>`],
  ["pg_restore","--exit-on-error","--single-transaction","--no-owner",`--dbname=<new-empty-target>` ,`${root}/database.dump`],
  ["oss-sync","--phase=baseline",value.sourceObjects.mode==="oss"?`oss://${value.sourceObjects.bucket}/${value.sourceObjects.prefix}`:value.sourceObjects.root,`oss://${value.targetOss.bucket}/${value.targetOss.prefix}`],
  ["oss-sync","--phase=cutover-delta",value.sourceObjects.mode==="oss"?`oss://${value.sourceObjects.bucket}/${value.sourceObjects.prefix}`:value.sourceObjects.root,`oss://${value.targetOss.bucket}/${value.targetOss.prefix}`],
  ["verify-initial-production-sync",`--receipt=${root}/receipt.json`],
 ],secretRefs:[...(value.sourceDatabase.mode==="secret-ref"?[value.sourceDatabase.secretRef]:[]),value.targetDatabaseSecretRef],requiresWriteFreezeFor:["database-restore","oss-cutover-delta"]};
}

const pgEnv=(value:z.infer<typeof databaseSecret>):NodeJS.ProcessEnv=>({PGHOST:value.host,PGPORT:String(value.port),PGDATABASE:value.database,PGUSER:value.user,PGPASSWORD:value.password,PGSSLMODE:value.sslmode,...(value.sslrootcert?{PGSSLROOTCERT:value.sslrootcert}:{})});
const sha256=async(path:string)=>createHash("sha256").update(await readFile(path)).digest("hex");
/** Execute one resumable stage. The caller owns atomic state-file persistence. */
export async function executeInitialSyncStage(configInput:unknown,stateInput:unknown,stage:InitialSyncState["completed"][number],run:InitialSyncRun,
 source:NodeJS.ProcessEnv=process.env,options:{writeFreezeConfirmed?:boolean}={}){
 const config=initialProductionSyncSchema.parse(configInput),state=initialSyncStateSchema.parse(stateInput);
 if(state.migrationId!==config.migrationId||state.schemaRevision!==config.schemaRevision)throw new Error("INITIAL_SYNC_STATE_IDENTITY_MISMATCH");
 if(state.completed.includes(stage))return {...state,resumed:true as const};
 const order=["database-dump","database-restore","oss-baseline","oss-delta"] as const,index=order.indexOf(stage);
 if(index<0||order.slice(0,index).some(required=>!state.completed.includes(required)))throw new Error("INITIAL_SYNC_STAGE_ORDER_INVALID");
 const directory=`${config.workDirectory}/${config.migrationId}`,dump=`${directory}/database.dump`;
 if(stage==="database-dump"){
  if(config.sourceDatabase.mode==="devapp-docker")await run("docker",["exec","-i",config.sourceDatabase.container,"pg_dump","--format=custom","--serializable-deferrable","--lock-wait-timeout=10000","--username",config.sourceDatabase.user,"--dbname",config.sourceDatabase.database],{stdoutFile:dump});
  else {const db=databaseSecret.parse(JSON.parse(await resolveSecret(config.sourceDatabase.secretRef,source)));await run("pg_dump",["--format=custom","--serializable-deferrable","--lock-wait-timeout=10000"],{env:pgEnv(db),stdoutFile:dump});}
  return {...state,completed:[...state.completed,stage],dumpSha256:await sha256(dump)};
 }
 if(stage==="database-restore"){
  if(!state.dumpSha256||await sha256(dump)!==state.dumpSha256)throw new Error("INITIAL_SYNC_DUMP_CHANGED");
  const db=databaseSecret.parse(JSON.parse(await resolveSecret(config.targetDatabaseSecretRef,source))),env=pgEnv(db);
  const count=(await run("psql",["-X","-A","-t","--set=ON_ERROR_STOP=1","--command","SELECT count(*) FROM pg_catalog.pg_class WHERE relnamespace NOT IN (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname LIKE 'pg_%' OR nspname='information_schema') AND relkind IN ('r','p');"],{env})).trim();
  if(count!=="0")throw new Error("INITIAL_SYNC_TARGET_NOT_EMPTY");
  await run("pg_restore",["--exit-on-error","--single-transaction","--no-owner",dump],{env});
 }else{
  if(stage==="oss-delta"&&!options.writeFreezeConfirmed)throw new Error("INITIAL_SYNC_WRITE_FREEZE_REQUIRED");
  const objectSource=config.sourceObjects.mode==="oss"?`oss://${config.sourceObjects.bucket}/${config.sourceObjects.prefix}`:config.sourceObjects.root;
  await run("ossutil",["sync",objectSource,`oss://${config.targetOss.bucket}/${config.targetOss.prefix}`,"--delete"],{});
 }
 return {...state,completed:[...state.completed,stage]};
}

const object=z.object({key:z.string().min(1),size:z.number().int().nonnegative(),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const ossInventorySchema=z.object({schemaVersion:z.literal(1),bucket,prefix,objects:z.array(object).max(10_000_000)}).strict();
export function verifyOssInventory(sourceInput:unknown,targetInput:unknown){
 const source=ossInventorySchema.parse(sourceInput),target=ossInventorySchema.parse(targetInput);
 const normalized=(items:z.infer<typeof object>[])=>items.map(item=>`${item.key}\0${item.size}\0${item.sha256}`).sort();
 const a=normalized(source.objects),b=normalized(target.objects);
 return {verified:JSON.stringify(a)===JSON.stringify(b),sourceObjects:a.length,targetObjects:b.length};
}

export const initialSyncAcceptanceSchema=z.object({schemaVersion:z.literal(1),migrationId:z.string().uuid(),schemaRevision:z.string().regex(/^[a-f0-9]{40}$/),
 dumpSha256:z.string().regex(/^[a-f0-9]{64}$/),sourceSnapshot:z.string().min(1),databaseRestored:z.literal(true),foreignKeysValid:z.literal(true),
 criticalReferencesValid:z.literal(true),ossBaselineComplete:z.literal(true),ossDeltaComplete:z.literal(true),ossInventoryVerified:z.literal(true),
 secretCiphertextsDetected:z.boolean(),keyDecision:z.enum(["same-key-confirmed","rotated"]),completedAt:z.string().datetime(),
}).strict();

/** A receipt is accepted only when all data/reference gates passed; detection never claims secrets are portable. */
export function validateInitialSyncAcceptance(configInput:unknown,receiptInput:unknown){
 const config=initialProductionSyncSchema.parse(configInput),receipt=initialSyncAcceptanceSchema.parse(receiptInput);
 if(receipt.migrationId!==config.migrationId||receipt.schemaRevision!==config.schemaRevision)throw new Error("INITIAL_SYNC_RECEIPT_IDENTITY_MISMATCH");
 if(config.keyMigration.mode==="rotate-required"&&receipt.secretCiphertextsDetected&&receipt.keyDecision!=="rotated")throw new Error("INITIAL_SYNC_SECRET_ROTATION_REQUIRED");
 if(config.keyMigration.mode==="same-key-confirmed"&&receipt.keyDecision!=="same-key-confirmed")throw new Error("INITIAL_SYNC_KEY_DECISION_MISMATCH");
  return {...receipt,accepted:true as const};
}

/** Exclusive receipt publication is the replay guard. A partial or accepted ID is never overwritten. */
export async function writeInitialSyncReceipt(configInput:unknown,receiptInput:unknown,path:string){
 const accepted=validateInitialSyncAcceptance(configInput,receiptInput);
 if(!/^\/(?:[a-zA-Z0-9_-][a-zA-Z0-9._-]*\/)*[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/.test(path))throw new Error("INVALID_INITIAL_SYNC_RECEIPT_PATH");
 const parent=path.slice(0,path.lastIndexOf("/"))||"/",stat=await lstat(parent);
 if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077)!==0)throw new Error("UNSAFE_INITIAL_SYNC_RECEIPT_DIRECTORY");
 const file=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600).catch(()=>{throw new Error("INITIAL_SYNC_ALREADY_RECORDED");});
 try{await file.writeFile(JSON.stringify(accepted,null,2)+"\n");await file.sync();}finally{await file.close();}
 return accepted;
}
