import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {tsImport} from 'tsx/esm/api';
import {validateBoardSoakArtifact} from './board-soak-policy.mjs';
import {boardAcceptanceMatrix} from './board-acceptance-matrix.mjs';
const {nextBoardChain, signBoardSoakLedger} = await tsImport(new URL('../../api/scripts/board-acceptance-ledger.ts', import.meta.url).href, import.meta.url);
const {signRecoveryPhase}=await tsImport(new URL('../e2e/support/board-soak-recovery-phase.ts',import.meta.url).href,import.meta.url);
const sha = 'a'.repeat(40), key = 'UNIT-ONLY-NOT-ACCEPTANCE-SECRET-12345';
const digest = value => createHash('sha256').update(value).digest('hex');
const start = Date.parse('2026-09-27T00:00:00Z'), iso = offset => new Date(start + offset).toISOString();
function fixture() {
  const identities = Array.from({length:50}, (_, i) => ({userId:`synthetic-${i}`, role:i === 0 ? 'owner' : i < 20 ? 'editor' : 'viewer'}));
  const samples = [], acknowledgements = [], projectionEvidence = [], acknowledgementTimings = [];
  let chain = digest(`${sha}:${iso(0)}`), revision = 0;
  for (let round = 0; round <= 60; round++) {
    const t = round * 30000;
    for (let i = 0; i < 20; i++) {
      revision++;
      const ack = {operationId:`op-${revision}`, actorId:identities[i].userId, revision, stateHash:digest(`revision-${revision}`), sentAt:iso(t+10), acknowledgedAt:iso(t+20)};
      acknowledgements.push(ack); acknowledgementTimings.push({...ack, sentMonotonicMs:t+10, acknowledgedMonotonicMs:t+20});
    }
    for (const actor of identities) {
      const sample = {at:iso(t+100), clientId:actor.userId, writer:actor.role !== 'viewer', connected:true, revision, stateHash:digest(`revision-${revision}`), latencyMs:80};
      chain = nextBoardChain(chain, sample); samples.push({...sample,chainHash:chain});
      projectionEvidence.push({clientId:actor.userId, at:sample.at, observedAt:iso(t+90), projectionHash:digest(`projection-${revision}`), revision});
    }
  }
  const runtimeIdentity = {sha,buildSha:sha,dirty:false,method:'fresh-server-marker-and-built-chunk-hashes',deploymentMarker:'UNIT',buildId:'UNIT',runStartedAt:iso(-2000),buildCreatedAt:iso(-1000),chunks:[{url:'http://unit/_next/static/unit.js',sha256:digest('unit'),localSha256:digest('unit')}]};
  const ledger = signBoardSoakLedger({version:2,sha,buildSha:sha,startedAt:iso(0),finishedAt:iso(1800200),durationMs:1800200,clients:50,writers:20,convergenceP95Ms:80,finalStateHash:samples.at(-1).stateHash,samples,acknowledgements},key);
  let recoveryRevision=revision;
  const recoveries=[20,21,22,23,24].map((i,index)=>{
    const t=1800300+index*32000,beforeRevision=recoveryRevision;
    const acknowledgements=identities.slice(0,20).map(actor=>{recoveryRevision++;return{operationId:`recovery-${recoveryRevision}`,actorId:actor.userId,revision:recoveryRevision,stateHash:digest(`revision-${recoveryRevision}`),sentAt:iso(t+100),acknowledgedAt:iso(t+200)};});
    const observerHash=acknowledgements.at(-1).stateHash;
    return{clientId:identities[i].userId,disconnectedAt:iso(t),reconnectedAt:iso(t+31000),beforeRevision,afterRevision:recoveryRevision,offlineMonotonicMs:30000,observerHash,peerHashes:identities.map(actor=>({clientId:actor.userId,revision:recoveryRevision,stateHash:observerHash})),acknowledgements};
  });
  const recoveryPhase=signRecoveryPhase({version:1,sha,measurementSignature:ledger.signature,startedAt:iso(1800201),finishedAt:iso(1960000),recoveries},key);
  const transport=recoveries.flatMap(r=>[{clientId:r.clientId,at:r.disconnectedAt,type:'disconnect',revision:r.beforeRevision},{clientId:r.clientId,at:r.reconnectedAt,type:'sync',revision:r.afterRevision}]);
  return {ledger,runtime:{runtimeBefore:runtimeIdentity,runtimeAfter:runtimeIdentity,recoveryRuntimeAfter:runtimeIdentity,elapsedMonotonicMs:1800200,round:61,identities,projectionEvidence,recoveries,recoveryPhase,transport,acknowledgementTimings}};
}
async function check(mutate = () => {}, reportMutate = () => {}, suppliedKey = key) {
  const directory = await mkdtemp(join(tmpdir(),'soak-validator-unit-'));
  try {
    const data = fixture(); mutate(data);
    const report = {version:1,kind:'board-collaboration-soak',runtimeIdentity:data.runtime.runtimeAfter};
    for (const name of ['ledger','runtime']) {const bytes = JSON.stringify(data[name]); const path = join(directory,`${name}.json`); await writeFile(path,bytes); report[name] = {path,sha256:digest(bytes)};}
    reportMutate(report);
    return await validateBoardSoakArtifact(report,sha,suppliedKey);
  } finally {await rm(directory,{recursive:true,force:true});}
}
function resignRecovery(data){const{signature:_,...body}=data.runtime.recoveryPhase;data.runtime.recoveryPhase=signRecoveryPhase(body,key);}
test('UNIT synthetic valid structure does not award score; matrix runs actual browser producer', async () => {
  const result = await check(); assert.deepEqual(result.failures,[]); assert.equal(result.valid,true); assert.equal(result.score,null);
  assert.ok(boardAcceptanceMatrix.find(row => row.lane === 'collaboration-50').command.includes('playwright.board-soak-acceptance.config.ts'));
  assert.ok(boardAcceptanceMatrix.find(row => row.lane === 'meeting-room').command.includes('apps/web/scripts/run-board-observation-producer.mjs'));
});
for (const [name, mutate, expected] of [
  ['forged signature',d=>{d.ledger.signature='f'.repeat(64);},'SOAK_SIGNED_LEDGER'],
  ['short actual duration',d=>{d.runtime.elapsedMonotonicMs=1;},'SOAK_WALL_MONOTONIC_DURATION'],
  ['duplicate identity',d=>{d.runtime.identities[1].userId=d.runtime.identities[0].userId;},'SOAK_DISTINCT_IDENTITIES'],
  ['missing writer ACK',d=>{d.runtime.acknowledgementTimings.pop();},'SOAK_RAW_ACK_COUNT'],
  ['mismatched ACK',d=>{d.runtime.acknowledgementTimings[0].revision=999;},'SOAK_RAW_ACK_MISMATCH'],
  ['missing projection',d=>{d.runtime.projectionEvidence.pop();},'SOAK_PROJECTION_COUNT'],
  ['divergent browser projection',d=>{d.runtime.projectionEvidence[0].projectionHash='f'.repeat(64);},'SOAK_PEER_PROJECTION_DIVERGENCE'],
  ['missing recovery',d=>{d.runtime.recoveries.pop();},'SOAK_RECOVERY_COUNT'],
  ['missing reconnect sync',d=>{d.runtime.transport=d.runtime.transport.filter(e=>e.type!=='sync');},'SOAK_RECOVERY_EVIDENCE'],
  ['short reconnect gap',d=>{d.runtime.recoveries[0].offlineMonotonicMs=29000;resignRecovery(d);},'SOAK_RECOVERY_EVIDENCE'],
  ['lost recovery ACK',d=>{d.runtime.recoveries[0].acknowledgements.pop();resignRecovery(d);},'SOAK_RECOVERY_EVIDENCE'],
  ['forked recovery peer',d=>{d.runtime.recoveries[0].peerHashes[0].stateHash='f'.repeat(64);resignRecovery(d);},'SOAK_RECOVERY_EVIDENCE'],
  ['duplicate recovery operation',d=>{d.runtime.recoveries[0].acknowledgements[1].operationId=d.runtime.recoveries[0].acknowledgements[0].operationId;resignRecovery(d);},'SOAK_RECOVERY_EVIDENCE'],
  ['malformed recovery ACK timestamp',d=>{d.runtime.recoveries[0].acknowledgements[0].sentAt='invalid';resignRecovery(d);},'SOAK_RECOVERY_EVIDENCE'],
  ['interrupted measurement',d=>{d.runtime.transport.push({type:'disconnect',clientId:d.runtime.identities[20].userId,at:iso(1000)});},'SOAK_MEASUREMENT_INTERRUPTED'],
  ['wrong build SHA',d=>{d.runtime.runtimeAfter.buildSha='b'.repeat(40);},'SOAK_RUNTIME_IDENTITY'],
]) test(`UNIT rejects ${name}`, async () => {assert.ok((await check(mutate)).failures.includes(expected));});
test('UNIT rejects changed artifact bytes and missing key', async () => {
  assert.ok((await check(undefined,r=>{r.runtime.sha256='f'.repeat(64);})).failures.includes('SOAK_runtime_HASH'));
  assert.ok((await check(undefined,undefined,'')).failures.includes('LEDGER_KEY_REQUIRED'));
});
