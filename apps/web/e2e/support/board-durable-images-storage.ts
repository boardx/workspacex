import { execFile } from 'node:child_process';
import { strict as assert } from 'node:assert';

/** Read-only producer. Uses the same isolated PG* environment as the running API;
 * requires psql, never starts services and never writes fixtures to the database. */
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
  // Pipe SQL to stdin: credentials and SQL are never embedded in shell commands.
  const run = execFile(process.env.WHITEBOARD_PSQL_BIN ?? 'psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { env: process.env, maxBuffer: 1024 * 1024 });
  const completed = new Promise<string>((resolve, reject) => { let output = '', error = ''; run.stdout?.on('data', chunk => output += chunk); run.stderr?.on('data', chunk => error += chunk); run.on('error', reject); run.on('close', code => code === 0 ? resolve(output) : reject(new Error(`Storage producer psql failed (${code}): ${error}`))); });
  run.stdin?.end(sql);
  const lines = (await completed).trim().split('\n');
  const evidence = JSON.parse(lines.find(line => line.startsWith('{')) ?? 'null') as {
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
