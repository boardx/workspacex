import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {Principal} from '../../domain/principal';
import {toOrgId} from '../../domain/org-id';
const identity=z.string().min(1).max(256);
export const BackfillScopeSchema=z.array(z.union([
 z.object({orgId:identity,actorId:identity,allBoards:z.literal(true)}).strict(),
 z.object({orgId:identity,actorId:identity,boardIds:z.array(z.string().uuid()).min(1).max(10000)}).strict(),
])).min(1).max(10000).refine(rows=>new Set(rows.map(row=>row.orgId)).size===rows.length);
export type BackfillScope=z.infer<typeof BackfillScopeSchema>;
export type LegacyBodyCounts={snapshots:number;updates:number;commentThreads:number;commentReceipts:number};
export const legacyBodyCount=(counts:LegacyBodyCounts)=>Object.values(counts).reduce((a,b)=>a+b,0);
export class StorageBackfillError extends Error{constructor(readonly code:string){super(code);}}
export interface StorageBackfillPort{
 /** All-board enumeration requires a current organization admin. Never returns bodies. */
 list(p:Principal,after:string|null,limit:number):Promise<string[]>;
 inspect(p:Principal,boardId:string):Promise<{archived:boolean;remaining:LegacyBodyCounts}>;
 migrate(p:Principal,boardId:string,maxRows:number):Promise<{archived:boolean;migrated:number;remaining:LegacyBodyCounts}>;
}
const Cursor=z.object({version:z.literal(1),scopeHash:z.string().regex(/^[a-f0-9]{64}$/),execute:z.boolean(),failures:z.number().int().nonnegative(),tenant:z.number().int().nonnegative(),after:z.string().uuid().nullable()}).strict();
export function backfillScopeHash(scope:BackfillScope){return createHash('sha256').update(JSON.stringify(scope)).digest('hex');}
const safeFailure=(error:unknown)=>error&&typeof error==='object'&&'code'in error&&typeof error.code==='string'&&['NOT_FOUND','FORBIDDEN','INTEGRITY_FAILED','DEPENDENCY_UNAVAILABLE','VALIDATION_FAILED','40001','40P01','42501','23514'].includes(error.code)?error.code:'BACKFILL_FAILED';
export async function runStorageBackfill(port:StorageBackfillPort,rawScope:unknown,options:{execute?:boolean;cursor?:string;boardLimit?:number;rowLimit?:number;delayMs?:number},sleep:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms))){
 const scope=BackfillScopeSchema.parse(rawScope),scopeHash=backfillScopeHash(scope);
 const config=z.object({execute:z.boolean(),boardLimit:z.number().int().min(1).max(1000),rowLimit:z.number().int().min(1).max(1000),delayMs:z.number().int().min(0).max(60000)}).parse({execute:options.execute??false,boardLimit:options.boardLimit??20,rowLimit:options.rowLimit??100,delayMs:options.delayMs??100});
 let state={version:1 as const,scopeHash,execute:config.execute,failures:0,tenant:0,after:null as string|null};
 if(options.cursor){try{if(options.cursor.length>2048)throw Error();state=Cursor.parse(JSON.parse(Buffer.from(options.cursor,'base64url').toString('utf8')));if(state.scopeHash!==scopeHash||state.execute!==config.execute||state.tenant>=scope.length)throw Error();}catch{throw new StorageBackfillError('INVALID_CURSOR');}}
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
