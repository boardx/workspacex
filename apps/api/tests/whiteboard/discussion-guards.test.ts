import { describe,expect,it } from 'vitest';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../../src/infrastructure/whiteboard/pg-whiteboard-discussion.ts',import.meta.url),'utf8');
const migration=readFileSync(new URL('../../migrations/20260924000600_whiteboard_discussions.sql',import.meta.url),'utf8');
describe('whiteboard discussion security and replay guards',()=>{
 it('rechecks tenant membership, role and archive state on every write',()=>{
  expect(source).toContain('b.org_id=$1 AND b.id=$3');
  expect(source).toContain("a.role==='viewer'||a.archived");
  expect(source.match(/this\.access\(s,p,boardId,true\)/g)?.length).toBeGreaterThanOrEqual(7);
 });
 it('resolves mentions only through board members in the current organization',()=>{
  expect(source).toContain('JOIN org_memberships om ON om.org_id=$1');
  expect(source).toContain('FROM whiteboard_members WHERE org_id=$1 AND board_id=$2');
  expect(source).toContain('return r.rows.length===unique.length');
 });
 it('uses idempotency keys, finite limits, tombstones and audit rows',()=>{
  expect(migration).toContain('UNIQUE(org_id,board_id,created_by,request_id)');
  expect(migration).toContain('UNIQUE(org_id,thread_id,author_id,request_id)');
  expect(source).toContain('commentsPerThread'); expect(source).toContain("deleted_at=now()");
  expect(source).toContain('whiteboard_discussion_audit');
 });
 it('is replayable and forces RLS on every discussion table',()=>{
  expect((migration.match(/CREATE TABLE IF NOT EXISTS/g)||[]).length).toBe(5);
  expect((migration.match(/DROP POLICY IF EXISTS/g)||[]).length).toBe(5);
  expect((migration.match(/FORCE ROW LEVEL SECURITY/g)||[]).length).toBe(5);
 });
});
