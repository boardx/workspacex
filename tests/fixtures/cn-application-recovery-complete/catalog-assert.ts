import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {markCatalog,markConstraintDifferences} from './diagnostic';
export function constraintDifferences(actual:any[],expected:any[]){
 const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
 const key=(row:any)=>JSON.stringify([row.schema,row.relation,row.name,row.kind]);
 const old=new Map(expected.map(row=>[key(row),row]));const current=new Map(actual.map(row=>[key(row),row]));
 const changes=[];let count=0;
 for(const identity of new Set([...old.keys(),...current.keys()])){
  const a=current.get(identity),b=old.get(identity);if(isDeepStrictEqual(a,b))continue;count++;
  if(changes.length>=8)continue;
  const fields=['schema','relation','name','kind','deferrable','deferred','validated','definition'].filter(field=>!isDeepStrictEqual(a?.[field],b?.[field]));
  const projection=(row:any)=>row?{validated:typeof row.validated==='boolean'?row.validated:null,deferrable:typeof row.deferrable==='boolean'?row.deferrable:null,deferred:typeof row.deferred==='boolean'?row.deferred:null,definitionSha256:hash(String(row.definition)),definitionBytes:Buffer.byteLength(String(row.definition)),notValid:/\bNOT VALID\b/.test(String(row.definition))}:null;
  changes.push({identitySha256:hash(identity),fields,actual:projection(a),expected:projection(b)});
 }
 return {actualCount:actual.length,expectedCount:expected.length,differingCount:count,changes};
}
/** Complete comparison; never format the full application catalog on failure. */
export function assertCatalogEqual(actual:Record<string,unknown>,expected:Record<string,unknown>){
 assert(isDeepStrictEqual(Object.keys(actual).sort(),Object.keys(expected).sort()),'RESTORE_CATALOG_SCOPE_MISMATCH');
 for(const category of Object.keys(expected)){
  markCatalog(category);
  if(category==='constraints'&&!isDeepStrictEqual(actual[category],expected[category]))markConstraintDifferences(constraintDifferences(actual[category]as any[],expected[category]as any[]));
  assert(isDeepStrictEqual(actual[category],expected[category]),'RESTORE_CATALOG_MISMATCH');
 }
}
