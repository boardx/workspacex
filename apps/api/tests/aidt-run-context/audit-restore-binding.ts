/** Independent QA resource binding; deliberately no DB client, model, writes or startup. */
import { createHash } from 'node:crypto';
import { readFileSync,lstatSync,realpathSync,readdirSync } from 'node:fs';
import { dirname,resolve,join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
type RecordValue=Record<string,any>;
const requireFact=(value:unknown,code:string):void=>{if(!value)throw new Error(code);};
const hash=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
export function validateAuditRestoreBinding(input:{approved:string;actualPlanHash:string;plan:RecordValue;receipt:RecordValue;runtime:RecordValue;derived:RecordValue}){
 const {approved,actualPlanHash,plan,receipt,runtime,derived}=input;
 requireFact(/^[a-f0-9]{64}$/.test(approved)&&approved===actualPlanHash&&receipt.planSha256===approved,'AUDIT_APPROVED_RESTORE_PLAN_MISMATCH');
 requireFact(plan.kind==='aidt-stack04-checkpoint-restore'&&plan.skipFixtureSeed===true&&plan.noExistingDatabaseOverwrite===true&&plan.checkpoint===runtime.restoredCheckpoint,'AUDIT_RESTORE_PLAN_SCOPE_MISMATCH');
 requireFact(receipt.kind==='aidt-checkpoint-restored'&&receipt.restored===true&&receipt.seedResetAllowed===false&&receipt.emptyTargetBeforeRestore===true,'AUDIT_VERIFIED_EMPTY_RESTORE_REQUIRED');
 requireFact(plan.database===runtime.isolation.WORKSPACEX_DB&&(runtime.isolation.PGDATABASE===undefined||plan.database===runtime.isolation.PGDATABASE)&&receipt.database===plan.database&&receipt.orgId===plan.orgId,'AUDIT_RESTORE_DATABASE_MISMATCH');
 requireFact(/^[a-f0-9]{32}$/.test(plan.nonce)&&derived.WORKSPACEX_ISOLATION_SEED===`aidt-checkpoint-restore-${plan.nonce}`,'AUDIT_RESTORE_NONCE_RESOURCE_MISMATCH');
 requireFact(derived.COMPOSE_PROJECT_NAME===runtime.composeProject&&receipt.composeProject===runtime.composeProject&&receipt.stackAdmission?.isolationId===derived.WORKSPACEX_ISOLATION_ID,'AUDIT_FRESH_RESTORE_RESOURCE_MISMATCH');
 requireFact(String(receipt.pgPort)===String(receipt.ports?.PGPORT)&&receipt.stackAdmission?.ownerPid===receipt.leaseOwner?.pid,'AUDIT_RESTORE_PORT_OR_OWNER_MISMATCH');
 return {plan,receipt};
}
function privateJson(path:string){const absolute=resolve(path),stat=lstatSync(absolute),parent=lstatSync(dirname(absolute));requireFact(!stat.isSymbolicLink()&&stat.isFile()&&(stat.mode&0o777)===0o600&&parent.isDirectory()&&(parent.mode&0o777)===0o700&&realpathSync(absolute)===absolute,'AUDIT_PRIVATE_RESTORE_FILE_REQUIRED');if(process.getuid)requireFact(stat.uid===process.getuid(),'AUDIT_PRIVATE_OWNER_MISMATCH');return JSON.parse(readFileSync(absolute,'utf8'));}
export function verifyLiveAuditRestore(root:string,runtime:RecordValue,derived:RecordValue,approved:string){
 requireFact(typeof runtime.restoreReceiptFile==='string','AUDIT_RESTORE_RECEIPT_REQUIRED');
 const receipt=privateJson(runtime.restoreReceiptFile),plan=privateJson(receipt.planFile);
 validateAuditRestoreBinding({approved,actualPlanHash:hash(readFileSync(receipt.planFile)),plan,receipt,runtime,derived});
 const raw=readFileSync(`/proc/${receipt.leaseOwner.pid}/stat`,'utf8'),fields=raw.slice(raw.lastIndexOf(')')+2).split(' ');requireFact(Number(fields[19])===receipt.leaseOwner.startTicks&&fields[0]!=='Z','AUDIT_RESTORE_OWNER_NOT_LIVE');
 const leaseRoot=process.env.WORKSPACEX_TEST_PORT_LEASE_DIR??join(tmpdir(),'workspacex-test-port-leases');
 for(const port of Object.values(receipt.ports)){requireFact(/^[0-9]+$/.test(String(port)),'AUDIT_RESTORE_LEASE_PORT_INVALID');const directory=join(leaseRoot,String(port)),files=readdirSync(directory);requireFact(files.length===1,'AUDIT_RESTORE_PORT_LEASE_MISSING');const lease=JSON.parse(readFileSync(join(directory,files[0]!), 'utf8'));requireFact(lease.pid===receipt.leaseOwner.pid&&lease.starting===true,'AUDIT_RESTORE_PORT_LEASE_OWNER_MISMATCH');}
 // Existing helper's exact runtime path; reading it never acquires a lease.
 const slotRoot=process.env.WORKSPACEX_STACK_LEASE_DIR??join(tmpdir(),'workspacex-stack-leases');
 const slot=JSON.parse(readFileSync(join(slotRoot,`${receipt.stackAdmission.ownerPid}-${receipt.stackAdmission.isolationId}.json`),'utf8'));requireFact(slot.pid===receipt.leaseOwner.pid&&slot.isolationId===derived.WORKSPACEX_ISOLATION_ID,'AUDIT_RESTORE_SLOT_NOT_LIVE');
 const labels=JSON.parse(execFileSync('docker',['inspect','--format','{{json .Config.Labels}}',receipt.containerId],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));requireFact(labels['com.docker.compose.project']===receipt.composeProject&&labels['com.docker.compose.service']==='postgres','AUDIT_RESTORE_CONTAINER_MISMATCH');
 const actual=execFileSync('docker',['port',receipt.containerId,'5432/tcp'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();requireFact(actual===`127.0.0.1:${receipt.pgPort}`,'AUDIT_RESTORE_ACTUAL_PORT_MISMATCH');
 const manifest=privateJson(join(plan.checkpoint,'manifest.private.json'));requireFact(hash(readFileSync(join(plan.checkpoint,'manifest.private.json')))===plan.manifestSha256&&hash(readFileSync(join(plan.checkpoint,'database.custom.dump')))===plan.dumpSha256,'AUDIT_ORIGINAL_CHECKPOINT_CHANGED');
 for(const key of ['legacy','supplementS1']){const file=plan.ledgerPaths[key],s=lstatSync(file);requireFact(s.isFile()&&!s.isSymbolicLink()&&(s.mode&0o777)===0o600&&hash(readFileSync(file))===plan.ledgerHashes[key],'AUDIT_OLD_BUDGET_CHANGED');}
 return {plan,receipt,checkpointCreatedAt:manifest.createdAt,report:{approvedPlanSha256:approved,sourceCheckpointDumpHash:plan.dumpSha256,actualFreshContainerAndPortVerified:true,liveOwnerAndSlotVerified:true,emptyTargetAttested:true,oldBudgetHashesUnchanged:true,logicalDatabasePreserved:true,credentialFieldsAccessed:false}};
}
