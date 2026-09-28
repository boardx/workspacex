import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {validateRuntimeBinding} from './board-observation-policy.mjs';

const digest=value=>assert.match(value,/^[a-f0-9]{64}$/);
function persisted(report,output){
 const rows=report.suites.flatMap(s=>s.specs.flatMap(s=>s.tests));const values=new Map();
 for(const row of rows)for(const attachment of row.results[0]?.attachments??[]){
  assert(!values.has(attachment.name));assert(resolve(attachment.path).startsWith(resolve(output)+sep));
  const bytes=readFileSync(attachment.path);assert.equal(bytes.length,attachment.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),attachment.sha256);
  values.set(attachment.name,attachment.name==='portable-confirmed-canvas'?bytes:JSON.parse(bytes.toString()));
 }
 return{rows,values};
}

export function validateCapturedVendorCiEvidence(report,sha,context,output){
 const failures=[],pending=[];let runtimeIdentity=null;
 try{
  const {rows,values}=persisted(report,output);assert.equal(rows.length,1);
  const artifact=values.get('captured-vendor-evidence.json'),runtime=values.get('captured-vendor-runtime.json');assert(artifact&&runtime);
  assert.equal(artifact.version,1);assert.equal(artifact.kind,'captured-vendor-import');assert.equal(artifact.fixtures.length,3);
  assert.deepEqual([...new Set(artifact.fixtures.map(row=>row.source))].sort(),['miro','mural']);
  assert.equal(new Set(artifact.fixtures.map(row=>`${row.source}:${row.name}`)).size,3);
  assert(artifact.fixtures.some(row=>row.classification==='captured-account-export'&&row.sourceEvidence?.length&&row.sourceHash));
  assert.deepEqual([...new Set(artifact.fixtures.map(row=>row.classification))],['captured-account-export']);
  assert.deepEqual([...new Set(artifact.fixtures.map(row=>row.realBoardAcceptance))],['requires-source-evidence-review']);
  assert(artifact.fixtures.some(row=>row.sourceEvidence?.some(value=>typeof value==='string'&&value.trim())));
  const hashes=artifact.fixtures.map(row=>row.sourceHash);assert.equal(new Set(hashes).size,3);hashes.forEach(digest);
  for(const row of artifact.fixtures){assert.equal(row.replay.replayed,true);assert.equal(row.replay.seq,row.accepted.seq);assert.deepEqual(row.report,row.accepted.report);assert.equal(row.localEvidence.initialHash,row.localEvidence.reloadedHash);assert.equal(row.localEvidence.initialHash,row.localEvidence.peerHash);assert.equal(row.portableEvidence.replay.replayed,true);assert.equal(row.portableEvidence.replay.seq,row.portableEvidence.accepted.seq);assert.equal(row.portableEvidence.ownerLocalHash,row.portableEvidence.peerLocalHash);digest(row.portableEvidence.bundleSha256);}
  assert.equal(runtime.scenario,'captured-vendor-import');runtimeIdentity=runtime.runtimeIdentity;failures.push(...validateRuntimeBinding(runtimeIdentity,sha,context));
 }catch{failures.push('CAPTURED_VENDOR_EVIDENCE_INVALID');}
 return{valid:failures.length===0,failures,pending,runtimeIdentity,counterproof:true};
}

export function validateApiWsObjectstoreCiEvidence(report,sha,context,output){
 const failures=[],pending=[];let runtimeIdentity=null;
 try{
  const {rows,values}=persisted(report,output);assert.equal(rows.length,3);
  const agent=values.get('agent-api-evidence'),outbox=values.get('same-browser-outbox-evidence'),portable=values.get('portable-roundtrip'),race=values.get('portable-revocation-race'),runtime=values.get('api-ws-objectstore-runtime.json');
  assert(agent&&outbox&&portable&&race&&runtime);assert.equal(agent.kind,'board-agent-api');assert.equal(agent.sha,sha);assert.equal(agent.runtime.deploymentMarker,context.runtimeMarker);assert(agent.steps.length>=10);assert(agent.eventCount>0);
  for(const operation of ['Create','Update','Move','Arrange','Connect','Delete'])assert(agent.steps.some(step=>step.name===operation||step.name?.startsWith(`${operation} `)),operation);
  assert.equal(outbox.status,'passed');assert.equal(outbox.transport.dropped,0);assert(outbox.revisions.after>outbox.revisions.before);assert.equal(outbox.afterReloadSeq,outbox.revisions.after);assert(outbox.http.length>0&&outbox.http.every(row=>row.status>=200&&row.status<300));
  assert.equal(portable.canonicalEquivalent,true);assert.equal(portable.replay.replayed,true);assert.equal(portable.replay.seq,portable.accepted.seq);assert(portable.images.length>0);portable.images.forEach(image=>{digest(image.hash);digest(image.pixelHash);assert(image.width>0&&image.height>0);});
  assert.equal(race.blockedBeforeRevocationCommit,true);assert.equal(race.status,404);assert.equal(race.metadataUnchanged,true);
  assert.equal(runtime.scenario,'api-ws-objectstore');runtimeIdentity=runtime.runtimeIdentity;failures.push(...validateRuntimeBinding(runtimeIdentity,sha,context));
 }catch{failures.push('API_WS_OBJECTSTORE_EVIDENCE_INVALID');}
 return{valid:failures.length===0,failures,pending,runtimeIdentity,counterproof:true};
}

export function validateIntegratedLaneArtifact(report,lane,sha,context){
 const failures=[],pending=Array.isArray(report?.pending)?report.pending:[];
 try{
  assert.equal(report.version,1);assert.equal(report.kind,'board-integrated-lane');assert.equal(report.lane,lane);assert.equal(report.sha,sha);
  assert.equal(report.runtimeMarker,context.runtimeMarker);assert.equal(report.startedAt,context.startedAt);assert.equal(report.status,'engineering-checks-passed');assert.deepEqual(report.failures,[]);assert.equal(report.counterproof,true);
  failures.push(...validateRuntimeBinding(report.runtimeIdentity,sha,context));
 }catch{failures.push('INTEGRATED_LANE_ARTIFACT_INVALID');}
 return{valid:failures.length===0&&pending.length===0,failures,pending,budgetStatus:'engineering-targets'};
}
