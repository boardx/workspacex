import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { strict as assert } from 'node:assert';

/** Read-only producer. Uses the same isolated PG* environment as the running API;
 * uses the API package’s existing pg driver; never starts services or writes fixtures. */
export async function produceImageStorageEvidence(orgId: string, boardIds: string[], assetId: string) {
  for(const variable of ['PGHOST','PGPORT','PGDATABASE']) assert(process.env[variable],`Isolated ${variable} required for storage evidence`);
  assert(boardIds.length > 0 && boardIds.every(id => /^[0-9a-f-]{36}$/i.test(id)));
  const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const sql = `BEGIN READ ONLY;
SELECT set_config('app.current_org',${literal(orgId)},true);
SELECT json_build_object(
 'assets',(SELECT coalesce(json_agg(json_build_object('boardId',a.board_id,'key',a.object_key,'metadata',a.metadata,'active',r.state='active' AND r.released_at IS NULL)), '[]'::json) FROM whiteboard_image_assets a JOIN whiteboard_asset_refs r USING(org_id,board_id,object_key) WHERE a.org_id=${literal(orgId)} AND a.board_id IN (${boardIds.map(literal).join(',')}) AND a.asset_id=${literal(assetId)}),
 'documents',(SELECT coalesce(json_agg(json_build_object('boardId',board_id,'epoch',epoch,'seq',seq,'key',object_key,'hash',content_hash,'size',byte_size,'bodyIsNull',snapshot IS NULL)), '[]'::json) FROM whiteboard_documents WHERE org_id=${literal(orgId)} AND board_id IN (${boardIds.map(literal).join(',')})),
 'inlineUpdates',(SELECT count(*) FROM whiteboard_updates WHERE org_id=${literal(orgId)} AND board_id IN (${boardIds.map(literal).join(',')}) AND ("update" IS NOT NULL OR update_object_key IS NULL)),
 'binaryAssetColumns',(SELECT count(*) FROM information_schema.columns WHERE table_name='whiteboard_image_assets' AND data_type='bytea')
); ROLLBACK;`;
  // Resolve the runtime's installed driver without introducing a web dependency.
  const {Client}=createRequire(resolve(__dirname,'../../../api/package.json'))('pg') as {
    Client:new()=>{connect():Promise<void>;query(sql:string):Promise<Array<{rows:Array<Record<string,unknown>>}>>;end():Promise<void>};
  };
  const client=new Client();
  let result:Array<{rows:Array<Record<string,unknown>>}>;
  try{await client.connect();result=await client.query(sql);}finally{await client.end();}
  const payload=result.flatMap(part=>part.rows).find(row=>'json_build_object' in row)?.json_build_object;
  const evidence = payload as {
    assets: Array<{boardId:string;key:string;metadata:Record<string,unknown>;active:boolean}>;
    documents: Array<{boardId:string;epoch:number;seq:number;key:string;hash:string;size:number;bodyIsNull:boolean}>;
    inlineUpdates:number; binaryAssetColumns:number;
  };
  assertImageStorageEvidence(evidence,boardIds,assetId);
  return evidence;
}
export function assertImageStorageEvidence(evidence: {assets:Array<{boardId:string;key:string;metadata:Record<string,unknown>;active:boolean}>;documents:Array<{boardId:string;key:string;hash:string;size:number;bodyIsNull:boolean}>;inlineUpdates:number;binaryAssetColumns:number}, boardIds:string[],assetId:string) {
  assert(evidence, 'producer must return real PG evidence');
  assert.equal(evidence.assets.length,boardIds.length); assert.equal(evidence.documents.length,boardIds.length);
  assert.deepEqual(evidence.assets.map(value=>value.boardId).sort(),[...boardIds].sort());
  assert.deepEqual(evidence.documents.map(value=>value.boardId).sort(),[...boardIds].sort());
  assert.equal(evidence.inlineUpdates,0); assert.equal(evidence.binaryAssetColumns,0);
  assert.equal(new Set(evidence.assets.map(asset=>asset.key)).size,boardIds.length,'each board owns an independent blob key');
  for(const asset of evidence.assets){assert(asset.active);assert(asset.key.includes(`/boards/${asset.boardId}/assets/`));assert.equal(asset.metadata.assetId,assetId);assert.equal(asset.metadata.persistence,'durable');assert(!JSON.stringify(asset.metadata).includes('base64'));}
  for(const document of evidence.documents){assert(document.bodyIsNull);assert(document.key?.includes(`/boards/${document.boardId}/`));assert.match(document.hash,/^[a-f0-9]{64}$/);assert(Number(document.size)>0);}
  return evidence;
}
