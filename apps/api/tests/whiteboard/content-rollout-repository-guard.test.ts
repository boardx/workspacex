import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../src/infrastructure/whiteboard/pg-board-content-rollout.ts', import.meta.url), 'utf8');

function audit(code: string): string[] {
  const errors: string[] = [];
  if (/withoutTenant\s*\(/.test(code) || !/this\.db\.withTenant\(toOrgId\(tenantId\)/.test(code)) errors.push('tenant transaction');
  if (!/ORDER BY b\.id LIMIT \$3/.test(code) || !/cursor_board_id/.test(code)) errors.push('stable pagination');
  if (!/FOR UPDATE SKIP LOCKED/.test(code) || !/lease_until<now\(\)/.test(code)) errors.push('crash-safe leases');
  if (!/state IN \('queued','retry'\)/.test(code) || !/next_attempt_at<=now\(\)/.test(code)) errors.push('bounded retry claim');
  if (!/LIMIT 50/.test(code) || !/last_error_code IS NOT NULL/.test(code)) errors.push('bounded error visibility');
  if (!/whiteboard_content_rollout_events/.test(code) || !/kind,code,detail/.test(code)) errors.push('audit trail');
  if (/SELECT \*/i.test(code) || /String\(error\)|error\.message/.test(code)) errors.push('metadata-only diagnostics');
  return errors;
}

describe('Board fleet rollout repository boundary', () => {
  it('pins tenant RLS, stable pagination, leases, retries, audit and bounded diagnostics', () => expect(audit(source)).toEqual([]));
  it('detects an RLS bypass', () => expect(audit(source.replace('this.db.withTenant(toOrgId(tenantId)', 'this.db.withoutTenant('))).toContain('tenant transaction'));
  it('detects unstable pagination', () => expect(audit(source.replaceAll('ORDER BY b.id LIMIT $3', 'LIMIT $3'))).toContain('stable pagination'));
  it('detects a claim without skip-locked fencing', () => expect(audit(source.replace('FOR UPDATE SKIP LOCKED', 'FOR UPDATE'))).toContain('crash-safe leases'));
});
