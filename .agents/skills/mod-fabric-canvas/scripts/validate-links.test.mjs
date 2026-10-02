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
