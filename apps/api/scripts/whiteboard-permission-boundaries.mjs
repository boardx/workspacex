/**
 * Private Board metadata and content operations cannot use the generic acl_bindings
 * filter: their authority is the Board owner/member relation. These are admitted only
 * while the production lint can prove the actor, tenant, locking and replay invariants.
 */
export const whiteboardPermissionBoundaries = new Map([
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
