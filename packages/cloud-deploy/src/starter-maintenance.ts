import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { deploymentConfigSchema } from "./config";
import { validateReleaseManifest } from "./release";
import { resolveSecret } from "./secrets";
import { serializeRuntimeEnvironment } from "./runtime-environment";
import { parseBackupTarget } from "./backup-target";
import { captureProvisionCommand } from "./command";
import { backupStarterDatabase, restoreStarterDatabase, StarterBackupManifestSchema } from "./starter-backup";

const directory=z.string().regex(/^\/(?:[a-zA-Z0-9_-][a-zA-Z0-9._-]*\/)*[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/);
const optionsSchema=z.discriminatedUnion("operation",[
 z.object({operation:z.literal("backup"),runtimeDirectory:directory,backupDirectory:directory,database:z.enum(["workspacex","workspacex_agent","workspacex_memory"]).default("workspacex")}).strict(),
 z.object({operation:z.literal("restore"),runtimeDirectory:directory,backupDirectory:directory,backupId:z.string().uuid(),database:z.string().regex(/^[a-z][a-z0-9_]{0,62}$/).refine(v=>!["postgres","template0","template1","workspacex","workspacex_agent","workspacex_memory"].includes(v))}).strict(),
]);
export type StarterMaintenanceOptions=z.input<typeof optionsSchema>;
type Context={signal:AbortSignal;remainingMs:()=>number};
export type MaintenanceRun=(args:readonly string[],context:Context)=>Promise<string>;
export interface MaintenanceServices {
 run?:MaintenanceRun;
 backup?:typeof backupStarterDatabase;
 restore?:typeof restoreStarterDatabase;
}
async function privateDirectory(path:string){const stat=await lstat(path);if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077)!==0)throw new Error("UNSAFE_MAINTENANCE_DIRECTORY");}
async function syncDirectory(path:string){const file=await open(path,"r");try{await file.sync();}finally{await file.close();}}
const sha=z.string().regex(/^[a-f0-9]{64}$/);
const transferResult=z.object({ok:z.literal(true),backupId:z.string().uuid(),sha256:sha,bytes:z.number().int().positive(),uploaded:z.literal(true).optional(),downloaded:z.literal(true).optional(),readbackVerified:z.literal(true).optional()}).strict();

/** Host-side maintenance for an existing Starter deployment. No cloud calls occur merely
 * by importing or validating this module. A separate 1-hour budget applies to transfers.
 */
