import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source=readFileSync(new URL('../../src/infrastructure/whiteboard/pg-whiteboard-transfer-store.ts',import.meta.url),'utf8');
describe('portable transfer repository permission boundary',()=>{
  it('keeps every operation inside tenant transactions and names only reviewed whiteboard tables',()=>{
    expect(source).not.toContain('withoutTenant');
    expect(source.match(/this\.db\.withTenant\(p\.orgId/g)).toHaveLength(2);
    const tables=[...source.matchAll(/(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_]+)/g)].map(match=>match[1]);
    expect(new Set(tables)).toEqual(new Set(['whiteboards','whiteboard_members','whiteboard_transfer_audit','whiteboard_import_receipts','whiteboard_documents']));
  });
  it('pins disclosure to owner/member and replay to the acting principal',()=>{
    expect(source).toContain('(b.owner_id=$3 OR m.user_id IS NOT NULL)');
    expect(source.match(/actor_id=\$2 AND request_id=\$3/g)).toHaveLength(2);
    expect(source).toContain('owner_id=$2 AND id=$3');
  });
  it('imports through copy-only creates and the collaboration transaction without mutating a source board',()=>{
    expect(source).toContain('INSERT INTO whiteboards');
    expect(source).toContain('writeCommandsInTransaction(session, p, id');
    expect(source).not.toMatch(/UPDATE\s+whiteboards/i);
    expect(source).not.toMatch(/DELETE\s+FROM\s+whiteboards/i);
  });
});
