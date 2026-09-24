import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {describe,expect,it} from 'vitest';

const migration=readFileSync(fileURLToPath(new URL('../../migrations/20260924000500_whiteboard_quarantine_recovery.sql',import.meta.url)),'utf8');
describe('whiteboard quarantine recovery persistence',()=>{
  it('is tenant-RLS protected and stores receipt metadata without client ciphertext or keys',()=>{expect(migration).toContain('ENABLE ROW LEVEL SECURITY');expect(migration).toContain("org_id=current_setting('app.current_org',true)");expect(migration).toContain('session_fingerprint');expect(migration).not.toMatch(/ciphertext|crypto_key|encryption_key/);});
});
