/**
 * Private Board metadata and content operations cannot use the generic acl_bindings
 * filter: their authority is the Board owner/member relation. These are admitted only
 * while the production lint can prove the actor, tenant, locking and replay invariants.
 */
export const whiteboardPermissionBoundaries = new Map([
  ['src/infrastructure/whiteboard/chat-artifact-access.ts', {
    tables: ['chat_artifact_landings','chat_threads'],
    reason: '#4256 ids-only Chat artifact locator returns only a policy boolean; content authority is the existing Chat resolveVisibility and draft-source policy, using the operation tenant transaction.',
    checks: [
      /SELECT l\.thread_id,t\.id AS existing_thread_id,t\.project_id,l\.mode,l\.created_by FROM chat_artifact_landings l/,
      /LEFT JOIN chat_threads t ON t\.org_id=l\.org_id AND t\.id=l\.thread_id/,
      /WHERE l\.org_id=\$1 AND l\.artifact_id=\$2/,
      /if \(!landing\.existing_thread_id\) return false/,
      /if \(orgId !== principal\.orgId\) throw/,
      /return fn\(session\)/,
      /return canReadChatArtifactSource\(/,
      /userId: principal\.userId, orgId: principal\.orgId, projectId: landing\.project_id/,
      /mode: landing\.mode, createdBy: landing\.created_by/,
    ],
    forbidden: [/SELECT \*/, /return landing\b/, /object_storage_key/, /payload/, /markdown/],
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
      /a\.org_id=\$1 AND a\.board_id=\$2 AND a\.asset_id=\$3 AND r\.state='active' AND r\.released_at IS NULL FOR SHARE OF a,r/,
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
  return failures;
}
