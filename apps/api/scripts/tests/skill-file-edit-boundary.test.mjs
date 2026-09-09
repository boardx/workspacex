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
 ['getter database escape', '  async read(', '  get unguardedDatabase() { return this.db; }\n  async read('],
 ['setter database escape', '  async read(', '  set unguardedDatabase(db) { this.db = db; }\n  async read('],
 ['static block escape', '  async read(', '  static { globalThis.leak = this; }\n  async read('],
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

for (const [name, addition] of [
 ['function', 'export async function unguardedSnapshot(input: any, deps: any) { return deps.repository.read(input); }'],
 ['arrow', 'export const unguardedSnapshot = (input: any, deps: any) => deps.repository.read(input);'],
 ['alias', 'export { authorize as unguardedSnapshot };'],
 ['default', 'export default (input: any, deps: any) => deps.repository.read(input);'],
 ['class', 'export class Unguarded { read(input: any, deps: any) { return deps.repository.read(input); } }'],
]) test(`rejects added use-case ${name} export`, () => assert.ok(checkSkillFileEditBoundary(repo, `${app}\n${addition}`).length));

test('rejects public repository database constructor property', () => {
 const changed = repo.replace('private readonly db', 'public readonly db');
 assert.notEqual(changed, repo);
 assert.ok(checkSkillFileEditBoundary(changed, app).length);
});
test('rejects runtime reader added to exported error class', () => {
 const needle = 'export class SkillFileEditError extends Error {';
 const changed = app.replace(needle, `${needle}\n read(input: Parameters<SkillFileEditRepository["read"]>[0], deps: SkillFileEditDeps) { return deps.repository.read(input); }`);
 assert.notEqual(changed, app);
 assert.ok(checkSkillFileEditBoundary(repo, changed).length);
});
