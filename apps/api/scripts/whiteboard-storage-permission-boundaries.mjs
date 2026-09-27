import ts from 'typescript';
const path=name=>`src/infrastructure/whiteboard/${name}.ts`;
const method=(queries,required=[],ordered=[])=>({queries,required,ordered});
const transaction='this.db.withTenant(p.orgId,';
/** These are internal adapters, not alternate public authorization policies.
 * Exact method inventories/query counts keep a new same-table read from inheriting
 * admission. Method-local token checks pin authorization before disclosure/replay.
 * AST printing drops comments, so an invariant mentioned only in a comment fails.
 */
export const whiteboardStoragePermissionBoundaries=new Map([
 [path('storage-maintenance-access'),{
  tables:['org_memberships','whiteboards'],checks:[],
  reason:'#4255 operator maintenance uses the identity-domain administrator policy or current board ownership, with membership and board locks; storage-permission-boundary.test.ts mutation checks enforce the scope.',
  required:["from '../../domain/auth/org-lifecycle'"],
  methods:{
   lockStorageOperatorMembership:method(1,["assertPrincipal(p)","SELECT org_role FROM org_memberships WHERE org_id=$1 AND user_id=$2 FOR SHARE","[p.orgId,p.userId]","if(!member.rows[0])throw new StorageBackfillError('NOT_FOUND')","administrator:canExportOrganization(member.rows[0].org_role)"]),
   lockBoardStorageMaintenance:method(1,["if(!boardId){if(!member.administrator)throw new StorageBackfillError('FORBIDDEN')","SELECT owner_id,archived FROM whiteboards WHERE org_id=$1 AND id=$2 FOR UPDATE","[p.orgId,boardId]","if(!board.rows[0]||(!member.administrator&&board.rows[0].owner_id!==p.userId))throw new StorageBackfillError('NOT_FOUND')"],["await lockStorageOperatorMembership(s,p)","SELECT owner_id,archived FROM whiteboards","return {archived:board.rows[0].archived}"]),
  },
 }],
 [path('pg-storage-backfill'),{
  tables:['whiteboard_documents','whiteboard_updates','whiteboard_comment_threads','whiteboard_comment_requests','whiteboards'],checks:[],
  reason:'#4255 metadata-only legacy backfill uses the locked storage operator boundary before counts, enumeration or in-transaction pointer migration; no content bytes escape this port.',
  required:["from './storage-maintenance-access'"],
  methods:{
   counts:method(1,['FROM whiteboard_documents WHERE org_id=$1 AND board_id=$2 AND snapshot IS NOT NULL','FROM whiteboard_updates WHERE org_id=$1 AND board_id=$2 AND update IS NOT NULL','FROM whiteboard_comment_threads WHERE org_id=$1 AND board_id=$2 AND body_object_key IS NULL','FROM whiteboard_comment_requests WHERE org_id=$1 AND board_id=$2 AND response_object_key IS NULL','[p.orgId,id]','return {snapshots:Number(row.snapshots),updates:Number(row.updates),commentThreads:Number(row.threads),commentReceipts:Number(row.receipts)}']),
   list:method(1,[transaction,'WHERE org_id=$1 AND ($2::uuid IS NULL OR id>$2::uuid) ORDER BY id LIMIT $3','[p.orgId,after,limit]','return result.rows.map(row=>row.id)'],['await lockBoardStorageMaintenance(s,p)','SELECT id FROM whiteboards']),
   inspect:method(0,[transaction],['await lockBoardStorageMaintenance(s,p,id)','await this.counts(s,p,id)']),
   migrate:method(0,[transaction],['await lockBoardStorageMaintenance(s,p,id)','this.collaboration.backfillStorageInTransaction(s,p,id,maxRows)','this.comments.backfillStorageInTransaction(s,p,id,maxRows-migrated)','await this.counts(s,p,id)']),
  },
 }],
 [path('pg-backup-maintenance'),{
  tables:['whiteboard_backups','whiteboards','whiteboard_backup_pins','whiteboard_backup_restores','whiteboard_backup_maintenance_receipts','whiteboard_documents'],checks:[],
  reason:'#4255 retention/recovery requires locked organization membership plus current source-board ownership (or administrator), actor-bound receipts and current manifest CAS, before disclosing captures or changing roots.',
  required:["from './storage-maintenance-access'"],
  methods:{
   state:method(7,[
    "WHERE org_id=$1 AND backup_id=$2`,[p.orgId,request.backupId]",
    "if(request.action==='recover-manifest'&&owner.source_board_id!==request.boardId)fail('NOT_FOUND')",
    "SELECT owner_id FROM whiteboards WHERE org_id=$1 AND id=$2 FOR UPDATE",
    "[p.orgId,owner.source_board_id]",
    "if(!actor.administrator&&((boards.rows[0]&&boards.rows[0].owner_id!==p.userId)||(!boards.rows[0]&&owner.actor_id!==p.userId)))fail('NOT_FOUND')",
    "if(request.action==='recover-manifest'&&!boards.rows[0])fail('NOT_FOUND')",
    "FROM whiteboard_backups WHERE org_id=$1 AND backup_id=$2 FOR UPDATE",
    "validateBackupManifest(row!.capture)","backupHash(JSON.stringify(manifest))!==row!.manifest_hash",
    "FROM whiteboard_backup_pins WHERE org_id=$1 AND backup_id=$2 AND released_at IS NULL",
    "FROM whiteboard_backup_restores WHERE org_id=$1 AND backup_id=$2 AND status='preparing'",
    "FROM whiteboard_backup_maintenance_receipts WHERE org_id=$1 AND request_id=$2",
    "if(receipts.rows[0]&&receipts.rows[0].actor_id!==p.userId)fail('IDEMPOTENCY_CONFLICT')",
    "FROM whiteboard_documents WHERE org_id=$1 AND board_id=$2 FOR UPDATE","[p.orgId,request.boardId]",
   ],['await lockStorageOperatorMembership(s,p)','SELECT source_board_id,actor_id','SELECT owner_id FROM whiteboards',"if(!actor.administrator",'SELECT capture,status','return {backup:']),
   inspect:method(0,[transaction,'s=>this.state(s,p,request)']),
   replay:method(0,["if(state.receipt&&state.receipt.requestHash!==requestHash)fail('IDEMPOTENCY_CONFLICT')"]),
   save:method(1,['INSERT INTO whiteboard_backup_maintenance_receipts(org_id,request_id,backup_id,actor_id,action,payload)','[p.orgId,receipt.requestId,receipt.backupId,p.userId,receipt.action,JSON.stringify(receipt)]']),
   release:method(1,[transaction,"state.backup.manifestHash!==expectedHash","state.backup.status!=='verified'","state.createdAt>cutoff","if(state.activeRestores)fail('RESTORE_IN_PROGRESS')","WHERE org_id=$1 AND backup_id=$2 AND released_at IS NULL RETURNING object_key","[p.orgId,request.backupId]"],['await this.state(s,p,request)','this.replay(state,requestHash)','if(replay)return replay','UPDATE whiteboard_backup_pins','this.save(s,p,']),
   recover:method(1,[transaction,'validateMaintenanceState(state,request,new Date())',"state.backup.manifestHash!==expectedHash","whiteboards/tenants/${backupHash(p.orgId).slice(0,32)}/boards/${request.boardId}/epochs/${request.expectedEpoch}/recovered/${request.requestId}-${state.snapshot!.hash}.yjs","if(ref.key!==expectedKey||ref.hash!==state.snapshot!.hash||ref.bytes!==state.snapshot!.bytes||ref.mime!=='application/vnd.yjs-update')fail('BACKUP_INTEGRITY_FAILED')","WHERE org_id=$1 AND board_id=$2 AND epoch=$3 AND seq=$4 AND content_hash=$6 AND snapshot IS NULL AND manifest_version=1 RETURNING board_id","[p.orgId,request.boardId,request.expectedEpoch,request.expectedSeq,ref.key,ref.hash]","if(!updated.rows.length)fail('CURRENT_CONTENT_CHANGED')"],['await this.state(s,p,request)','this.replay(state,requestHash)','if(replay)return replay','validateMaintenanceState','UPDATE whiteboard_documents','this.save(s,p,']),
  },
 }],
 [path('pg-portable-board'),{
  tables:['whiteboards','whiteboard_members','whiteboard_portable_imports'],checks:[],
  reason:'#4255 portable publication locks the destination before fresh membership, checks write/archive before replay, verifies tenant-board media keys/readback and publishes canonical commands plus asset roots atomically.',
  methods:{publish:method(4,[transaction,'SELECT owner_id,archived FROM whiteboards WHERE org_id=$1 AND id=$2 FOR UPDATE','[p.orgId,boardId]','SELECT role FROM whiteboard_members WHERE org_id=$1 AND board_id=$2 AND user_id=$3','[p.orgId,boardId,p.userId]',"if(!C.BoardRole.safeParse(role).success)throw new Fault('NOT_FOUND')","if(!['owner','editor'].includes(role!))throw new Fault('FORBIDDEN')","if(board.archived)throw new Fault('ARCHIVED')",'WHERE org_id=$1 AND board_id=$2 AND actor_id=$3 AND request_id=$4','[p.orgId,boardId,p.userId,input.requestId]',"if(row.request_hash!==input.requestHash)throw new Fault('IDEMPOTENCY_CONFLICT')",'whiteboards/tenants/${portableHash(p.orgId).slice(0,32)}/boards/${boardId}/assets/${image.metadata.contentDigest.slice(7)}','`sha256:${portableHash(bytes)}`!==image.metadata.contentDigest','this.collaboration.writeCommandsInTransaction(session,p,boardId,','this.assets.saveInTransaction(session,p,boardId,record)','[p.orgId,boardId,p.userId,input.requestId,input.requestHash,input.expectedEpoch,seq,input.commands.length,input.images.length]'],['SELECT owner_id,archived','SELECT role FROM whiteboard_members',"if(!['owner','editor']",'SELECT request_hash,epoch','this.objects.putOnce','this.objects.get(key)','this.collaboration.writeCommandsInTransaction','this.assets.saveInTransaction','INSERT INTO whiteboard_portable_imports','return{epoch:input.expectedEpoch'])},
 }],
 [path('pg-image-assets'),{
  tables:['whiteboard_image_assets','whiteboard_asset_refs'],checks:[],
  reason:'#4255 internal image metadata port is admitted together with WhiteboardImageAssets.read pre/post-blob ACL and digest verification; portable writes use the locked publisher above. No raw storage path is returned by the HTTP service.',
  methods:{
   save:method(0,['this.db.withTenant(p.orgId,session=>this.saveInTransaction(session,p,boardId,record))']),
   saveInTransaction:method(2,['INSERT INTO whiteboard_asset_refs(org_id,board_id,object_key,content_hash,byte_size,state,activated_at)',"ON CONFLICT(org_id,board_id,object_key) DO UPDATE SET state='active'",'[p.orgId, boardId, record.objectKey, record.metadata.contentDigest.slice(7), record.metadata.byteSize]','INSERT INTO whiteboard_image_assets(org_id,board_id,asset_id,object_key,metadata)','[p.orgId, boardId, record.metadata.assetId, record.objectKey, JSON.stringify(record.metadata)]']),
   get:method(1,[transaction,'JOIN whiteboard_asset_refs r ON r.org_id=a.org_id AND r.board_id=a.board_id AND r.object_key=a.object_key',"WHERE a.org_id=$1 AND a.board_id=$2 AND a.asset_id=$3 AND r.state='active' AND r.released_at IS NULL",'[p.orgId, boardId, assetId]','metadata:WhiteboardAssetMetadata.parse(row.metadata)']),
  },
  related:{'src/application/whiteboard/image-assets.ts':{
   read:method(0,['WhiteboardAssetId.parse(untrustedId)','return { metadata: record.metadata, bytes }'],['await this.access(p, boardId, false)','this.repository.get(p, boardId, assetId)','this.verifiedBytes(p, boardId, record)','await this.access(p, boardId, false)','return { metadata:']),
   access:method(0,["const board = await this.boards.get(p, boardId)","if (!board) throw new WhiteboardImageError('NOT_FOUND')","if (write && (!['owner','editor'].includes(board.role) || board.archived)) throw new WhiteboardImageError('FORBIDDEN')"]),
   verifiedBytes:method(0,['const expected = `${this.prefix(p, boardId)}${record.metadata.contentDigest.slice(7)}`',"if (record.objectKey !== expected) throw new WhiteboardImageError('INTEGRITY_FAILED')",'this.objects.get(record.objectKey)','this.objects.head(record.objectKey)','bytes.byteLength !== record.metadata.byteSize','head.sizeBytes !== bytes.byteLength','head.mime !== record.metadata.mimeType',"createHash('sha256').update(bytes).digest('hex')}` !== record.metadata.contentDigest"]),
   prefix:method(0,["createHash('sha256').update(p.orgId).digest('hex').slice(0,32)",'/boards/${boardId}/assets/']),
   upload:method(0,[],['await this.access(p, boardId, true)','this.verifier.verify(bytes, mime)','this.objects.putOnce','this.verifiedBytes','await this.access(p, boardId, true)','this.repository.save(p, boardId,','await this.access(p, boardId, true)','return metadata']),
  }},
 }],
]);
const compact=value=>value.replace(/\s+/g,'');
function parse(source){
 const file=ts.createSourceFile('boundary.ts',source,ts.ScriptTarget.Latest,true);
 const printer=ts.createPrinter({removeComments:true});const methods=new Map();let totalQueries=0;
 function visit(node){
  if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='query')totalQueries++;
  if((ts.isMethodDeclaration(node)||ts.isFunctionDeclaration(node))&&node.name){
   let queries=0;function count(n){if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='query')queries++;ts.forEachChild(n,count);}count(node);
   methods.set(node.name.getText(file),{source:compact(printer.printNode(ts.EmitHint.Unspecified,node,file)),queries});
  }
  ts.forEachChild(node,visit);
 }visit(file);return{methods,totalQueries,source:compact(printer.printFile(file))};
}
function auditMethods(path,actual,expected,exact,failures){
 if(exact&&(actual.size!==Object.keys(expected).length||[...actual.keys()].some(name=>!expected[name])))failures.push(`${path}: method inventory changed`);
 for(const [name,rule] of Object.entries(expected)){
  const found=actual.get(name);if(!found){failures.push(`${path}: missing method ${name}`);continue;}
  if(found.queries!==rule.queries)failures.push(`${path}: ${name} query count changed`);
  for(const required of rule.required)if(!found.source.includes(compact(required)))failures.push(`${path}: ${name} invariant missing (${required})`);
  let offset=0;for(const required of rule.ordered){const index=found.source.indexOf(compact(required),offset);if(index<0){failures.push(`${path}: ${name} authorization order missing (${required})`);break;}offset=index+compact(required).length;}
 }
}
export function verifyWhiteboardStoragePermissionBoundaries(read){
 const failures=[];
 for(const [path,rule] of whiteboardStoragePermissionBoundaries){
  const parsed=parse(read(path));if(parsed.totalQueries!==[...parsed.methods.values()].reduce((sum,method)=>sum+method.queries,0))failures.push(`${path}: query outside admitted methods`);auditMethods(path,parsed.methods,rule.methods,true,failures);
  for(const required of rule.required??[])if(!parsed.source.includes(compact(required)))failures.push(`${path}: authority dependency missing (${required})`);
  for(const [related,methods]of Object.entries(rule.related??{}))auditMethods(path,parse(read(related)).methods,methods,false,failures);
 }
 return failures;
}
