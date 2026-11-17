// Offline guards for the one private Stack04 checkpoint. No shell, Docker, DB or model I/O.
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
export const CHECKPOINT_SCOPE = 'owned isolated stack-context-04 only';
export const RUNTIME_ZERO_GUARDS = Object.freeze(['agentRuns','skillTrialRuns','attachmentExtraction','threadTitleModel','standardScheduler']);
export const ZERO_EXECUTION_ENV = Object.freeze({ KERNEL_AGENT_RUN_AUTOSTART:'0', KERNEL_SKILL_TRIALRUN_AUTOSTART:'0', KERNEL_ATTACHMENT_EXTRACTION_AUTOSTART:'0', KERNEL_THREAD_TITLE_MODEL_ENABLED:'0', KERNEL_STANDARD_SCHEDULER:'0' });
export function invariant(value, code) { if (!value) throw new Error(code); }
export const hash = value => createHash('sha256').update(value).digest('hex');
function privateEntry(path, directory) {
  const s=lstatSync(path);invariant(!s.isSymbolicLink()&&(directory?s.isDirectory():s.isFile()),'CHECKPOINT_UNSAFE_FILE_TYPE');
  invariant((s.mode&0o777)===(directory?0o700:0o600),'CHECKPOINT_PRIVATE_MODE_REQUIRED');
  if(process.getuid)invariant(s.uid===process.getuid(),'CHECKPOINT_OWNER_MISMATCH');return s;
}
function within(root,path){invariant(path===root||path.startsWith(root+sep),'CHECKPOINT_PATH_ESCAPE');}
function readPrivate(root,name){const path=resolve(root,name);within(root,path);privateEntry(path,false);invariant(realpathSync(path)===path,'CHECKPOINT_SYMLINK_REJECTED');return readFileSync(path);}
function jsonPrivate(root,name){try{return JSON.parse(readPrivate(root,name));}catch(e){if(e instanceof SyntaxError)throw new Error('CHECKPOINT_JSON_INVALID');throw e;}}
export function privateTree(root){privateEntry(root,true);const files=[];for(const name of readdirSync(root)){const path=join(root,name),s=lstatSync(path);invariant(!s.isSymbolicLink(),'CHECKPOINT_SYMLINK_REJECTED');if(s.isDirectory())files.push(...privateTree(path));else{privateEntry(path,false);files.push(path);}}return files;}
export function verifyCheckpoint({checkpoint,receiptFile,legacyLedger,supplementLedger}){
  invariant(isAbsolute(checkpoint)&&isAbsolute(receiptFile)&&isAbsolute(legacyLedger)&&isAbsolute(supplementLedger),'CHECKPOINT_ABSOLUTE_PATHS_REQUIRED');
  const root=resolve(checkpoint);invariant(realpathSync(root)===root,'CHECKPOINT_SYMLINK_REJECTED');privateEntry(root,true);
  const receipt=JSON.parse(readFileSync(receiptFile,'utf8'));invariant(receipt.scope===CHECKPOINT_SCOPE&&resolve(receipt.privateCheckpointPath)===root&&receipt.restorationTested===false,'CHECKPOINT_NOT_KNOWN');
  const manifest=jsonPrivate(root,'manifest.private.json'),metadata=jsonPrivate(root,'runtime-resume-metadata.private.json'),login=jsonPrivate(root,'fixture-login.private.json');
  invariant(manifest.scope===CHECKPOINT_SCOPE&&manifest.checkpoint===root&&manifest.restorationTested===false,'CHECKPOINT_MANIFEST_SCOPE');
  const dump=readPrivate(root,'database.custom.dump');invariant(dump.subarray(0,5).toString()==='PGDMP','CHECKPOINT_NOT_CUSTOM_DUMP');
  invariant(hash(dump)===receipt.dumpSha256&&hash(dump)===manifest.databaseDump.sha256&&dump.length===receipt.dumpBytes,'CHECKPOINT_DUMP_HASH_MISMATCH');
  invariant(metadata.agentAutoExecution===false&&metadata.paidWindowOpened===false&&Object.keys(metadata.autoExecutionAttestation?.guards??{}).length===5&&RUNTIME_ZERO_GUARDS.every(k=>metadata.autoExecutionAttestation.guards[k]==='0'),'CHECKPOINT_EXECUTION_NOT_DISABLED');
  invariant(/^wsx_[a-f0-9]{16,64}$/.test(manifest.database)&&metadata.isolation?.WORKSPACEX_DB===manifest.database,'CHECKPOINT_DATABASE_INVALID');
  invariant(metadata.isolation?.WORKSPACEX_ISOLATION_SEED&&login.schemaVersion===1&&typeof login.orgId==='string'&&manifest.orgs.includes(login.orgId),'CHECKPOINT_FIXTURE_IDENTITY_INVALID');
  const accounts=login.accounts;invariant(accounts&&['primary','setupLead','fundedAdmin'].every(k=>typeof accounts[k]?.email==='string'&&accounts[k].email.length>0&&typeof accounts[k]?.password==='string'&&accounts[k].password.length>0),'CHECKPOINT_LOGIN_INCOMPLETE');
  invariant(JSON.stringify(manifest.groups.map(g=>g.id))===JSON.stringify(receipt.groups)&&manifest.agents.length===2&&new Set(manifest.agents.map(a=>a.version_id)).size===2&&manifest.agents.every(a=>a.org_id===login.orgId),'CHECKPOINT_RECORD_IDENTITY_MISMATCH');
  invariant(Object.entries(manifest.ledgerHashes).every(([k,v])=>receipt.ledgerHashes[k]===v),'CHECKPOINT_LEDGER_MANIFEST_MISMATCH');
  for(const[name,path]of Object.entries({legacy:legacyLedger,supplementS1:supplementLedger})){privateEntry(path,false);invariant(hash(readFileSync(path))===receipt.ledgerHashes[name],'CHECKPOINT_CURRENT_BUDGET_CHANGED');const copy=name==='legacy'?'legacy-budget.private.json':'supplementS1-budget.private.json';invariant(hash(readPrivate(root,copy))===receipt.ledgerHashes[name],'CHECKPOINT_BUDGET_COPY_CHANGED');}
  const files=privateTree(join(root,'object-store')),candidates=files.filter(p=>!p.endsWith('.mime')).map(path=>({path,bytes:readFileSync(path),used:false}));const originals=[];
  for(const original of manifest.originals){const match=candidates.find(c=>!c.used&&c.bytes.length===original.bytes&&hash(c.bytes)===original.sha256);invariant(match,'CHECKPOINT_ORIGINAL_MISSING_OR_CHANGED');invariant(files.includes(match.path+'.mime'),'CHECKPOINT_MIME_SIDECAR_MISSING');match.used=true;originals.push({runId:original.runId,versionId:original.versionId,relativePath:relative(root,match.path),bytes:match.bytes.length,sha256:original.sha256,mimeSha256:hash(readFileSync(match.path+'.mime'))});}
  invariant(originals.length===receipt.objectStore.rawOriginalCount&&originals.length===4,'CHECKPOINT_RAW_COUNT_MISMATCH');
  invariant(manifest.finance.active===0&&manifest.finance.unsettled===0&&Number(manifest.finance.holds)===0&&Number(manifest.finance.unbounded)===0,'CHECKPOINT_OUTSTANDING_WORK');
  return{checkpoint:root,database:manifest.database,identitySeed:metadata.isolation.WORKSPACEX_ISOLATION_SEED,orgId:login.orgId,groups:manifest.groups,agents:manifest.agents,dumpSha256:receipt.dumpSha256,manifestSha256:hash(readPrivate(root,'manifest.private.json')),runtimeMetadataSha256:hash(readPrivate(root,'runtime-resume-metadata.private.json')),ledgerHashes:receipt.ledgerHashes,ledgerPaths:{legacy:resolve(legacyLedger),supplementS1:resolve(supplementLedger)},originals,credentialsFile:join(root,'fixture-login.private.json'),objectRoot:join(root,'object-store')};
}
export function makeRestorePlan(verified,{destination,root,nonce,protectedBaseline,buildReceipt,createdAt=new Date().toISOString()}){
  invariant(isAbsolute(destination)&&resolve(destination)!==resolve(root)&&!resolve(destination).startsWith(resolve(root)+sep),'CHECKPOINT_DESTINATION_MUST_BE_PRIVATE_EXTERNAL');
  const absolute=resolve(destination);invariant(absolute!==verified.checkpoint&&!absolute.startsWith(verified.checkpoint+sep),'CHECKPOINT_DESTINATION_OVERLAPS_BACKUP');
  invariant(/^[a-f0-9]{32}$/.test(nonce),'CHECKPOINT_FRESH_NONCE_REQUIRED');
  return{schemaVersion:1,kind:'aidt-stack04-checkpoint-restore',mode:'plan',createdAt,nonce,destination:absolute,...verified,protectedBaseline,buildReceipt,guards:ZERO_EXECUTION_ENV,skipFixtureSeed:true,noExistingDatabaseOverwrite:true,requiresFreshOwnedCompose:true,requiresFreshPortReservation:true,requiresExplicitApply:true,requiresPlanSha256:true,requiresRootAuthorization:true,modelRequestsAuthorized:0,restorationTested:false,serviceStartupVerified:false};
}
export function verifyApplyApproval(plan,{approvedPlanSha256,actualPlanSha256,rootAuthorization}){
  invariant(plan.kind==='aidt-stack04-checkpoint-restore'&&plan.mode==='plan','CHECKPOINT_PLAN_INVALID');
  invariant(approvedPlanSha256===actualPlanSha256&&/^[a-f0-9]{64}$/.test(actualPlanSha256),'CHECKPOINT_PLAN_NOT_APPROVED');
  invariant(rootAuthorization==='restore-only-no-model','CHECKPOINT_ROOT_AUTHORIZATION_REQUIRED');
  invariant(plan.skipFixtureSeed===true&&plan.noExistingDatabaseOverwrite===true&&Object.entries(ZERO_EXECUTION_ENV).every(([k,v])=>plan.guards[k]===v),'CHECKPOINT_APPLY_GUARDS_CHANGED');
}

