/** Fixed-vocabulary diagnostics; never serialize query, argv, stack or message. */
import {createHash} from 'node:crypto';
const stages=['module-load','read-config','facts-rows','facts-catalog','create-roles','create-source-databases','controller-start','postclear-write','controller-reheld','observe-writers','capture-catalog','dump','write-archive','restore-archive-identity','create-target','restore','restore-catalog'] as const;
let current='module-load';
export function mark(stage:string){current=stages.includes(stage as any)?stage:'unknown';}
const reasons=['FIXED_FIXTURE_SCOPE','FIXTURE_TOOLS','DATABASE_SCOPE','UNEXPECTED_SCHEMA_TABLE','POSTCLEAR_ROW_MISSING','ACTOR_LOGIN_PEER_CAS','ACTOR_LOGIN_STATE_CAS','ACTOR_FIXTURE_SQL_FAILED','ACTOR_EOF','ACTOR_DEADLINE','ORIGINAL_CATCH_NOT_COMPLETED','ACTUAL_REBLOCK_REQUIRED','RECOVERY_DID_NOT_COMPLETE','ORIGINAL_CATALOG_FACTS_DIFFER','FIXTURE_SQL_IDENTITY','FIXTURE_ACTUAL_CLUSTER','FIXTURE_ACTUAL_SOCKET','ROLE_MISSING','FACT_SCOPE','SOURCE_CATALOG_CHANGED','SOURCE_CHANGED_DURING_CAPTURE','SOURCE_CHANGED_ACROSS_CAPTURE','WRITER_STILL_ACCEPTS','MODULE_NOT_FOUND','ERR_MODULE_NOT_FOUND'];
const sqlstates=new Set(['42501','42703','42P01','42704','42883','42601','23505','23503','25006','28000','28P01','53300','53100','53200','57014','57P01','08001','08006']);
export function diagnostic(error:unknown){
 const result:{kind:string;stage:string;reason:string;sqlstate:string|null;childExit:number|null;stderrBytes:number;stderrSha256:string}={kind:'postclear-fixture-diagnostic-v1',stage:current,reason:'UNCLASSIFIED',sqlstate:null,childExit:null,stderrBytes:0,stderrSha256:createHash('sha256').update('').digest('hex')};
 let e:any=error;const seen=new Set();
 for(let i=0;i<4&&e&&typeof e==='object'&&!seen.has(e);i++,e=e.cause){
  seen.add(e);const message=typeof e.message==='string'?e.message:'';
  const reason=reasons.find(r=>message===r||message.startsWith(r+':')||e.code===r);
  if(reason)result.reason=reason;
  if(typeof e.code==='string'&&sqlstates.has(e.code))result.sqlstate=e.code;
  if(Number.isInteger(e.code)&&Math.abs(e.code)<256)result.childExit=e.code;
  if(typeof e.stderr==='string'||Buffer.isBuffer(e.stderr)){
   const raw=Buffer.from(e.stderr);result.stderrBytes=raw.length;result.stderrSha256=createHash('sha256').update(raw).digest('hex');
   const match=raw.subarray(0,1048576).toString().match(/(?:ERROR|FATAL):\s+([0-9A-Z]{5}):/);
   if(match&&sqlstates.has(match[1]))result.sqlstate=match[1];
  }
 }
 return result;
}
