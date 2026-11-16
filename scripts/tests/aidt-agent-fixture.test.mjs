import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fullstackAgentInstructions } from '../../apps/api/scripts/fixtures/fullstack-agent-instructions.ts';
import { DEFAULT_AGENT_INSTRUCTIONS } from '../../apps/api/src/application/agent/ensure-default-agent.ts';
import * as Agent from '../../packages/contracts/src/agent-runtime.ts';

test('ordinary unspecified loopback fixture keeps its original exact echo instructions',()=>{
  assert.equal(fullstackAgentInstructions(undefined),'You are the core-loop smoke agent. Echo back what you are given.');
  assert.equal(fullstackAgentInstructions('loopback-echo'),fullstackAgentInstructions(undefined));
});
test('explicit real AIDT profile returns the exported canonical instructions byte for byte',()=>{
  assert.equal(fullstackAgentInstructions('canonical-default'),DEFAULT_AGENT_INSTRUCTIONS);
  assert.notEqual(fullstackAgentInstructions('canonical-default'),fullstackAgentInstructions(undefined));
});
test('unknown fixture profile fails instead of silently using an echo oracle',()=>{
  assert.throws(()=>fullstackAgentInstructions('canonical-typo'),/PROFILE_INVALID/);
});
test('new profile changes only instruction content and its existing digest calculation',()=>{
  const seed=readFileSync(new URL('../../apps/api/scripts/seed-fullstack-smoke.ts',import.meta.url),'utf8');
  assert.match(seed,/fullstackAgentInstructions\(process\.env\.FULLSTACK_E2E_AGENT_INSTRUCTIONS_PROFILE\)/);
  assert.ok(seed.indexOf('const fixtureAgentInstructions =')<seed.indexOf('\nensureDatabase();'));
  assert.match(seed,/createHash\("sha256"\)\.update\(instructions\)\.digest\("hex"\)/);
  assert.equal(createHash('sha256').update(fullstackAgentInstructions('canonical-default')).digest('hex'),createHash('sha256').update(DEFAULT_AGENT_INSTRUCTIONS).digest('hex'));
});
test('only explicit real AIDT runner opts into canonical profile',()=>{
  const runner=readFileSync(new URL('../real-model-aidt-stack.mjs',import.meta.url),'utf8');
  assert.match(runner,/FULLSTACK_E2E_AGENT_INSTRUCTIONS_PROFILE: 'canonical-default'/);
  assert.match(runner,/WORKSPACEX_REAL_MODEL_DEV_OPT_IN/);
});
test('existing canonical update accepts instructions-only and rejects hidden capability/model edits',()=>{
  const input=Agent.operations.updateAgentDefinition.in.parse({agentId:'offline-fixture',expectedVersion:'offline-previous',patch:{instructions:DEFAULT_AGENT_INSTRUCTIONS}});
  assert.deepEqual(Object.keys(input.patch),['instructions']);
  assert.equal(Agent.operations.updateAgentDefinition.in.safeParse({...input,patch:{instructions:DEFAULT_AGENT_INSTRUCTIONS,toolPolicy:[]}}).success,false);
});
test('existing publish operation is an explicit separate toolless publish request',()=>{
  assert.equal(Agent.operations.selfPublishToollessAgent.method,'POST');
  assert.deepEqual(Agent.operations.selfPublishToollessAgent.in.parse({agentId:'offline-fixture'}),{agentId:'offline-fixture'});
  assert.equal(Agent.operations.selfPublishToollessAgent.in.safeParse({agentId:'offline-fixture',publishState:'草稿'}).success,false);
});
