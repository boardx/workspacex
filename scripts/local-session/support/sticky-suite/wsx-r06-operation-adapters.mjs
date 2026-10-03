import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export function createStickyOperationAdapters({ctx,owner,WhiteboardOperationRequest,core}){
 const validatedOperation=async(actor,commands)=>{
  const before=await ctx.state(actor);assert(actor.identity.userId&&actor.identity.orgId);
  return WhiteboardOperationRequest.parse({apiVersion:'2026-09-01',requestId:randomUUID(),boardId:actor.boardId,expectedRevision:{epoch:before.head.epoch,seq:before.head.seq},actor:{kind:'human',actorId:actor.identity.userId,orgId:actor.identity.orgId,role:before.head.role,scopes:['board:read','board:write'],delegatedBy:null},provenance:{source:'human',model:null,skill:null,sourceRevision:null,sourceArtifactId:null,layoutHash:null,inputObjectIds:[]},commands});
 };
 const sendOperation=async(actor,body)=>{
  const parsed=WhiteboardOperationRequest.parse(body);assert.equal(parsed.boardId,actor.boardId);assert.equal(parsed.actor.actorId,actor.identity.userId);
  const expected=parsed.actor.role==='viewer'?403:undefined;
  return ctx.request(actor,'POST',`/v1/whiteboards/${actor.boardId}/operations`,parsed,expected);
 };
 const fixtureOperation=async(actor,commands)=>{
  const before=await ctx.state(actor),body=await validatedOperation(actor,commands),response=await sendOperation(actor,body);assert(response.ok());
  return ctx.poll(()=>ctx.state(actor),value=>value.head.seq===before.head.seq+1&&value.head.epoch===before.head.epoch);
 };
 const setBoardMember=async(actor,userId,role)=>{
  assert.equal((await ctx.state(actor)).head.role,'owner');assert.notEqual(userId,actor.identity.userId);assert(['editor','viewer'].includes(role));
  await ctx.api(actor,'PUT',`/whiteboards/${actor.boardId}/members`,{userId,role});
 };
 const seedExistingConnector=async(from,to,relationship)=>{
  const before=await ctx.state(owner),document=core.createWhiteboardDocument(),id=randomUUID();let object;
  try{
   core.executeCommands(document,before.objects.map(item=>({type:'create',object:item})));
   new core.SpatialRelationshipCommandPort(document).dispatch({boardId:owner.boardId,clientId:'R06-existing-edge-fixture',gestureId:randomUUID(),command:{type:'create-connector',id,relationship:{...relationship,from,to,lineStyle:'solid',label:'',semanticRelation:''}}});
   object=core.readObjects(document).find(item=>item.id===id);assert(object);object.style={...object.style,stroke:'#CC00FF'};
  }finally{document.destroy();}
  await fixtureOperation(owner,[{type:'create',object}]);return id;
 };
 return{validatedOperation,sendOperation,fixtureOperation,setBoardMember,seedExistingConnector};
}
