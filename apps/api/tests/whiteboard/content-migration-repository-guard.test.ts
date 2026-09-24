import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../src/infrastructure/whiteboard/pg-board-content-migration.ts', import.meta.url), 'utf8');
const allowed = new Set(['whiteboards', 'whiteboard_content_heads', 'whiteboard_content_migrations', 'whiteboard_documents', 'whiteboard_updates']);

function audit(code: string): string[] {
  const errors: string[] = [];
  const sql = [...code.matchAll(/`([^`]*(?:SELECT|INSERT|UPDATE|DELETE)[^`]*)`/gis)].map(match => match[1]!);
  const ignoredSqlWords = new Set(['of', 'from', 'is', 'batch', 'source', 'current_updates', 'foreign_updates', 'bytes']);
  const tables = new Set(sql.flatMap(query => [...query.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi)].map(match => match[1]!.toLowerCase())).filter(table => !ignoredSqlWords.has(table)));
  if ([...tables].some(table => !allowed.has(table)) || [...allowed].some(table => !tables.has(table))) errors.push('table scope');
  if (sql.some(query => [...query.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(whiteboards|whiteboard_\w+)/gi)].length > 0 && !/\borg_id\b/i.test(query))) errors.push('tenant SQL scope');
  if (/withoutTenant\s*\(/.test(code) || !/this\.db\.withTenant\(toOrgId\(tenantId\)/.test(code)) errors.push('tenant transaction');
  if (!/FOR UPDATE OF b,h/.test(code) || !/FOR UPDATE OF d,h/.test(code)) errors.push('board lock');
  const inventory = code.slice(code.indexOf('async readInventory'), code.indexOf('async saveCandidate'));
  if (/FOR\s+(?:NO\s+KEY\s+)?UPDATE/i.test(inventory) || (inventory.match(/this\.session\.query/g) ?? []).length !== 1 || !/WITH source AS/.test(inventory)) errors.push('unlocked single-statement inventory');
  const candidate = code.slice(code.indexOf('async saveCandidate'), code.indexOf('async markVerified'));
  if (!/await this\.lockWatermark\(current\);[\s\S]*await verifyCandidate\(\);[\s\S]*UPDATE whiteboard_content_migrations/.test(candidate)) errors.push('locked candidate readback');
  const cutover = code.slice(code.indexOf('async cutover'), code.indexOf('async captureRetirementHead'));
  if (!/storage_kind='legacy_pg'.*epoch=\$3.*head_seq=\$9.*fencing_token=\$10/s.test(cutover)) errors.push('cutover CAS');
  if (!/LIMIT \$5 FOR UPDATE/.test(code) || !/SET update=NULL/.test(code) || /DELETE\s+FROM\s+whiteboard_updates/i.test(code) || !/current\.state !== 'cleaning'/.test(code)) errors.push('bounded byte cleanup');
  if (!/retirement_not_before<=\$5/.test(code) || !/retirement_proof_digest=\$4/.test(code) || !/retirement_manifest_digest=\$8/.test(code)) errors.push('retirement proof CAS');
  if (!/job_id=\$3/.test(code) || !/transition\(current, 'candidate_ready', 'verified'\)/.test(code) || !/state='candidate_ready'/.test(code)) errors.push('job state CAS');
  return errors;
}

describe('Board content migration repository boundary', () => {
  it('pins tenant scope, locks, job fencing, cutover CAS and metadata-preserving cleanup', () => expect(audit(source)).toEqual([]));
  it('detects removal of the fencing token from cutover', () => expect(audit(source.replace(" AND head_seq=$9 AND fencing_token=$10 RETURNING", ' AND head_seq=$9 RETURNING'))).toContain('cutover CAS'));
  it('detects destructive or unbounded legacy cleanup', () => expect(audit(source.replace('SET update=NULL', 'DELETE FROM whiteboard_updates'))).toContain('bounded byte cleanup'));
  it('detects a tenant bypass', () => expect(audit(source.replace('this.db.withTenant(toOrgId(tenantId)', 'this.db.withoutTenant('))).toContain('tenant transaction'));
  it('detects a content scan that takes a row lock', () => expect(audit(source.replace('ORDER BY kind,seq`', 'ORDER BY kind,seq FOR UPDATE`'))).toContain('unlocked single-statement inventory'));
  it('detects candidate registration without Board-locked blob readback', () => expect(audit(source.replace('await verifyCandidate();', 'void verifyCandidate;'))).toContain('locked candidate readback'));
});
