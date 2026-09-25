import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../src/infrastructure/whiteboard/pg-board-content-rollout.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../migrations/20260924001200_whiteboard_content_rollouts.sql', import.meta.url), 'utf8');

function audit(code: string, admission = migration): string[] {
  const errors: string[] = [];
  if (/withoutTenant\s*\(/.test(code) || !/this\.db\.withTenant\(toOrgId\(tenantId\)/.test(code)) errors.push('tenant transaction');
  if (!/ORDER BY b\.id LIMIT \$4/.test(code) || !/snapshot_upper_board_id/.test(code) || !/discovery_cycle/.test(code)) errors.push('stable pagination');
  if (!/release_whiteboard_content_rollout_admission/.test(code) || !/lease_token=\$15/.test(code) || !/lease_epoch=\$16/.test(code)
    || !/lease_owner=\$14/.test(code) || !/FOR UPDATE SKIP LOCKED/.test(admission)) errors.push('crash-safe leases');
  if (!/claim_whiteboard_content_rollout_admission/.test(code) || !/invalidate_whiteboard_content_rollout_leases/.test(code)
    || /whiteboard_content_rollout_(?:limiters|global_leases|contenders)/.test(code)
    || !/SECURITY DEFINER SET search_path=pg_catalog,public/.test(admission)) errors.push('global admission boundary');
  if (!/state IN \('queued','retry'\)/.test(admission) || !/next_attempt_at<=clock_timestamp\(\)/.test(admission)) errors.push('bounded retry claim');
  if (!/LIMIT 50/.test(code) || !/last_error_code IS NOT NULL/.test(code)) errors.push('bounded error visibility');
  if (!/whiteboard_content_rollout_events/.test(code) || !/kind,code,detail/.test(code)) errors.push('audit trail');
  if (/SELECT \*/i.test(code) || /String\(error\)|error\.message/.test(code)) errors.push('metadata-only diagnostics');
  return errors;
}

describe('Board fleet rollout repository boundary', () => {
  it('pins tenant RLS, stable pagination, leases, retries, audit and bounded diagnostics', () => expect(audit(source)).toEqual([]));
  it('detects an RLS bypass', () => expect(audit(source.replace('this.db.withTenant(toOrgId(tenantId)', 'this.db.withoutTenant('))).toContain('tenant transaction'));
  it('detects unstable pagination', () => expect(audit(source.replaceAll('snapshot_upper_board_id', 'removed_upper_bound'))).toContain('stable pagination'));
  it('detects a claim without skip-locked fencing', () => expect(audit(source, migration.replace('FOR UPDATE SKIP LOCKED', 'FOR UPDATE'))).toContain('crash-safe leases'));
  it('detects direct access to global admission state', () => expect(audit(`${source}\nSELECT * FROM whiteboard_content_rollout_contenders`)).toContain('global admission boundary'));
  it('detects a definer function without a fixed search path', () => expect(audit(source, migration.replaceAll('SECURITY DEFINER SET search_path=pg_catalog,public', 'SECURITY DEFINER'))).toContain('global admission boundary'));
});
