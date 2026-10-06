import {it,expect} from 'vitest';import {agentRuntime} from '@repo/contracts';import {buildAgentCapabilityGraphModel} from '@/lib/agent-capability-graph-model';
const legacy={agentId:'a',name:'A',roleLabel:'',skillMounts:[],toolWhitelist:[]};
it('old strict GET response remains valid',()=>expect(agentRuntime.operations.getAgentCapabilityGraph.out.parse(legacy)).toEqual(legacy));
it('strict graph GET retains exact pins and unresolved pending records',()=>{
 const out={...legacy,publishedVersionId:'published-a',pinnedSkills:[{skillId:'s',versionId:'old-exact-version'}],unresolvedSkillVersionIds:['unresolved'],pendingSkillBindings:[{stableId:'S064',stableName:'problem-framing',contentDigest:'a'.repeat(64),reason:'missing_version'}]};expect(agentRuntime.operations.getAgentCapabilityGraph.out.parse(out)).toEqual(out);
});
it('pin only displays exact version rather than catalog latest',()=>{
 const m=buildAgentCapabilityGraphModel({...legacy,pinnedSkills:[{skillId:'s',versionId:'exact-old'}]});expect(m.hasCapabilities).toBe(true);expect(m.skillNodes).toEqual([{id:'pin:exact-old',skillId:'s',skillVersion:'exact-old',label:'s',href:'/admin/skill/s'}]);
});
it('pending and unresolved alone do not manufacture executable nodes',()=>{
 const m=buildAgentCapabilityGraphModel({...legacy,unresolvedSkillVersionIds:['missing'],pendingSkillBindings:[{stableId:'S064',stableName:'problem-framing',contentDigest:'a'.repeat(64),reason:'missing_version'}]});expect(m.hasCapabilities).toBe(false);expect(m.skillNodes).toEqual([]);
});
it('numeric legacy mount coexists with exact published pin',()=>{
 const m=buildAgentCapabilityGraphModel({...legacy,skillMounts:[{skillId:'s',skillVersion:2}],pinnedSkills:[{skillId:'s',versionId:'exact-old'}]});expect(m.skillNodes.map(x=>[x.id,x.skillVersion])).toEqual([['skill:s',2],['pin:exact-old','exact-old']]);
});
