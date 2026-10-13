/** Complete fixture metadata only; no message, SQL, argv, environment or rows. */
import {startupDiagnostic} from '../cn-api-startup/diagnostic';
const stages=new Set(['module-load','initial-migrations','initial-catalog','backup','restore','restore-ledger','restore-repository','restore-canary','restore-catalog','compatibility','migration-fault','startup-fault','postclear-fault','finalize']);
let stage='module-load';
const categories=new Set(['database','namespaces','relations','columns','constraints','indexes','triggers','views','rules','inheritance','types','enumLabels','collations','sequences','functions','policies','defaultAcl','extensions','roles','memberships','agePresence','graphs','labels']);
let catalogCategory:string|null=null;
export function mark(value:string){stage=stages.has(value)?value:'unknown';}
export function markCatalog(value:string){catalogCategory=categories.has(value)?value:null;}
export function diagnostic(error:unknown){
 const causes=[];let e:any=error;const seen=new Set();
 for(let i=0;i<3&&e&&typeof e==='object'&&!seen.has(e);i++,e=e.cause){
  seen.add(e);const item=startupDiagnostic(e);
  if(e.name==='AssertionError'){item.errorType='AssertionError';item.errorCode=e.code==='ERR_ASSERTION'?'ERR_ASSERTION':null;}
  causes.push(item);
 }
 return {kind:'application-complete-diagnostic-v1',stage,catalogCategory,causes};
}
