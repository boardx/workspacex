import {describe, expect, it} from 'vitest';
import {requiredRoomEvents, roomHash, signRoomLedger, validateRoomArtifact, validateRoomLedger, type RoomArtifact, type RoomLedger, type RoomReceipt, type RoomRuntime, type RoomState} from '../../e2e/support/board-meeting-room-evidence';
// Synthetic values are exclusively validator counterproofs. They are never acceptance artifacts.
const key = 'unit-only-private-key-'.repeat(3), sha = 'a'.repeat(40), start = Date.parse('2026-09-27T01:00:00Z');
const at = (ms: number) => new Date(start + ms).toISOString();
function fixture(): RoomArtifact {
  const state = (revision: number): RoomState => ({boardId:'board',roomId:'room',revision,presenterId:'owner',viewport:{x:0,y:0,zoom:revision%2?1:1.1},followers:['display','follower'],updatedAt:at(revision*5000)});
  const samples: RoomLedger['samples'] = [], receipts: RoomReceipt[] = []; let chain = roomHash({sha,boardId:'board',roomId:'room',startedAt:at(0)});
  for (let index=1;index<=360;index++) {
    const value = state(index), clock = {at:at(index*5000),monotonicMs:index*5000}, receiptId = `read-${index}`;
    receipts.push({...clock,id:receiptId,clientId:'owner',status:200,method:'GET',state:value});
    receipts.push({...clock,id:`write-${index}`,clientId:'owner',status:201,method:'POST',command:{type:'viewport',actorId:'owner',expectedRevision:index-1},state:value});
    const body = {...clock,receiptId,state:value,displays:['display','follower'].map(actorId=>({actorId,viewport:value.viewport,contentHash:'e'.repeat(64)}))};
    chain = roomHash({previous:chain,sample:body}); samples.push({...body,chainHash:chain});
  }
  const events = requiredRoomEvents.map((type,index)=>{
    const time = type==='claim'?-2000:type==='follow'?-1000:type==='disconnect'?900000:type==='reconnect'?901000:1800000+index*1000;
    return {at:at(time),monotonicMs:time,type,before:361,after:361,detail:type==='reconnect'?{previousTokenHash:'f'.repeat(64),nextTokenHash:'e'.repeat(64)}:{type},detailHash:roomHash(type==='reconnect'?{previousTokenHash:'f'.repeat(64),nextTokenHash:'e'.repeat(64)}:{type}),...(type==='cas-conflict'?{status:409}:type.startsWith('revoked-')?{status:403}:{})};
  });
  const finalState = {...state(363),presenterId:null,followers:[]};
  const ledger = signRoomLedger({version:1,sha,buildSha:sha,boardId:'board',roomId:'room',presenterId:'owner',followerIds:['display','follower'],contentHash:'e'.repeat(64),startedAt:at(0),finishedAt:at(1800000),startedMonotonicMs:0,finishedMonotonicMs:1800000,samples,events,persistedState:finalState,finalState},key);
  const runtime: RoomRuntime = {sha,buildSha:sha,dirty:false,method:'fresh-server-marker-and-built-chunk-hashes',deploymentMarker:'b'.repeat(36),runStartedAt:at(-10000),buildCreatedAt:at(-5000),buildId:'unit-build',chunks:[{url:'/_next/static/test.js',sha256:'c'.repeat(64),localSha256:'c'.repeat(64)}]};
  receipts.push({at:at(1800001),monotonicMs:1800001,id:'cas',clientId:'owner',method:'POST',status:409,command:{type:'handoff',actorId:'owner',expectedRevision:360,toActorId:'follower'}});
  for(const method of ['GET','POST']) receipts.push({at:at(1800002),monotonicMs:1800002,id:`revoke-${method}`,clientId:'follower',method,status:403});
  const won={...state(361),presenterId:'display'};
  receipts.push({at:at(1805500),monotonicMs:1805500,id:'won',clientId:'owner',method:'POST',status:201,command:{type:'handoff',actorId:'owner',expectedRevision:360,toActorId:'display'},state:won});
  receipts.push({at:at(1805800),monotonicMs:1805800,id:'won-read',clientId:'owner',method:'GET',status:200,state:won});
  const cas=events.find(event=>event.type==='cas-conflict')!;cas.detail={statuses:[201,409]};cas.detailHash=roomHash(cas.detail);
  const handoff=events.find(event=>event.type==='handoff')!;handoff.before=360;handoff.detail=won;handoff.detailHash=roomHash(won);
  const revoked=events.find(event=>event.type==='revoke')!;revoked.detail={actorId:'follower'};revoked.detailHash=roomHash(revoked.detail);
  for(const [method,type] of [['GET','revoked-read'],['POST','revoked-write']]){
    const event=events.find(event=>event.type===type)!, receipt=receipts.find(item=>item.id===`revoke-${method}`)!;
    receipt.monotonicMs=event.monotonicMs-100;receipt.at=at(receipt.monotonicMs);
    if(method==='POST')receipt.command={type:'claim-presenter',actorId:'follower',expectedRevision:event.before};
  }
  return resign({version:1,kind:'board-meeting-room',ledger,runtimeBefore:runtime,runtimeAfter:structuredClone(runtime),receipts,observationErrors:[],identities:[{userId:'owner',actorId:'owner'},{userId:'display',actorId:'display'},{userId:'follower',actorId:'follower'}]});
}
function resign(report: RoomArtifact) {
  let chain=roomHash({sha:report.ledger.sha,boardId:report.ledger.boardId,roomId:report.ledger.roomId,startedAt:report.ledger.startedAt});
  for (const sample of report.ledger.samples) {const {chainHash: _old,...body}=sample;chain=roomHash({previous:chain,sample:body});sample.chainHash=chain;}
  report.ledger=signRoomLedger(report.ledger,key);return report;
}

