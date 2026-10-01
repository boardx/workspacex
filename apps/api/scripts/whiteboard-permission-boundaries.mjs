import {whiteboardStoragePermissionBoundaries,verifyWhiteboardStoragePermissionBoundaries} from './whiteboard-storage-permission-boundaries.mjs';
/**
 * Private Board metadata and content operations cannot use the generic acl_bindings
 * filter: their authority is the Board owner/member relation. These are admitted only
 * while the production lint can prove the actor, tenant, locking and replay invariants.
 */
export const whiteboardPermissionBoundaries = new Map([
  ['src/infrastructure/whiteboard/pg-operation-undo-store.ts', {
    tables: ['whiteboard_operation_undo','whiteboard_operations','whiteboard_documents','whiteboard_comment_threads','whiteboard_asset_refs'],
    reason: 'Board Undo stays inside the already-authorized operation transaction and binds every receipt, document, comment restoration and asset reference to the same tenant and Board; the operation guard tests pin authorization before compensation.',
    checks: [/WHERE u\.org_id=\$1 AND u\.board_id=\$2 AND u\.operation_id=\$3/],
  }],
  ['src/infrastructure/whiteboard/pg-import-repository.ts', {
    tables: ['whiteboard_imports','whiteboard_asset_refs'],
    reason: 'Board imports are authorized by WhiteboardImportService before repository access; every record and leased asset transition remains scoped by organization, Board, import identity and actor-bound replay metadata.',
    checks: [/WHERE org_id=\$1 AND board_id=\$2 AND id=\$3 FOR UPDATE/],
  }],
  ['src/infrastructure/whiteboard/pg-export-repository.ts', {
    tables: ['whiteboard_exports'],
    reason: 'Board exports are authorized before repository access and this adapter exposes only immutable object-store pointer metadata scoped by organization, Board and export identity, never package bytes.',
    checks: [/WHERE org_id=\$1 AND board_id=\$2 AND id=\$3/],
  }],
  ['src/infrastructure/whiteboard/pg-recovery-metadata.ts', {
    tables: ['whiteboards','whiteboard_members','whiteboard_documents','whiteboard_checkpoints','whiteboard_updates','whiteboard_recovery_events','whiteboard_restore_receipts'],
    reason: 'Checkpoint and recovery metadata use a locked owner/member lookup before reads, require the owner for restore, and compare-and-swap the exact document head before publishing a new epoch.',
    checks: [/SELECT owner_id,archived FROM whiteboards WHERE org_id=\$1 AND id=\$2/],
  }],
  ['src/infrastructure/whiteboard/pg-operation-repository.ts', {
    tables: ['whiteboards','whiteboard_members','whiteboard_documents','whiteboard_operations','whiteboard_operation_events','whiteboard_actor_identities','artifacts','artifact_versions','acl_bindings','whiteboard_artifact_layout_bindings'],
    reason: 'Board operation receipts and events require a locked current owner/member decision; delegated actors remain bound to the authenticated user, while artifact reads require the exact immutable version and issued layout binding.',
    checks: [/SELECT owner_id,archived FROM whiteboards WHERE org_id=\$1 AND id=\$2 FOR UPDATE/],
  }],
  ['src/infrastructure/whiteboard/pg-proposal-repository.ts', {
    tables: ['whiteboard_ai_proposals','whiteboard_asset_refs'],
    reason: 'Durable Board proposals are reached only after the Board operation authority lock and bind each body pointer and replay transition to organization, Board, proposal and original actor metadata.',
    checks: [/WHERE org_id=\$1 AND board_id=\$2 AND proposal_id=\$3 FOR UPDATE/],
  }],
  ['src/infrastructure/whiteboard/pg-presentation-repository.ts', {
    tables: ['whiteboards','whiteboard_members','whiteboard_presentation_sessions','whiteboard_room_identities'],
    reason: 'Presentation state inherits current private Board membership; room identities bind reconnect tokens to their owner, and handoff targets must be a Board owner, member or registered room identity.',
    checks: [/SELECT 1 FROM whiteboards w WHERE w\.org_id=\$1 AND w\.id=\$2/],
  }],
  ['src/infrastructure/whiteboard/chat-artifact-access.ts', {
    tables: ['chat_artifact_landings','chat_threads','provenance_events'],
    reason: '#4256 ids-only Chat artifact locator returns only a policy boolean; content authority is the existing Chat resolveVisibility and draft-source policy, using the operation tenant transaction.',
    checks: [
      /SELECT l\.thread_id,t\.id AS existing_thread_id,t\.project_id,l\.mode,l\.created_by FROM chat_artifact_landings l/,
      /LEFT JOIN chat_threads t ON t\.org_id=l\.org_id AND t\.id=l\.thread_id/,
      /WHERE l\.org_id=\$1 AND l\.artifact_id=\$2/,
      /SELECT 1 FROM provenance_events WHERE org_id=\$1 AND target_kind='artifact' AND target_id=\$2 AND type='generated' AND detail \? 'threadId'/,
      /return former\.rows\.length \? false : null/,
      /if \(!landing\.existing_thread_id\) return false/,
      /if \(orgId !== principal\.orgId\) throw/,
      /return fn\(session\)/,
      /return canReadChatArtifactSource\(/,
      /userId: principal\.userId, orgId: principal\.orgId, projectId: landing\.project_id/,
      /mode: landing\.mode, createdBy: landing\.created_by/,
    ],
    forbidden: [/SELECT \*/, /return landing\b/, /object_storage_key/, /payload/, /markdown/],
  }],
  ...whiteboardStoragePermissionBoundaries,
  ['src/infrastructure/whiteboard/pg-board-backup.ts', {
    tables: ['org_memberships','whiteboards','whiteboard_members','whiteboard_tags','whiteboard_tag_bindings','whiteboard_documents','whiteboard_image_assets','whiteboard_asset_refs','whiteboard_comment_threads','whiteboard_backups','whiteboard_backup_pins','whiteboard_backup_restores'],
    reason: '#4255 Board backup is owner-only, rechecks tenant membership/source ownership before capture/read/retry/restore; blobs precede pointer publication, durable pins share GC fences. Unit and real storage acceptance cover failure boundaries.',
    checks: [
      /assertPrincipal\(p\)/,
      /FROM org_memberships WHERE org_id=\$1 AND user_id=\$2 FOR SHARE/,
      /SELECT owner_id FROM whiteboards WHERE org_id=\$1 AND id=\$2 FOR UPDATE/,
      /owner_id!==p.userId/,
      /FROM whiteboard_backups WHERE org_id=\$1 AND backup_id=\$2 AND actor_id=\$3 FOR UPDATE/,
      /await this.actor\(s,p,found.rows\[0\]!\.source_board_id,true\);return this.record/,
      /this.collaboration.loadInTransaction\(s,p,boardId\)/,
      /INSERT INTO whiteboard_backup_pins/,
      /INSERT INTO whiteboard_documents[\s\S]*VALUES\(\$1,\$2,1,0,NULL,1,\$3,\$4,\$5\)/,
    ],
    forbidden: [/INSERT INTO whiteboard_updates/i],
  }],
  ['src/infrastructure/whiteboard/pg-board-content-copy-store.ts', {
    tables: ['whiteboard_duplicate_requests','whiteboards','whiteboard_members','whiteboard_tag_bindings','whiteboard_tags','whiteboard_documents','whiteboard_asset_refs','whiteboard_image_assets','unnest'],
    reason: '#4242 canonical Board duplication is guarded by tests/whiteboard/board-content-copy-guard.test.ts: one tenant transaction performs actor-visible preflight, locks active tags before the source Board, captures an explicit document version, verifies tag stability, prepares canonical bytes, and publishes an actor-owned independent target.',
    checks: [
      /return this\.db\.withTenant\(p\.orgId, async session =>/,
      /ON CONFLICT\(org_id,actor_id,request_id\) DO NOTHING RETURNING job_id/,
      /await this\.assertDuplicable\(session,p,sourceBoardId\)[\s\S]*await this\.lockSourceTags\(session,p,sourceBoardId\)[\s\S]*await this\.capture\(session,p,sourceBoardId\)[\s\S]*await this\.assertTagsUnchanged\(session,p,sourceBoardId,sourceTagIds\)/,
      /FROM whiteboard_tag_bindings bt[\s\S]*JOIN whiteboard_tags t[\s\S]*t\.deleted_at IS NULL[\s\S]*FOR SHARE OF t/,
      /\(b\.owner_id=\$2 OR m\.role='editor'\) FOR SHARE OF b/,
      /!\['owner','editor'\]\.includes\(visible\.rows\[0\]\?\.role \?\? ''\)/,
      /!\['owner','editor'\]\.includes\(locked\.rows\[0\]\?\.role \?\? ''\)/,
      /this\.collaboration\.loadInTransaction\(session,p,sourceBoardId\)/,
      /input\.expectedSource[\s\S]*captured\.source\.epoch[\s\S]*captured\.source\.seq/,
      /prepared = prepare\(captured\)[\s\S]*INSERT INTO whiteboards/,
      /INSERT INTO whiteboards\(id,org_id,owner_id,request_id,name,lifecycle_revision,tags_revision\)[\s\S]*VALUES\(\$1,\$2,\$3,\$1,\$4,0,0\)[\s\S]*\[targetBoardId,p\.orgId,p\.userId,input\.targetName\]/,
      /INSERT INTO whiteboard_documents\(org_id,board_id,epoch,seq,snapshot,manifest_version,object_key,content_hash,byte_size\) VALUES\(\$1,\$2,1,0,NULL,1,\$3,\$4,\$5\)[\s\S]*\[p\.orgId,targetBoardId,ref\.key,ref\.hash,ref\.size\]/,
      /await this\.copyImageAssets\(session,p,sourceBoardId,targetBoardId,prepared\.snapshot\)/,
      /await this\.putVerified[\s\S]*INSERT INTO whiteboard_documents/,
      // Image metadata is immutable (SELECT-only); lock the mutable active reference.
      /a\.org_id=\$1 AND a\.board_id=\$2 AND a\.asset_id=\$3 AND r\.state='active' AND r\.released_at IS NULL FOR SHARE OF r/,
      /this\.digest\(readback\) !== hash/,
      /WHERE b\.org_id=\$1 AND b\.id=\$3 AND b\.owner_id=\$2/,
    ],
    forbidden: [
      /\.withoutTenant\(/,
      /INSERT INTO whiteboard_updates/i,
    ],
  }],
  ['src/infrastructure/whiteboard/pg-whiteboard-tag-repository.ts', {
    tables: ['org_memberships','whiteboard_tags','whiteboard_tag_mutation_receipts','whiteboard_tag_bindings','whiteboards'],
    reason: '#4242 Board tags are organization catalog metadata without an acl_bindings ObjectRef. Listing and creation require membership; rename and delete require the tag creator or an organization administrator, with a locked revision and durable request receipt.',
    checks: [
      /return this\.db\.withTenant\(p\.orgId, async session =>/,
      /SELECT 1 FROM org_memberships WHERE org_id=\$1 AND user_id=\$2/,
      /t\.created_by=\$2 OR EXISTS\(SELECT 1 FROM org_memberships om WHERE om\.org_id=\$1 AND om\.user_id=\$2 AND om\.org_role='admin'\)/,
      /FROM whiteboard_tags t WHERE t\.org_id=\$1 AND t\.id=\$3 AND t\.deleted_at IS NULL FOR UPDATE/,
      /row\.revision !== input\.expectedRevision/,
      /FROM whiteboard_tag_mutation_receipts WHERE org_id=\$1 AND actor_id=\$2 AND request_id=\$3/,
      /DELETE FROM whiteboard_tag_bindings WHERE org_id=\$1 AND tag_id=\$2 RETURNING board_id/,
    ],
  }],
]);

export function verifyWhiteboardPermissionBoundaries(read, tenantTables) {
  const failures = [];
  for (const [path, rule] of whiteboardPermissionBoundaries) {
    const source = read(path);
    for (const match of source.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi)) {
      const table = match[1].toLowerCase();
      if (tenantTables.has(table) && !rule.tables.includes(table)) failures.push(`${path}: unexpected tenant table ${table}`);
    }
    if (source.includes('.withoutTenant(')) failures.push(`${path}: global read is forbidden`);
    for (const pattern of rule.checks) if (!pattern.test(source)) failures.push(`${path}: authority invariant missing (${pattern})`);
    for (const pattern of rule.forbidden ?? []) if (pattern.test(source)) failures.push(`${path}: forbidden copy path present (${pattern})`);
  }
  failures.push(...verifyWhiteboardStoragePermissionBoundaries(read));
  return failures;
}
