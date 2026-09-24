import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../src/infrastructure/whiteboard/pg-workshop-control-repository.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../migrations/20260924000900_whiteboard_workshop_control.sql', import.meta.url), 'utf8');

function audit(repository: string, sql: string): string[] {
  const errors: string[] = [];
  if (/withoutTenant\s*\(/.test(repository)) errors.push('tenant bypass');
  for (const table of ['whiteboards', 'whiteboard_members', 'org_memberships', 'whiteboard_workshop_controls', 'whiteboard_workshop_control_requests']) {
    if (!repository.includes(table)) errors.push(`missing table ${table}`);
  }
  if (!/b\.org_id=\$1 AND b\.id=\$2/.test(repository) || !/m\.user_id=\$3/.test(repository)) errors.push('board access scope');
  if (!/org_role !== 'admin'/.test(repository) || !/board\.owner_id === p\.userId/.test(repository)) errors.push('controller role gate');
  if (!/FOR UPDATE OF b/.test(repository)
    || !/FROM org_memberships WHERE org_id=\$1 AND user_id=\$2 FOR UPDATE/.test(repository)
    || !/FROM whiteboard_workshop_controls WHERE org_id=\$1 AND board_id=\$2 FOR UPDATE/.test(repository)) errors.push('atomic locks');
  if (!/actor_id=\$3 AND request_id=\$4/.test(repository) || !/request_hash/.test(repository)) errors.push('idempotency scope');
  if (!/hidden_phase_ids='\{\}'::text\[\],revision=revision\+1/.test(repository)) errors.push('atomic reveal');
  if (!/ENABLE ROW LEVEL SECURITY/.test(sql) || !/FORCE ROW LEVEL SECURITY/.test(sql) || !/current_setting\('app\.current_org',true\)/.test(sql)) errors.push('tenant RLS');
  return errors;
}

describe('workshop control repository security shape', () => {
  it('pins tenant access, board membership, controller role, idempotency and atomic reveal', () => {
    expect(audit(source, migration)).toEqual([]);
  });
  it('detects removal of the actor-scoped idempotency lookup', () => {
    expect(audit(source.replace('actor_id=$3 AND request_id=$4', 'request_id=$4'), migration)).toContain('idempotency scope');
  });
  it('detects a tenant bypass and non-atomic reveal', () => {
    expect(audit(source.replace('this.db.withTenant(p.orgId,', 'this.db.withoutTenant('), migration)).toContain('tenant bypass');
    expect(audit(source.replace("hidden_phase_ids='{}'::text[],revision=revision+1", "hidden_phase_ids='{}'::text[]"), migration)).toContain('atomic reveal');
  });
  it('detects removal of the org-role serialization lock', () => {
    const mutated = source.replace('FROM org_memberships WHERE org_id=$1 AND user_id=$2 FOR UPDATE', 'FROM org_memberships WHERE org_id=$1 AND user_id=$2');
    expect(mutated).not.toBe(source);
    expect(audit(mutated, migration)).toContain('atomic locks');
  });
});
