import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(new URL('../../migrations/20260924000500_whiteboard_proposals.sql', import.meta.url), 'utf8');

describe('whiteboard proposal migration replay guard', () => {
  it('keeps every named schema creation safe for force replay', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS whiteboard_proposals');
    expect(migration).not.toMatch(/CREATE\s+(?:UNIQUE\s+)?INDEX(?!\s+IF\s+NOT\s+EXISTS)/i);
    expect(migration).toMatch(/DROP POLICY IF EXISTS tenant ON whiteboard_proposals;\s*CREATE POLICY tenant ON whiteboard_proposals/);
  });

  it('rejects the prior non-replayable table and policy forms', () => {
    const unsafeTable=migration.replace('CREATE TABLE IF NOT EXISTS','CREATE TABLE');
    expect(unsafeTable).not.toContain('CREATE TABLE IF NOT EXISTS whiteboard_proposals');
    const unsafePolicy=migration.replace('DROP POLICY IF EXISTS tenant ON whiteboard_proposals;\n','');
    expect(unsafePolicy).not.toMatch(/DROP POLICY IF EXISTS tenant ON whiteboard_proposals;\s*CREATE POLICY tenant ON whiteboard_proposals/);
  });
});
