import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../src/infrastructure/whiteboard/pg-board-content-migration.ts', import.meta.url), 'utf8');
const allowed = new Set(['whiteboards', 'whiteboard_content_heads', 'whiteboard_content_migrations', 'whiteboard_documents', 'whiteboard_updates']);

function audit(code: string): string[] {
  const errors: string[] = [];
  const sql = [...code.matchAll(/`([^`]*(?:SELECT|INSERT|UPDATE|DELETE)[^`]*)`/gis)].map(match => match[1]!);
  const ignoredSqlWords = new Set(['of', 'from', 'is', 'batch']);
  const tables = new Set(sql.flatMap(query => [...query.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi)].map(match => match[1]!.toLowerCase())).filter(table => !ignoredSqlWords.has(table)));
  if ([...tables].some(table => !allowed.has(table)) || [...allowed].some(table => !tables.has(table))) errors.push('table scope');
  if (sql.some(query => [...query.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(whiteboards|whiteboard_\w+)/gi)].length > 0 && !/\borg_id\b/i.test(query))) errors.push('tenant SQL scope');
  if (/withoutTenant\s*\(/.test(code) || !/this\.db\.withTenant\(toOrgId\(tenantId\)/.test(code)) errors.push('tenant transaction');
  if (!/FOR UPDATE OF b,h/.test(code) || !/FOR UPDATE OF d,h/.test(code)) errors.push('board lock');
  if (!/storage_kind='legacy_pg'.*epoch=\$3.*head_seq=\$9.*fencing_token=\$10/s.test(code)) errors.push('cutover CAS');
  if (!/LIMIT \$4 FOR UPDATE/.test(code) || !/SET update=NULL/.test(code) || /DELETE\s+FROM\s+whiteboard_updates/i.test(code)) errors.push('bounded byte cleanup');
  if (!/job_id=\$3/.test(code) || !/transition\(current, 'candidate_ready', 'verified'\)/.test(code) || !/state='candidate_ready'/.test(code)) errors.push('job state CAS');
  return errors;
}

describe('Board content migration repository boundary', () => {
  it('pins tenant scope, locks, job fencing, cutover CAS and metadata-preserving cleanup', () => expect(audit(source)).toEqual([]));
  it('detects removal of the fencing token from cutover', () => expect(audit(source.replace(' AND fencing_token=$10', ''))).toContain('cutover CAS'));
  it('detects destructive or unbounded legacy cleanup', () => expect(audit(source.replace('SET update=NULL', 'DELETE FROM whiteboard_updates'))).toContain('bounded byte cleanup'));
  it('detects a tenant bypass', () => expect(audit(source.replace('this.db.withTenant(toOrgId(tenantId)', 'this.db.withoutTenant('))).toContain('tenant transaction'));
});
