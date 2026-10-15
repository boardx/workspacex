import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {markCatalog,markConstraintDifferences,markCatalogFormatting} from './diagnostic';
function formattingMetadata(actual:Record<string,unknown>,expected:Record<string,unknown>){
 const categories=['database','namespaces','relations','columns','constraints','indexes','triggers','views','rules','inheritance','types','enumLabels','collations','sequences','functions','policies','defaultAcl','extensions','roles','memberships','agePresence','graphs','labels'];
 const differences=categories.filter(k=>!isDeepStrictEqual(actual[k],expected[k])).map(category=>({category,sourceCount:Array.isArray(expected[category])?(expected[category]as any[]).length:null,targetCount:Array.isArray(actual[category])?(actual[category]as any[]).length:null}));
 const projection=(rows:any[])=>rows.map(row=>{
  const match=row.internal===true&&typeof row.name==='string'?row.name.match(/^RI_ConstraintTrigger_([ac])_\d+$/):null;
  if(!match||typeof row.definition!=='string')return row;
  return {...row,name:'RI_ConstraintTrigger_'+match[1],definition:row.definition.split(row.name).join('RI_ConstraintTrigger_'+match[1])};
 }).map(row=>JSON.stringify(row)).sort();
 const source=expected.triggers,target=actual.triggers;
 return {differences,riGeneratedNameProjectionEqual:Array.isArray(source)&&Array.isArray(target)?isDeepStrictEqual(projection(source),projection(target)):null,
  sourceGeneratedRICount:Array.isArray(source)?source.filter(row=>row.internal===true&&/^RI_ConstraintTrigger_[ac]_\d+$/.test(row.name)).length:null,
  targetGeneratedRICount:Array.isArray(target)?target.filter(row=>row.internal===true&&/^RI_ConstraintTrigger_[ac]_\d+$/.test(row.name)).length:null};
}
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
 markCatalogFormatting(formattingMetadata(actual,expected));
 assert(isDeepStrictEqual(Object.keys(actual).sort(),Object.keys(expected).sort()),'RESTORE_CATALOG_SCOPE_MISMATCH');
 for(const category of Object.keys(expected)){
  markCatalog(category);
  if(category==='constraints'&&!isDeepStrictEqual(actual[category],expected[category]))markConstraintDifferences(constraintDifferences(actual[category]as any[],expected[category]as any[]));
  assert(isDeepStrictEqual(actual[category],expected[category]),'RESTORE_CATALOG_MISMATCH');
 }
}
