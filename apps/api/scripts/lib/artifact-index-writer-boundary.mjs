import ts from 'typescript';
import {createHash} from 'node:crypto';
export const ARTIFACT_INDEX_WRITER_PATH='src/infrastructure/retrieval/pg-artifact-index-writer.ts';
// Fixed SQL fingerprints: configuration read, origin-checked index upsert, vector upsert.
const SQL_HASHES=["a868aefe044e3ff64e503547ec604f653a4ce08ef5e65ae47eea7a2f8d2b4666","a223b5afaa2713631ecd078e0e692a6e918e864a5877f07325111dfc99ae4b81","926ed61b3f989af75d338f97708781ec78dd45bf4a2ea7826f7ca5da78d6e8b4"];
export function checkArtifactIndexWriter(source){
 const ast=ts.createSourceFile(ARTIFACT_INDEX_WRITER_PATH,source,ts.ScriptTarget.Latest,true),calls=[],conditions=[],returns=[],errors=[];
 const compact=n=>n?.getText(ast).replace(/\s+/g,'');
 function visit(n){if(ts.isCallExpression(n))calls.push(n);if(ts.isIfStatement(n))conditions.push(n);if(ts.isReturnStatement(n))returns.push(n);ts.forEachChild(n,visit);}visit(ast);
 const load=calls.find(n=>compact(n.expression)==='this.source.load');
 const tenant=calls.find(n=>compact(n.expression)==='this.db.withTenant');
 const mismatch=conditions.find(n=>compact(n.expression)==='JSON.stringify(current)!==JSON.stringify(batch)'&&ts.isThrowStatement(n.thenStatement));
 if(!tenant||compact(tenant.arguments[0])!=='input.orgId'||!load||compact(load.arguments[0])!=='input'||!mismatch||mismatch.pos<load.pos)errors.push('same-tenant source reauthorization and exact batch match required');
 const queries=calls.filter(n=>ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='query');
 const expectedArgs=['[embedding.model,embedding.modelVersion]','[input.orgId,input.artifactVersionId,batch.contentHash,segment.segmentId,segment.content]','[segment.segmentId,input.orgId,embedding.model,embedding.modelVersion,JSON.stringify(vector.vector)]'];
 if(queries.length!==3)errors.push('only three bounded SQL shapes allowed');
 for(const[q,i]of queries.map((q,i)=>[q,i])){
  const literal=q.arguments[0];
  if(!literal||!ts.isStringLiteralLike(literal)||createHash('sha256').update(literal.text.replace(/\s+/g,' ').trim()).digest('hex')!==SQL_HASHES[i]||compact(q.arguments[1])!==expectedArgs[i]||!mismatch||q.pos<mismatch.pos)errors.push('fixed tenant/source SQL and parameters required');
 }
 if(calls.some(n=>compact(n.expression)?.endsWith('withoutTenant'))||returns.length)errors.push('no raw result or unscoped reads');
 return errors;
}
