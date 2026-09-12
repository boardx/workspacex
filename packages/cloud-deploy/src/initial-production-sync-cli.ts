import {spawn} from "node:child_process";
import {constants} from "node:fs";import {mkdir,open,readFile,rename,unlink} from "node:fs/promises";import {join} from "node:path";
import {z} from "zod";
import {executeInitialSyncStage,initialProductionSyncPlan,initialProductionSyncSchema,initialSyncStateSchema,validateInitialSyncAcceptance,writeInitialSyncReceipt,type InitialSyncRun} from "./initial-production-sync.js";
import {generateInitialSyncEvidence} from "./initial-sync-evidence.js";
import {resolveSecret} from "./secrets.js";

const [configPath,action,value,...extra]=process.argv.slice(2);
const fail=()=>{process.stderr.write("INITIAL_PRODUCTION_SYNC_FAILED\n");process.exitCode=1;};
async function readJson(path:string,maxBytes=65536){if(!path.startsWith("/"))throw new Error();const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const stat=await file.stat();if(!stat.isFile()||stat.size<1||stat.size>maxBytes)throw new Error();return JSON.parse(await file.readFile("utf8"));}finally{await file.close();}}
const run:InitialSyncRun=async(executable,args,options)=>{
 const output=options.stdoutFile?await open(options.stdoutFile,"wx",0o600):undefined;
 try{return await new Promise((resolve,reject)=>{const child=spawn(executable,[...args],{shell:false,env:{...process.env,...options.env},stdio:["ignore",output?.fd??"pipe","ignore"]});const chunks:Buffer[]=[];let size=0;child.stdout?.on("data",(chunk:Buffer)=>{size+=chunk.length;if(size<=65536)chunks.push(chunk);else child.kill("SIGKILL");});child.once("error",()=>reject(new Error()));child.once("close",code=>code===0&&size<=65536?resolve(Buffer.concat(chunks).toString()):reject(new Error()));});}
 finally{await output?.close();}
};
async function main(){
 if(!configPath||!action||extra.length)throw new Error();const config=initialProductionSyncSchema.parse(await readJson(configPath));
 if(action==="dry-run"){process.stdout.write(JSON.stringify(initialProductionSyncPlan(config),null,2)+"\n");return;}
 const root=join(config.workDirectory,config.migrationId);await mkdir(root,{recursive:true,mode:0o700});const rootStat=await (await import("node:fs/promises")).lstat(root);if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||(rootStat.mode&0o077)!==0)throw new Error();const lock=await open(join(root,"sync.lock"),"wx",0o600).catch(()=>{throw new Error();});
 try{
  if(action==="accept"){
   if(!value)throw new Error();const receipt=validateInitialSyncAcceptance(config,await readJson(value));await writeInitialSyncReceipt(config,receipt,join(root,"receipt.json"));process.stdout.write(JSON.stringify({accepted:true,migrationId:config.migrationId})+"\n");return;
  }
  if(action==="evidence"){
   if(!value)throw new Error();
   const descriptor=z.object({sourceSnapshot:z.string().min(1).max(512),sourceOssInventoryFile:z.string().startsWith("/"),targetOssInventoryFile:z.string().startsWith("/"),secretCiphertextsDetected:z.boolean(),keyDecision:z.enum(["same-key-confirmed","rotated"])}).strict().parse(await readJson(value));
   const state=initialSyncStateSchema.parse(JSON.parse(await readFile(join(root,"state.json"),"utf8")));
   if(!state.dumpSha256)throw new Error();
   const target=z.object({host:z.string().min(1),port:z.number().int().min(1).max(65535).default(5432),database:z.string().min(1),user:z.string().min(1),password:z.string().min(16),sslmode:z.enum(["verify-full","disable"]),sslrootcert:z.string().startsWith("/").optional()}).strict().parse(JSON.parse(await resolveSecret(config.targetDatabaseSecretRef)));
   const targetEnv={PGHOST:target.host,PGPORT:String(target.port),PGDATABASE:target.database,PGUSER:target.user,PGPASSWORD:target.password,PGSSLMODE:target.sslmode,...(target.sslrootcert?{PGSSLROOTCERT:target.sslrootcert}:{})};
   const query=async(side:"source"|"target",sql:string)=>side==="source"
    ?run("docker",["exec","-i",config.sourceDatabase.mode==="devapp-docker"?config.sourceDatabase.container:"", "psql","-X","-A","-t","--set=ON_ERROR_STOP=1","--username",config.sourceDatabase.mode==="devapp-docker"?config.sourceDatabase.user:"","--dbname",config.sourceDatabase.mode==="devapp-docker"?config.sourceDatabase.database:"","--command",sql],{})
    :run("psql",["-X","-A","-t","--set=ON_ERROR_STOP=1","--command",sql],{env:targetEnv});
   if(config.sourceDatabase.mode!=="devapp-docker")throw new Error();
   const evidence=await generateInitialSyncEvidence({...descriptor,sourceOssInventory:await readJson(descriptor.sourceOssInventoryFile,128*1024*1024),targetOssInventory:await readJson(descriptor.targetOssInventoryFile,128*1024*1024)},query);
   const acceptance={schemaVersion:1,migrationId:config.migrationId,schemaRevision:config.schemaRevision,dumpSha256:state.dumpSha256,sourceSnapshot:evidence.sourceSnapshot,
    databaseRestored:evidence.databaseRestored,foreignKeysValid:evidence.foreignKeysValid,criticalReferencesValid:evidence.criticalReferencesValid,
    ossBaselineComplete:state.completed.includes("oss-baseline"),ossDeltaComplete:state.completed.includes("oss-delta"),ossInventoryVerified:evidence.ossInventoryVerified,
    secretCiphertextsDetected:evidence.secretCiphertextsDetected,keyDecision:evidence.keyDecision,completedAt:new Date().toISOString()};
   process.stdout.write(JSON.stringify({acceptance,evidence:evidence.evidence},null,2)+"\n");return;
  }
  if(!["database-dump","database-restore","oss-baseline","oss-delta"].includes(action))throw new Error();const statePath=join(root,"state.json");let state;
  try{state=initialSyncStateSchema.parse(JSON.parse(await readFile(statePath,"utf8")));}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;state={schemaVersion:1 as const,migrationId:config.migrationId,schemaRevision:config.schemaRevision,completed:[]};}
  const next=await executeInitialSyncStage(config,state,action as "database-dump"|"database-restore"|"oss-baseline"|"oss-delta",run,process.env,{writeFreezeConfirmed:value==="--write-freeze-confirmed"});
  const temp=join(root,".state.tmp");const file=await open(temp,"wx",0o600);try{await file.writeFile(JSON.stringify(next,null,2)+"\n");await file.sync();}finally{await file.close();}await rename(temp,statePath);process.stdout.write(JSON.stringify({migrationId:config.migrationId,completed:next.completed,resumed:"resumed" in next&&next.resumed})+"\n");
 }finally{await lock.close();await unlink(join(root,"sync.lock"));}
}
main().catch(fail);
