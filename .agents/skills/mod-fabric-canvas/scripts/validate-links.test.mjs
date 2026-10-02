import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateSkill } from './validate-links.mjs';

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'fabric-skill-links-'));
  const skill = join(root, '.agents/skills/mod-fabric-canvas');
  mkdirSync(join(skill, 'references'), { recursive: true });
  const refs = Array.from({ length: 6 }, (_, i) => `[Reference ${i}](references/${i}.md)`).join('\n');
  const entry = `---\nname: mod-fabric-canvas\ndescription: Product board rendering knowledge.\n---\n${refs}\n`;
  writeFileSync(join(skill, 'SKILL.md'), entry);
  for (let i = 0; i < 6; i++) writeFileSync(join(skill, `references/${i}.md`), '# Reference\n');
  try { run({ root, skill, entry }); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('six real references resolve without claiming business or external verification', () => fixture(({root,skill}) => {
  const result = validateSkill(skill, root);
  assert.equal(result.references, 6); assert.equal(result.links, 6);
  assert.equal(result.externalLinksVerified, false); assert.equal(result.businessAcceptanceProven, false);
}));
test('broken documentation reference rejects', () => fixture(({root,skill}) => {
  rmSync(join(skill, 'references/2.md')); assert.throws(() => validateSkill(skill,root), /Missing relative link|ENOENT/);
}));
test('missing sixth reference and malformed metadata reject', () => fixture(({root,skill,entry}) => {
  writeFileSync(join(skill,'SKILL.md'), entry.replace('[Reference 5](references/5.md)',''));
  assert.throws(() => validateSkill(skill,root), /six discoverable/);
  writeFileSync(join(skill,'SKILL.md'),entry.replace('mod-fabric-canvas','unrelated-skill'));
  assert.throws(() => validateSkill(skill,root), /Invalid skill/);
}));
test('absolute local paths are not portable evidence links', () => fixture(({root,skill}) => {
  writeFileSync(join(skill,'references/0.md'), '[Private evidence](/private/tmp/run/report.json)');
  assert.throws(() => validateSkill(skill,root), /Nonportable/);
}));

test('an existing file with a missing fragment rejects', () => fixture(({root,skill}) => {
  writeFileSync(join(skill,'references/0.md'), '[Missing](1.md#absent)');
  assert.throws(() => validateSkill(skill,root), /Missing explicit anchor/);
}));
test('real Unicode and encoded local anchors resolve', () => fixture(({root,skill}) => {
  writeFileSync(join(skill,'references/0.md'), '<a id="同步"></a>\n[Local](#%E5%90%8C%E6%AD%A5)\n[Peer](1.md#peer)');
  writeFileSync(join(skill,'references/1.md'), '<a id="peer"></a>\n# Peer');
  assert.equal(validateSkill(skill,root).links, 8);
}));
test('anchor text inside a fenced example is not an actual anchor', () => fixture(({root,skill}) => {
  writeFileSync(join(skill,'references/0.md'), '[Example](1.md#example)');
  writeFileSync(join(skill,'references/1.md'), '```html\n<a id="example"></a>\n```');
  assert.throws(() => validateSkill(skill,root), /Missing explicit anchor/);
}));
test('anchor text inside an HTML comment is not an actual anchor', () => fixture(({root,skill}) => {
  writeFileSync(join(skill,'references/0.md'), '[Comment](1.md#comment)');
  writeFileSync(join(skill,'references/1.md'), '<!-- <a id="comment"></a> -->');
  assert.throws(() => validateSkill(skill,root), /Missing explicit anchor/);
}));
