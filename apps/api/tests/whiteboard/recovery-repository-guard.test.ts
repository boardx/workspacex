import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';
const source=readFileSync(new URL('../../src/infrastructure/whiteboard/pg-recovery-metadata.ts',import.meta.url),'utf8');
describe('whiteboard recovery permission and metadata boundary',()=>{
  it('uses only reviewed board/recovery metadata tables under tenant transactions',()=>{const tables=[...source.matchAll(/(?:FROM|INTO|UPDATE)\s+([a-z_]+)/gi)].map(match=>match[1]);expect(new Set(tables)).toEqual(new Set(['whiteboards','whiteboard_members','whiteboard_documents','whiteboard_checkpoints','whiteboard_recovery_events','whiteboard_restore_receipts']));expect(source).toContain('this.db.withTenant(p.orgId');expect(source).not.toContain('withoutTenant');expect(source).not.toMatch(/snapshot\s*:/);});
  it('checks membership before manifests and keeps restore owner-only with receipt-first CAS',()=>{expect(source).toContain('await access(session,p,boardId)');expect(source).toContain("rights.role!=='owner'||rights.archived");expect(source).toContain('FOR UPDATE');expect(source).toContain("snapshot=NULL");const restore=source.slice(source.indexOf('async commitRestore'));expect(restore.indexOf('SELECT request_hash,new_epoch')).toBeLessThan(restore.indexOf('SELECT epoch,seq::text FROM whiteboard_documents'));});
});
