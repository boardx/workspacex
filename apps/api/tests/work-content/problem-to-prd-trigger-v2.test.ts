import { describe, expect, it } from 'vitest';
import { builtInWorkflowDefinitions, defaultWorkflowGraphs } from '../../src/infrastructure/workflow/create-workflow-runtime';
import { validateTriggerInput } from '../../src/domain/workflow/trigger-input';
describe('W029 versioned trigger input', () => {
 it('retains the published v1 and adds a bounded user-facing v2 with the same stages', () => {
  const definitions = builtInWorkflowDefinitions().filter(d => d.key === 'problem-to-prd');
  expect(definitions.map(d => d.version)).toEqual([1, 2]);
  expect(definitions[0]!.inputSchema).toEqual({type:'object'});
  expect(definitions[1]!).toMatchObject({graphRef:'problem-to-prd:2',inputSchema:{required:['rawInput'],properties:{rawInput:{type:'string',title:'产品问题或需求',minLength:1,maxLength:2000}}}});
  expect(definitions[1]!.stages).toEqual(definitions[0]!.stages);
  expect(defaultWorkflowGraphs().find(g=>g.graphRef==='problem-to-prd:2')!.stages.map(s=>s.stageId)).toEqual(definitions[1]!.stages.map(s=>s.stageId));
 });
 const schema = {type:'object',required:['rawInput'],properties:{rawInput:{type:'string',minLength:1,maxLength:2000}}};
 it('rejects absent, empty, wrongly typed and oversized tasks', () => {
  for (const input of [{}, {rawInput:''}, {rawInput:3}, {rawInput:'x'.repeat(2001)}]) expect(validateTriggerInput(schema,input)).not.toEqual([]);
 });
 it('counts Unicode code points and preserves old unconstrained strings', () => {
  expect(validateTriggerInput({properties:{x:{type:'string',minLength:1,maxLength:1}}},{x:'😀'})).toEqual([]);
  expect(validateTriggerInput({properties:{x:{type:'string'}}},{x:''})).toEqual([]);
  expect(validateTriggerInput(schema,{rawInput:' '})).toEqual([]);
 });
});

import { publishDefinitionVersion } from '../../src/application/workflow/publish-definition-version';
import { createPinnedInstance, loadPinnedExecutionPlan } from '../../src/application/workflow/pin-workflow-instance';
import { WorkflowDefinitionVersionInput, type WorkflowDefinitionVersionView } from '@repo/contracts/workflow-runtime';
import type { PinnedWorkflowInstance, WorkflowDefinitionRepository, WorkflowInstanceRepository } from '../../src/application/workflow/workflow-ports';
it('selects v2 by default while explicit v1 and existing instances retain their published definition', async () => {
 const inputs = builtInWorkflowDefinitions().filter(d=>d.key==='problem-to-prd');
 const versions: WorkflowDefinitionVersionView[] = [];
 const definitions: WorkflowDefinitionRepository = {
  definitionExists: async()=>true,
  findVersion: async(_org,_key,version)=>versions.find(d=>d.version===version)??null,
  latestPublishedVersion: async()=>Math.max(...versions.map(d=>d.version)),
  insertPublished: async(_org,definition)=>{versions.push(definition);},
 };
 const rows=new Map<string,PinnedWorkflowInstance>();
 const instances:WorkflowInstanceRepository={create:async row=>{rows.set(row.instanceId,row);},find:async(_org,id)=>rows.get(id)??null};
 let id=0;const deps={definitions,instances,skills:{resolve:async()=> '1.0.0'},newId:()=>`instance-${++id}`};
 const publishing={...deps,graphs:{nodeIdsOf:()=>inputs[0]!.stages.map(stage=>stage.stageId)},clock:{nowIso:()=> '2026-10-01T00:00:00Z'}};
 for(const body of inputs) { const parsed=WorkflowDefinitionVersionInput.safeParse(body); expect(parsed.success ? [] : parsed.error.issues).toEqual([]); }
 for(const body of inputs) await publishDefinitionVersion(publishing,{orgId:'org-test',actor:{userId:'admin',orgRole:'admin'},pathKey:body.key,body});
 await publishDefinitionVersion(publishing,{orgId:'org-test',actor:{userId:'admin',orgRole:'admin'},pathKey:inputs[0]!.key,body:inputs[0]!});
 expect(versions).toHaveLength(2);
 const command={orgId:'org-test',key:'problem-to-prd',agentId:'pm',agentVersionId:'pm-v1',initiatorUserId:'user',triggerKind:'manual' as const};
 const old=await createPinnedInstance(deps,{...command,version:1});
 const next=await createPinnedInstance(deps,command);
 expect(next.definitionVersion).toBe(2);expect(next.graphRef).toBe('problem-to-prd:2');
 expect(next.pinnedSkills).toEqual(old.pinnedSkills);
 expect((await loadPinnedExecutionPlan(deps,command.orgId,old.instanceId)).definition.inputSchema).toEqual({type:'object'});
 expect((await loadPinnedExecutionPlan(deps,command.orgId,next.instanceId)).definition.inputSchema.required).toEqual(['rawInput']);
});
