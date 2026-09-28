import {createHash} from 'node:crypto';
import {BackfillConfigSchema,BackfillCursorSchema,BackfillScopeSchema,type BackfillScope} from '@repo/contracts/whiteboard-storage';
import type {Principal} from '../../domain/principal';
import {toOrgId} from '../../domain/org-id';
export {BackfillScopeSchema};
export type {BackfillScope};
export type LegacyBodyCounts={snapshots:number;updates:number;commentThreads:number;commentReceipts:number};
export const legacyBodyCount=(counts:LegacyBodyCounts)=>Object.values(counts).reduce((a,b)=>a+b,0);
export class StorageBackfillError extends Error{constructor(readonly code:string){super(code);}}
export interface StorageBackfillPort{
 /** All-board enumeration requires a current organization admin. Never returns bodies. */
 list(p:Principal,after:string|null,limit:number):Promise<string[]>;
 inspect(p:Principal,boardId:string):Promise<{archived:boolean;remaining:LegacyBodyCounts}>;
 migrate(p:Principal,boardId:string,maxRows:number):Promise<{archived:boolean;migrated:number;remaining:LegacyBodyCounts}>;
}
export function backfillScopeHash(scope:BackfillScope){return createHash('sha256').update(JSON.stringify(scope)).digest('hex');}
const safeFailure=(error:unknown)=>error&&typeof error==='object'&&'code'in error&&typeof error.code==='string'&&['NOT_FOUND','FORBIDDEN','INTEGRITY_FAILED','DEPENDENCY_UNAVAILABLE','VALIDATION_FAILED','40001','40P01','42501','23514'].includes(error.code)?error.code:'BACKFILL_FAILED';
export async function runStorageBackfill(port:StorageBackfillPort,rawScope:unknown,options:{execute?:boolean;cursor?:string;boardLimit?:number;rowLimit?:number;delayMs?:number},sleep:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms))){
 const scope=BackfillScopeSchema.parse(rawScope),scopeHash=backfillScopeHash(scope);
 const config=BackfillConfigSchema.parse({execute:options.execute??false,boardLimit:options.boardLimit??20,rowLimit:options.rowLimit??100,delayMs:options.delayMs??100});
 let state={version:1 as const,scopeHash,execute:config.execute,failures:0,tenant:0,after:null as string|null};
 if(options.cursor){try{if(options.cursor.length>2048)throw Error();state=BackfillCursorSchema.parse(JSON.parse(Buffer.from(options.cursor,'base64url').toString('utf8')));if(state.scopeHash!==scopeHash||state.execute!==config.execute||state.tenant>=scope.length)throw Error();}catch{throw new StorageBackfillError('INVALID_CURSOR');}}
 const boards:Array<{orgId:string;boardId:string;archived:boolean;migrated:number;remaining:LegacyBodyCounts}>=[],failures:Array<{orgId:string;boardId:string|null;code:string}>=[];
 let visited=0,remainingRowBudget=config.rowLimit;
 while(state.tenant<scope.length&&visited<config.boardLimit&&(!config.execute||remainingRowBudget>0)){
  const tenant=scope[state.tenant]!,p={orgId:toOrgId(tenant.orgId),userId:tenant.actorId};
  let ids:string[];
  try{ids='allBoards'in tenant?await port.list(p,state.after,config.boardLimit-visited):[...new Set(tenant.boardIds)].sort().filter(id=>!state.after||id>state.after).slice(0,config.boardLimit-visited);}
  catch(error){state.failures++;failures.push({orgId:tenant.orgId,boardId:null,code:safeFailure(error)});state={...state,tenant:state.tenant+1,after:null};visited++;continue;}
  if(!ids.length){state={...state,tenant:state.tenant+1,after:null};continue;}
  let partial=false;
  for(const boardId of ids){
   if(visited>0&&config.delayMs)await sleep(config.delayMs);visited++;
   try{const result=config.execute?await port.migrate(p,boardId,remainingRowBudget):{...await port.inspect(p,boardId),migrated:0};boards.push({orgId:tenant.orgId,boardId,...result});if(config.execute)remainingRowBudget-=result.migrated;
    if(config.execute&&legacyBodyCount(result.remaining)>0){partial=true;break;}
   }catch(error){state.failures++;failures.push({orgId:tenant.orgId,boardId,code:safeFailure(error)});}
   state={...state,after:boardId};
   if(config.execute&&remainingRowBudget===0)break;
  }
  if(partial)break;
 }
 const cursor=state.tenant<scope.length?Buffer.from(JSON.stringify(state)).toString('base64url'):null;
 return {version:1,mode:config.execute?'execute':'dry-run',scopeHash,boards,failures,cursor,scanComplete:cursor===null,failureCount:state.failures,batchMigrated:config.execute&&!failures.length&&boards.every(board=>legacyBodyCount(board.remaining)===0)};
}
