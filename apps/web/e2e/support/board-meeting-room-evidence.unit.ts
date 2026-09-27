import {describe, expect, it} from 'vitest';
import {requiredRoomEvents, roomHash, signRoomLedger, validateRoomArtifact, validateRoomLedger, type RoomArtifact, type RoomLedger, type RoomReceipt, type RoomRuntime, type RoomState} from './board-meeting-room-evidence';
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
  const finalState = {...state(361),presenterId:null,followers:[]};
  const ledger = signRoomLedger({version:1,sha,buildSha:sha,boardId:'board',roomId:'room',presenterId:'owner',followerIds:['display','follower'],contentHash:'e'.repeat(64),startedAt:at(0),finishedAt:at(1800000),startedMonotonicMs:0,finishedMonotonicMs:1800000,samples,events,persistedState:finalState,finalState},key);
  const runtime: RoomRuntime = {sha,buildSha:sha,dirty:false,method:'fresh-server-marker-and-built-chunk-hashes',deploymentMarker:'b'.repeat(36),runStartedAt:at(-10000),buildCreatedAt:at(-5000),buildId:'unit-build',chunks:[{url:'/_next/static/test.js',sha256:'c'.repeat(64),localSha256:'c'.repeat(64)}]};
  receipts.push({at:at(1800001),monotonicMs:1800001,id:'cas',clientId:'owner',method:'POST',status:409,command:{type:'handoff',actorId:'owner',expectedRevision:360}});
  for(const method of ['GET','POST']) receipts.push({at:at(1800002),monotonicMs:1800002,id:`revoke-${method}`,clientId:'follower',method,status:403});
  return {version:1,kind:'board-meeting-room',ledger,runtimeBefore:runtime,runtimeAfter:structuredClone(runtime),receipts,observationErrors:[],identities:[{userId:'owner',actorId:'owner'},{userId:'display',actorId:'display'},{userId:'follower',actorId:'follower'}]};
}
function resign(report: RoomArtifact) {
  let chain=roomHash({sha:report.ledger.sha,boardId:report.ledger.boardId,roomId:report.ledger.roomId,startedAt:report.ledger.startedAt});
  for (const sample of report.ledger.samples) {const {chainHash: _old,...body}=sample;chain=roomHash({previous:chain,sample:body});sample.chainHash=chain;}
  report.ledger=signRoomLedger(report.ledger,key);return report;
}
describe('meeting-room evidence structural validators (not a real run)',()=>{
  it('accepts internally consistent unit observations without granting any score',()=>{expect(validateRoomArtifact(fixture(),sha,key)).toEqual([]);});
  it.each([
    ['short real duration',(r:RoomArtifact)=>{r.ledger.finishedMonotonicMs=1000;r.ledger.finishedAt=at(1000);}],
    ['forged wall clock',(r:RoomArtifact)=>{r.ledger.finishedAt=at(1900000);}],
    ['late first sample',(r:RoomArtifact)=>{r.ledger.startedMonotonicMs=-60000;r.ledger.startedAt=at(-60000);}],
    ['sampling gap',(r:RoomArtifact)=>{r.ledger.samples.splice(10,10);}],
    ['duplicate identities',(r:RoomArtifact)=>{r.identities[1]!.userId='owner';}],
    ['duplicate follower',(r:RoomArtifact)=>{r.ledger.samples[0]!.displays[1]!.actorId='display';}],
    ['revision rollback',(r:RoomArtifact)=>{r.ledger.samples[2]!.state.revision=1;}],
    ['incorrect projection',(r:RoomArtifact)=>{r.ledger.samples[0]!.displays[0]!.viewport={x:999,y:0,zoom:1};}],
    ['unchanged viewport',(r:RoomArtifact)=>{r.ledger.samples[1]!.state.viewport={...r.ledger.samples[0]!.state.viewport};}],
    ['unrotated reconnect token',(r:RoomArtifact)=>{const event=r.ledger.events.find(event=>event.type==='reconnect')!;event.detail={previousTokenHash:'f'.repeat(64),nextTokenHash:'f'.repeat(64)};event.detailHash=roomHash(event.detail);}],
    ['blank peer content',(r:RoomArtifact)=>{r.ledger.samples[0]!.displays[0]!.contentHash=roomHash([]);}],
    ['missing raw browser write',(r:RoomArtifact)=>{r.receipts=r.receipts.filter(receipt=>receipt.id!=='write-2');}],
    ['reused response',(r:RoomArtifact)=>{r.ledger.samples[1]!.receiptId='read-1';}],
    ['missing revocation',(r:RoomArtifact)=>{r.ledger.events=r.ledger.events.filter(event=>event.type!=='revoke');}],
    ['reordered lifecycle',(r:RoomArtifact)=>{[r.ledger.events[0],r.ledger.events[1]]=[r.ledger.events[1]!,r.ledger.events[0]!];}],
    ['CAS false green',(r:RoomArtifact)=>{r.ledger.events.find(event=>event.type==='cas-conflict')!.status=201;}],
    ['persisted mismatch',(r:RoomArtifact)=>{r.ledger.persistedState={...r.ledger.finalState,revision:1};}],
    ['runtime build mismatch',(r:RoomArtifact)=>{r.runtimeAfter.buildId='another-build';}],
    ['dirty runtime',(r:RoomArtifact)=>{r.runtimeAfter.dirty=true;}],
    ['bad served chunks',(r:RoomArtifact)=>{r.runtimeAfter.chunks[0]!.localSha256='d'.repeat(64);}],
  ] as const)('rejects re-signed %s',(_name,mutate)=>{const report=fixture();mutate(report);expect(validateRoomArtifact(resign(report),sha,key)).not.toEqual([]);});
  it('rejects wrong signing key independently of structural checks',()=>{expect(validateRoomLedger(fixture().ledger,'wrong-key-'.repeat(5))).toContain('SIGNATURE');});
});