export function readOwnedPrivateJson(path){invariant(isAbsolute(path),'CHECKPOINT_ABSOLUTE_PATHS_REQUIRED');privateEntry(dirname(path),true);privateEntry(path,false);invariant(realpathSync(path)===resolve(path),'CHECKPOINT_SYMLINK_REJECTED');try{return JSON.parse(readFileSync(path,'utf8'));}catch(e){if(e instanceof SyntaxError)throw new Error('CHECKPOINT_JSON_INVALID');throw e;}}
export function verifyRestoredObjects(plan,objectRoot){
  const root=resolve(objectRoot);invariant(realpathSync(root)===root,'CHECKPOINT_RESTORED_OBJECT_ROOT_SYMLINK');const files=privateTree(root);
  invariant(Array.isArray(plan.originals)&&plan.originals.length===4,'CHECKPOINT_RESTORED_ORIGINAL_COUNT');
  for(const original of plan.originals){invariant(original.relativePath.startsWith('object-store/'),'CHECKPOINT_RESTORED_KEY_INVALID');const path=resolve(root,original.relativePath.slice('object-store/'.length));within(root,path);invariant(files.includes(path)&&files.includes(path+'.mime'),'CHECKPOINT_RESTORED_ORIGINAL_MISSING');const bytes=readFileSync(path);invariant(bytes.length===original.bytes&&hash(bytes)===original.sha256,'CHECKPOINT_RESTORED_ORIGINAL_CHANGED');invariant(hash(readFileSync(path+'.mime'))===original.mimeSha256,'CHECKPOINT_RESTORED_MIME_CHANGED');}
  return{originals:plan.originals.length,bytesHashesMimeAndPrivateModes:true};
}
export async function awaitRestoreStep(operation,signal){invariant(!signal.aborted,'CHECKPOINT_STOP_REQUESTED');const value=await operation();invariant(!signal.aborted,'CHECKPOINT_STOP_REQUESTED');return value;}