export async function maintainStarter(configInput:unknown,releaseInput:unknown,optionsInput:StarterMaintenanceOptions,
 services:MaintenanceServices={},source:NodeJS.ProcessEnv=process.env,externalSignal?:AbortSignal){
 const config=deploymentConfigSchema.parse(configInput),manifest=validateReleaseManifest(releaseInput),options=optionsSchema.parse(optionsInput);
 if(config.environment.profile!=="starter")throw new Error("STARTER_MAINTENANCE_ONLY");
 const environment=config.environment;
 if(config.provision.release!==manifest.release)throw new Error("RELEASE_VERSION_MISMATCH");
 const dir=options.runtimeDirectory;
 if(options.backupDirectory===dir||options.backupDirectory.startsWith(`${dir}/`)||dir.startsWith(`${options.backupDirectory}/`))throw new Error("BACKUP_DIRECTORY_MUST_BE_SEPARATE");
 if(options.backupDirectory===environment.dataVolumePath||options.backupDirectory.startsWith(`${environment.dataVolumePath}/`))throw new Error("BACKUP_DIRECTORY_MUST_BE_SEPARATE");
 await privateDirectory(dir);await privateDirectory(join(dir,"secrets"));
 const controller=new AbortController(),deadline=Date.now()+3600000;
 const abort=()=>controller.abort();externalSignal?.addEventListener("abort",abort,{once:true});if(externalSignal?.aborted)abort();
 const timer=setTimeout(abort,3600000);timer.unref();
 const context:Context={signal:controller.signal,remainingMs:()=>Math.max(0,deadline-Date.now())};
 const active=()=>{if(context.signal.aborted||context.remainingMs()<=0)throw new Error("MAINTENANCE_CANCELLED");};
 const run:MaintenanceRun=services.run??((args,ctx)=>captureProvisionCommand({executable:args[0]!,args:args.slice(1),cwd:dir,env:source},ctx));
 let lock:Awaited<ReturnType<typeof open>>|undefined;let retainLock=false;
 try{
  active();lock=await open(join(dir,"provision.lock"),"wx",0o600);await lock.writeFile(JSON.stringify({operation:options.operation,pid:process.pid,startedAt:new Date().toISOString()}));await lock.sync();await syncDirectory(dir);
  const compose=JSON.parse(await resolveSecret(`file:${join(dir,"compose.json")}`,source,context));
  const project=z.string().regex(/^[a-z][a-z0-9_-]{0,40}$/).parse(compose.name);
  if(compose.services?.postgres?.image!==manifest.images.postgres.image||compose.services?.api?.image!==manifest.images.api.image)throw new Error("RUNTIME_RELEASE_MISMATCH");
  const ids=(await run(["docker","ps","--quiet","--filter",`label=com.docker.compose.project=${project}`,"--filter","label=com.docker.compose.service=postgres"],context)).trim().split(/\s+/);
  if(ids.length!==1||! /^[a-f0-9]{12,64}$/.test(ids[0]!))throw new Error("STARTER_POSTGRES_NOT_UNIQUE");
  const container=ids[0]!;
  const inspected=z.array(z.object({Id:z.string(),State:z.object({Running:z.literal(true)}),Config:z.object({Image:z.string(),Labels:z.record(z.string())}),Mounts:z.array(z.object({Type:z.string(),Source:z.string(),Destination:z.string(),RW:z.boolean()}))})).length(1).parse(JSON.parse(await run(["docker","inspect",container],context)))[0]!;
  if(!inspected.Id.startsWith(container)||inspected.Config.Image!==manifest.images.postgres.image||inspected.Config.Labels["com.docker.compose.project"]!==project||inspected.Config.Labels["com.docker.compose.service"]!=="postgres"||!inspected.Mounts.some(m=>m.Type==="bind"&&m.Source===join(environment.dataVolumePath,"postgres")&&m.Destination==="/var/lib/postgresql/data"&&m.RW))throw new Error("STARTER_POSTGRES_IDENTITY_MISMATCH");
  const image=z.array(z.object({Os:z.string(),Architecture:z.string(),RepoDigests:z.array(z.string()),Config:z.object({Labels:z.record(z.string())})})).length(1).parse(JSON.parse(await run(["docker","image","inspect",manifest.images.api.image],context)))[0]!;
  if(!image.RepoDigests.includes(manifest.images.api.image)||`${image.Os}/${image.Architecture}`!==manifest.platform||image.Config.Labels["org.opencontainers.image.revision"]!==manifest.sourceRevision)throw new Error("MAINTENANCE_IMAGE_MISMATCH");
  const password=await resolveSecret(`file:${join(dir,"secrets","owner-password")}`,source,context);
  if(!/^[a-f0-9]{64}$/.test(password))throw new Error("INVALID_EXISTING_OWNER_SECRET");
  const target=parseBackupTarget(await resolveSecret(environment.backupTargetRef,source,context));
  if(target.region!==environment.regionId)throw new Error("BACKUP_REGION_MISMATCH");
  active();await mkdir(options.backupDirectory,{mode:0o700});await privateDirectory(options.backupDirectory);
  const archive=join(options.backupDirectory,"archive");
  const databaseTarget={container,database:options.database,user:"postgres",password};
  let local:Awaited<ReturnType<typeof backupStarterDatabase>>|undefined;
  if(options.operation==="backup")local=await(services.backup??backupStarterDatabase)(databaseTarget,archive);
  active();
  const name=`wsx-maintenance-${randomUUID()}`,envFile=join(dir,`${name}.env`);
  const env=await open(envFile,"wx",0o600);
  let output:string;
  try{
   try{await env.writeFile(serializeRuntimeEnvironment({WORKSPACEX_DEPLOY_PROFILE:"starter",STARTER_BACKUP_TARGET_JSON:JSON.stringify(target)}));await env.sync();}finally{await env.close();}
   active();output=await run(["docker","run","--rm","--pull=never","--name",name,"--user","0:0","--network",`${project}-runtime`,"--env-file",envFile,
    "--cap-drop=ALL","--security-opt=no-new-privileges","--pids-limit=128","--memory=512m","--cpus=1","--read-only","--tmpfs","/tmp:rw,noexec,nosuid,size=64m",
    "--mount",`type=bind,src=${options.backupDirectory},dst=/backup${options.operation==="backup"?",readonly":""}`,"--entrypoint","node",manifest.images.api.image,"--import","tsx","apps/api/scripts/starter-backup-oss.ts",
    options.operation==="backup"?"upload":"download","/backup/archive",...(options.operation==="restore"?[options.backupId]:[])],context);
  }finally{
   // Stop the actual container, not only its Docker client. Only our random exact name
   // is eligible. Unknown cleanup retains the shared lock for explicit diagnosis.
   const cleanup:Context={signal:AbortSignal.timeout(10000),remainingMs:()=>10000};
   try{const present=(await run(["docker","ps","--all","--quiet","--filter",`name=^/${name}$`],cleanup)).trim();if(present)await run(["docker","rm","--force",name],cleanup);}
   catch{retainLock=true;throw new Error("MAINTENANCE_JOB_CLEANUP_UNPROVEN");}
   finally{try{await unlink(envFile);await syncDirectory(dir);}catch{retainLock=true;throw new Error("MAINTENANCE_SECRET_CLEANUP_UNPROVEN");}}
  }
  active();const result=transferResult.parse(JSON.parse(output!));
  if(options.operation==="backup"){
   if(!result.uploaded||!result.readbackVerified||result.sha256!==local!.sha256||result.bytes!==local!.bytes)throw new Error("MAINTENANCE_UPLOAD_UNPROVEN");
   return{ok:true as const,operation:options.operation,backupId:result.backupId,sha256:result.sha256,bytes:result.bytes};
  }
  if(!result.downloaded||result.backupId!==options.backupId)throw new Error("MAINTENANCE_DOWNLOAD_UNPROVEN");
  const downloaded=StarterBackupManifestSchema.parse(JSON.parse(await resolveSecret(`file:${join(archive,"manifest.json")}`,source,context)));
  if(downloaded.sha256!==result.sha256||downloaded.bytes!==result.bytes)throw new Error("MAINTENANCE_DOWNLOAD_UNPROVEN");
  const restored=await(services.restore??restoreStarterDatabase)(databaseTarget,archive);
  return{ok:true as const,operation:options.operation,backupId:result.backupId,database:restored.database,sha256:result.sha256,bytes:result.bytes};
 }finally{
  clearTimeout(timer);externalSignal?.removeEventListener("abort",abort);
  if(lock){await lock.close();if(!retainLock){await unlink(join(dir,"provision.lock"));await syncDirectory(dir);}}
 }
}
