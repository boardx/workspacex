import { expect, it } from 'vitest';
import { GuidedResearchRuntimeCommand } from '../src/research';
const command = { sessionId:'s', node:'brief', action:'refine_source_policy', requestId:'source-policy-s-0-open', expectedVersion:0, expectedRevision:0, idempotencyKey:'source-policy-s-0-open', sourcePolicy:{mode:'open',domains:[],internalSourceIds:[],revision:1} };
it.each(['open','prioritize','restrict'])( 'accepts the first %s source policy through the real wire schema', mode => {
 const raw = JSON.parse(JSON.stringify({...command,sourcePolicy:{...command.sourcePolicy,mode,domains:mode==='restrict'?['example.com']:[]},knownFields:{},compactSources:true}));
 expect(GuidedResearchRuntimeCommand.safeParse(raw).success).toBe(true);
});
it.each([
 {node:'report'},{node:'outline'},{node:'directions'},{expectedVersion:1},{expectedRevision:1},{expectedRevision:undefined},{idempotencyKey:undefined},
 {sourcePolicy:{...command.sourcePolicy,revision:0}},{sourcePolicy:{...command.sourcePolicy,revision:2}},{sourcePolicy:undefined},
 {draft:{node:'brief',value:{topic:'Injected',goal:'x',timeRange:'',region:'',focus:''}}},
 {message:'injected'},{proposalId:'proposal'},{intent:{decision:'Injected scope',audience:'Team',timeframe:{},deliverable:'Report',successCriteria:['Injected']}},{sourceUrl:'https://example.com'},{sourceId:'source'},
 {conflictId:'conflict'},{conflictResolution:'override'},{conflictResolutionAction:'retain_uncertainty'},{allowPartialResearch:false},
 {unexpected:'extra'},
])('rejects a non-bootstrap or extra capability: %j', patch => {
 expect(GuidedResearchRuntimeCommand.safeParse({...command,...patch}).success).toBe(false);
});
it('preserves existing research-stage steering', () => {
 expect(GuidedResearchRuntimeCommand.safeParse({...command,node:'research',expectedVersion:5,expectedRevision:3,sourcePolicy:{...command.sourcePolicy,revision:4}}).success).toBe(true);
});

it.each(['brief', 'research'])('rejects a materials-only policy at %s', node => {
 expect(GuidedResearchRuntimeCommand.safeParse({...command,node,sourcePolicy:{...command.sourcePolicy,mode:'materials'}}).success).toBe(false);
});
