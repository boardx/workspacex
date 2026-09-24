import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const legacyMigration = readFileSync(
  fileURLToPath(new URL('../../migrations/20260924000500_whiteboard_quarantine_recovery.sql', import.meta.url)),
  'utf8',
);
const proofMigration = readFileSync(
  fileURLToPath(new URL('../../migrations/20260924000600_whiteboard_quarantine_access_proofs.sql', import.meta.url)),
  'utf8',
);
const migrations = `${legacyMigration}\n${proofMigration}`;

describe('whiteboard quarantine recovery persistence', () => {
  it('upgrades the shipped client-metadata table instead of rewriting its migration', () => {
    expect(legacyMigration).not.toContain('access_receipt_id');
    expect(proofMigration).toContain('ADD COLUMN IF NOT EXISTS access_receipt_id');
    expect(proofMigration).toContain('ADD COLUMN IF NOT EXISTS request_hash');
    expect(proofMigration).toContain('ADD COLUMN IF NOT EXISTS inactive_at');
    expect(proofMigration).toContain("SET status='denied'");
    expect(proofMigration).toContain('ALTER COLUMN request_hash SET NOT NULL');
  });

  it('is tenant-RLS protected and stores a server proof plus request digest without ciphertext or keys', () => {
    expect(proofMigration).toContain('whiteboard_quarantine_access_receipts');
    expect(migrations.match(/ENABLE ROW LEVEL SECURITY/g)).toHaveLength(2);
    expect(migrations).toContain("org_id=current_setting('app.current_org',true)");
    expect(proofMigration).toContain('access_receipt_id');
    expect(proofMigration).toContain('request_hash');
    expect(proofMigration).toContain(
      'FOREIGN KEY (org_id, board_id, requested_by, session_fingerprint, epoch, access_receipt_id)',
    );
    expect(migrations).not.toMatch(/ciphertext|crypto_key|encryption_key/);
  });

  it('replays table, column, index, constraint and policy creation safely', () => {
    expect(migrations.match(/CREATE TABLE IF NOT EXISTS/g)).toHaveLength(2);
    for (const index of [
      'whiteboard_quarantine_recovery_board',
      'whiteboard_quarantine_access_actor',
      'whiteboard_quarantine_access_active_scope',
      'whiteboard_quarantine_recovery_access_once',
    ]) expect(migrations).toContain(`INDEX IF NOT EXISTS ${index}`);
    expect(proofMigration.match(/ADD COLUMN IF NOT EXISTS/g)).toHaveLength(3);
    expect(proofMigration.match(/IF NOT EXISTS \(SELECT 1 FROM pg_constraint/g)).toHaveLength(4);
    expect(migrations.match(/DROP POLICY IF EXISTS/g)).toHaveLength(2);
  });

  it('defines one active receipt per principal session and an explicit expiry and consumption lifecycle', () => {
    expect(proofMigration).toContain(
      'ON whiteboard_quarantine_access_receipts(org_id, board_id, actor_id, session_fingerprint, epoch)',
    );
    expect(proofMigration).toContain('WHERE active');
    expect(proofMigration).toContain('expires_at timestamptz NOT NULL');
    expect(proofMigration).toContain('consumed_at timestamptz');
    expect(proofMigration).toContain('inactive_at timestamptz');
    expect(proofMigration).toContain('WHERE access_receipt_id IS NOT NULL');
  });
});
