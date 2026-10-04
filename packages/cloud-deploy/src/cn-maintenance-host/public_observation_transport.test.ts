import { expect, it } from 'vitest';
import { bindPublicObservationReaders } from './public_observation_transport';
const identity = { sourceRevision: '9b25bfa65662b96c0826fe67506b562ea46aa6d0', baselineRevision: 'ba6343199f3c834d6a198f83d0c771614292c82b', migrationPlanSha256: 'a'.repeat(64), attemptId: 'observe' };
const stamp = '2026-10-04T17:00:00.000Z';
function fixture() {
 const calls: string[] = [];
 const evidence: any = { identity, observedAt: stamp, deploymentMarker: 'marker', hold: { state: 'cleared', generation: 'b'.repeat(32), sha256: 'c'.repeat(64), device: 1, inode: 2 }, queue: { queued: 0, running: 0, writebackPending: 0 }, ownedRuns: [{ runId: 'real-owned', status: 'succeeded' }], services: { web: 'healthy', api: 'healthy', agent: 'healthy', sandbox: 'healthy' } };
 const readers = { now: () => new Date(stamp), verifyRetainedHostObservation: async () => { calls.push('retained'); }, readHostEvidence: async () => { calls.push('host'); return evidence; }, readFixedPublicJson: async (url: string) => { calls.push(url); return { url, status: 200, observedAt: stamp, body: { deploymentMarker: 'marker', trustworthy: true } }; } };
 const binding = { identity, publicOrigin: 'https://example.invalid/', deploymentMarker: 'marker', maximumAgeMs: 1000 };
 return { calls, evidence, readers, binding };
}
it('requires independent retained host proof before actual host and fixed endpoint observations', async () => {
 const f = fixture(), ops = bindPublicObservationReaders(f.binding, f.readers);
 expect(await ops.readObservation()).toEqual({ identity, deploymentMarker: 'marker', holdPresent: false, queued: 0, running: 0, writebackPending: 0, failedOwnedRuns: 0, unhealthyServices: 0 });
 expect(f.calls).toEqual(['retained', 'host', 'https://example.invalid/.well-known/workspacex-deployment', 'https://example.invalid/api/healthz', 'retained']);
});
it('public success cannot replace retained host failure', async () => {
 const f = fixture(); f.readers.verifyRetainedHostObservation = async () => { throw Error('socket drift'); };
 await expect(bindPublicObservationReaders(f.binding, f.readers).readObservation()).rejects.toThrow('socket drift'); expect(f.calls).toEqual([]);
});
it('rejects missing/failed run evidence, unsafe queue, held and unhealthy state', async () => {
 for(const mutate of [(v:any)=>v.ownedRuns=[], (v:any)=>v.ownedRuns[0].status='failed', (v:any)=>v.queue.queued=Number.MAX_SAFE_INTEGER+1, (v:any)=>v.hold.state='held', (v:any)=>v.services.agent='unknown', (v:any)=>v.identity={...identity,attemptId:'foreign'}, (v:any)=>v.ownedRuns.push({...v.ownedRuns[0]})]) {
  const f = fixture(); mutate(f.evidence); await expect(bindPublicObservationReaders(f.binding,f.readers).readObservation()).rejects.toThrow();
 }
});
it('rejects future/stale host and public observations, redirects and wrong public markers', async () => {
 for(const stampBad of ['2026-10-04T17:00:01.000Z','2026-10-04T16:59:00.000Z']) {
  const f=fixture(); f.evidence.observedAt=stampBad; await expect(bindPublicObservationReaders(f.binding,f.readers).readObservation()).rejects.toThrow('PUBLIC_OBSERVATION_STALE');
 }
 for(const override of [{ observedAt:'2026-10-04T16:59:00.000Z' },{ url:'https://other.invalid/' }, { body:{deploymentMarker:'other',trustworthy:true} },{ status:503 }]) {
  const f=fixture(), original=f.readers.readFixedPublicJson; f.readers.readFixedPublicJson=async url=>({...await original(url),...override} as any);
  await expect(bindPublicObservationReaders(f.binding,f.readers).readPublicIdentity()).rejects.toThrow();
 }
});
it('rejects other revisions and absent evidence producers before I/O', () => {
 const f=fixture(); expect(()=>bindPublicObservationReaders({...f.binding,identity:{...identity,sourceRevision:'a'.repeat(40)}},f.readers)).toThrow('PUBLIC_OBSERVATION_FIXED_RELEASE_REQUIRED');
 expect(()=>bindPublicObservationReaders(f.binding,{...f.readers,readHostEvidence:undefined} as any)).toThrow('PUBLIC_OBSERVATION_READER_MISSING'); expect(f.calls).toEqual([]);
});

it('public success still rejects final retained writer drift', async () => {
 const f=fixture(); let checks=0; f.readers.verifyRetainedHostObservation=async()=>{if(++checks===2)throw Error('final retained drift');};
 await expect(bindPublicObservationReaders(f.binding,f.readers).readObservation()).rejects.toThrow('final retained drift'); expect(checks).toBe(2);
});
