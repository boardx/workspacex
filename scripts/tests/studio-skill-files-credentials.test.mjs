import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { githubImportTokenEnv, partitionSkillImportCredentials } from '../studio-skill-files-credentials.mjs';

test('dedicated import credential reaches only API environment without mutating the caller', () => {
  const input = Object.freeze({ PATH: '/bin', [githubImportTokenEnv]: 'dedicated-test-secret' });
  const result = partitionSkillImportCredentials(input);
  assert.deepEqual(result.sharedEnvironment, { PATH: '/bin' });
  assert.deepEqual(result.apiEnvironment, { [githubImportTokenEnv]: 'dedicated-test-secret' });
  assert.equal(input[githubImportTokenEnv], 'dedicated-test-secret');
});

test('missing or empty dedicated credential never borrows runner or administrator tokens', () => {
  for (const dedicated of [undefined, '']) {
    const input = { GITHUB_TOKEN: 'runner-test-secret', GH_TOKEN: 'administrator-test-secret' };
    if (dedicated !== undefined) input[githubImportTokenEnv] = dedicated;
    const result = partitionSkillImportCredentials(input);
    assert.equal(Object.hasOwn(result.sharedEnvironment, githubImportTokenEnv), false);
    assert.deepEqual(result.apiEnvironment, {});
  }
});

test('workflow binds the dedicated existing secret and wrapper applies it only at API startup', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/skill-files-e2e.yml', import.meta.url), 'utf8');
  assert.ok(workflow.includes('WORKSPACEX_SKILL_IMPORT_GITHUB_TOKEN: ${{ secrets.WORKSPACEX_SKILL_IMPORT_GITHUB_TOKEN }}'));
  assert.equal(workflow.includes('secrets.GITHUB_TOKEN'), false);
  assert.equal(workflow.includes('secrets.GH_TOKEN'), false);
  const wrapper = readFileSync(new URL('../studio-skill-files-e2e.mjs', import.meta.url), 'utf8');
  assert.ok(wrapper.includes('partitionSkillImportCredentials(process.env)'));
  assert.ok(wrapper.includes('const env={...sharedEnvironment,'));
  assert.ok(wrapper.includes("'api',root,{...apiEnvironment,PORT:env.WORKSPACEX_API_PORT}"));
  assert.equal(wrapper.match(/\.\.\.apiEnvironment/g)?.length, 1);
  assert.equal(wrapper.includes('...process.env'), false);
});
