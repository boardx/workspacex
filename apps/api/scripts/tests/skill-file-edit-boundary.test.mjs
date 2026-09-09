import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkSkillFileEditBoundary } from '../lib/skill-file-edit-boundary.mjs';
const repo = readFileSync(new URL('../../src/infrastructure/skill/pg-skill-file-edit-repository.ts', import.meta.url), 'utf8');
const app = readFileSync(new URL('../../src/application/skill/edit-skill-files.ts', import.meta.url), 'utf8');
test('reviewed administrator read/write boundary passes', () => assert.deepEqual(checkSkillFileEditBoundary(repo, app), []));
for (const [name, before, after] of [
 ['other table', 'FROM skill_versions', 'FROM credentials'],
 ['cross tenant', 'AND org_id=$2 ORDER BY path', 'ORDER BY path'],
 ['false tenant argument', '[version.id, version.org_id]', '[version.id, input.actorId]'],
 ['unscoped session', 'this.db.withTenant', 'this.db.withoutTenant'],
 ['new read method', '  async read(', '  async leak() { return []; }\n  async read('],
 ['new arrow read', '  async read(', '  leak = async () => [];\n  async read('],
 ['extra SQL', '      const rows =', '      await session.query("SELECT * FROM credentials");\n      const rows ='],
]) test(`rejects ${name}`, () => { assert.ok(repo.includes(before)); assert.ok(checkSkillFileEditBoundary(repo.replace(before, after), app).length); });
test('rejects administrator role widening', () => assert.ok(checkSkillFileEditBoundary(repo, app.replace('member.orgRole !== "admin"', 'false')).length));
test('rejects authorization removed from read or write independently', () => {
 const needle = '  await authorize(input, deps);';
 for (const at of [app.indexOf(needle), app.lastIndexOf(needle)]) {
  assert.ok(at >= 0);
  assert.ok(checkSkillFileEditBoundary(repo, app.slice(0, at) + app.slice(at + needle.length)).length);
 }
});
