import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../src/infrastructure/whiteboard/pg-whiteboard-repository.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../migrations/20260926130000_whiteboard_library_management.sql', import.meta.url), 'utf8');

describe('whiteboard library management durability boundary', () => {
  it('persists tenant-scoped tags and duplicate request pointers under forced RLS', () => {
    for (const table of ['whiteboard_tags', 'whiteboard_tag_bindings', 'whiteboard_duplicate_requests', 'whiteboard_delete_receipts']) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
      expect(migration).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    }
    expect(migration).toContain('PRIMARY KEY (org_id, board_id, tag_id)');
    expect(migration).toContain('UNIQUE (org_id, target_board_id)');
  });

  it('implements AND filtering and owner-scoped destructive mutations', () => {
    expect(source).toContain('HAVING count(*) = $5');
    expect(source).toMatch(/DELETE FROM whiteboards WHERE org_id=\$1 AND owner_id=\$2 AND id=\$3/);
    expect(source).toContain("WhiteboardResourceError('BOARD_NOT_ARCHIVED')");
    expect(source).toContain('whiteboard_delete_receipts');
    expect(source.match(/FROM whiteboard_delete_receipts/g)).toHaveLength(2);
  });

  it('serializes lifecycle transitions and binds permanent deletion to the current generation', () => {
    expect(migration).toContain('lifecycle_revision integer NOT NULL DEFAULT 0 CHECK (lifecycle_revision >= 0)');
    expect(source).toMatch(/SELECT archived,tags_revision,lifecycle_revision FROM whiteboards[^`]*FOR UPDATE/);
    expect(source).toContain('board.rows[0].lifecycle_revision !== input.expectedLifecycleRevision');
    expect(source).toContain('lifecycle_revision=lifecycle_revision+CASE WHEN $7::boolean THEN 1 ELSE 0 END');
    expect(source).toContain("expectedLifecycleRevision:input.expectedLifecycleRevision");
  });
});