describe('meeting-room raw handoff proof (synthetic validator tests only)',()=>{
 it('accepts a bound non-self CAS winner, loser, server read and ledger event',()=>expect(validateRoomArtifact(fixture(),sha,key)).toEqual([]));
 it('accepts the alternate CAS winner followed by authenticated transfer to the display',()=>{
  const value=fixture(), first=value.receipts.find(item=>item.id==='won')!, loser=value.receipts.find(item=>item.id==='cas')!;
  first.command!.toActorId='follower';first.state!.presenterId='follower';loser.command!.toActorId='display';
  const next={...first.state!,revision:362,presenterId:'display'};
  value.receipts.push({id:'second-handoff',clientId:'follower',method:'POST',status:201,at:at(1806500),monotonicMs:1806500,command:{type:'handoff',actorId:'follower',toActorId:'display',expectedRevision:361},state:next});
  value.receipts.push({id:'second-read',clientId:'owner',method:'GET',status:200,at:at(1806800),monotonicMs:1806800,state:next});
  const event=value.ledger.events.find(item=>item.type==='handoff')!;event.after=362;event.detail=next;event.detailHash=roomHash(next);
  expect(validateRoomArtifact(resign(value),sha,key)).toEqual([]);
 });
 it.each([
  ['missing 201',(r:RoomArtifact)=>{r.receipts=r.receipts.filter(item=>item.id!=='won');}],
  ['wrong target',(r:RoomArtifact)=>{r.receipts.find(item=>item.id==='won')!.command!.toActorId='follower';}],
  ['unpaired revision',(r:RoomArtifact)=>{r.receipts.find(item=>item.id==='cas')!.command!.expectedRevision=359;}],
  ['missing handoff event',(r:RoomArtifact)=>{r.ledger.events=r.ledger.events.filter(item=>item.type!=='handoff');}],
  ['missing GET winner',(r:RoomArtifact)=>{r.receipts=r.receipts.filter(item=>item.id!=='won-read');}],
  ['wrong handoff event state',(r:RoomArtifact)=>{const event=r.ledger.events.find(item=>item.type==='handoff')!;event.detail={...(event.detail as RoomState),presenterId:'follower'};event.detailHash=roomHash(event.detail);}],
  ['wrong CAS event revision',(r:RoomArtifact)=>{const event=r.ledger.events.find(item=>item.type==='cas-conflict')!;event.before=event.after=399;}],
  ['denial for unrelated actor',(r:RoomArtifact)=>{r.receipts.find(item=>item.id==='revoke-GET')!.clientId='owner';}],
  ['denial before revocation',(r:RoomArtifact)=>{const receipt=r.receipts.find(item=>item.id==='revoke-POST')!;receipt.monotonicMs=1;receipt.at=at(1);}],
  ['denied write wrong revision',(r:RoomArtifact)=>{r.receipts.find(item=>item.id==='revoke-POST')!.command!.expectedRevision=1;}],
  ['wrong response board',(r:RoomArtifact)=>{r.receipts.find(item=>item.id==='won')!.state!.boardId='another-board';}],
 ] as const)('rejects re-signed %s',(_name,mutate)=>{const value=fixture();mutate(value);expect(validateRoomArtifact(resign(value),sha,key)).not.toEqual([]);});
});
