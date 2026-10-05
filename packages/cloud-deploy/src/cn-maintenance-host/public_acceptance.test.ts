import { expect, it } from 'vitest';
import { bindPublicAcceptance } from './public_acceptance';
const identity = { sourceRevision: '9'.repeat(40), baselineRevision: 'b'.repeat(40), migrationPlanSha256: 'a'.repeat(64), attemptId: 'test' };
function fixture() {
 const calls: string[] = [];
 const transport = {
  readPublicIdentity: async () => { calls.push('identity'); return { sourceRevision: identity.sourceRevision, deploymentMarker: 'candidate', trustworthy: true }; },
  verifyCanonical: async () => { calls.push('canonical'); return { status: 'passed', lockRetained: true, passedStages: 8 }; },
  runBrowserSmoke: async (): Promise<unknown> => { calls.push('browser'); return { login: true, hello: true, asr: true, githubFeedbackRead: true, skillTool: true, pdfDownload: true }; },
  readObservation: async (): Promise<unknown> => { calls.push('observe'); return { identity, deploymentMarker: 'candidate', holdPresent: false, queued: 0, running: 0, writebackPending: 0, failedOwnedRuns: 0, unhealthyServices: 0 }; },
 };
 return { calls, transport, binding: { identity, deploymentMarker: 'candidate', observationSamples: 2, maximumOutstandingRuns: 0 } };
}
it('runs existing canonical/browser contracts then separately observes after open', async () => {
 const f = fixture(), ops = bindPublicAcceptance(f.binding, f.transport);
 await ops.verifyPublicAcceptance(identity);
 expect(f.calls).toEqual(['identity', 'canonical', 'browser', 'identity']);
 await ops.observeOpenedCandidate(identity);
 expect(f.calls.slice(4)).toEqual(['identity', 'observe', 'identity', 'observe']);
});
it('never observes or accepts partial browser booleans', async () => {
 const f = fixture(); f.transport.runBrowserSmoke = async () => ({ login: true });
 await expect(bindPublicAcceptance(f.binding, f.transport).verifyPublicAcceptance(identity)).rejects.toThrow();
 expect(f.calls).not.toContain('observe');
});
it('rejects still-held traffic and changed observation identity', async () => {
 for (const override of [{ holdPresent: true }, { identity: { ...identity, attemptId: 'other' } }, { unhealthyServices: 1 }, { writebackPending: 1 }]) {
  const f = fixture(), original = f.transport.readObservation;
  f.transport.readObservation = async () => ({ ...await original() as object, ...override });
  await expect(bindPublicAcceptance(f.binding, f.transport).observeOpenedCandidate(identity)).rejects.toThrow();
 }
});
it('requires fresh identity after browser work and snapshots host callbacks', async () => {
 const f = fixture(); let reads = 0;
 f.transport.readPublicIdentity = async () => ({ sourceRevision: identity.sourceRevision, deploymentMarker: ++reads === 1 ? 'candidate' : 'other', trustworthy: true });
 const ops = bindPublicAcceptance(f.binding, f.transport);
 f.transport.runBrowserSmoke = async () => { throw Error('mutated'); };
 await expect(ops.verifyPublicAcceptance(identity)).rejects.toThrow('PUBLIC_ACCEPTANCE_IDENTITY_DRIFT');
 expect(f.calls).toContain('browser');
});
it('rejects caller identity before any evidence reads and repeated acceptance remains fresh', async () => {
 const f = fixture(), ops = bindPublicAcceptance(f.binding, f.transport);
 await expect(ops.verifyPublicAcceptance({ ...identity, attemptId: 'wrong' })).rejects.toThrow('PUBLIC_ACCEPTANCE_IDENTITY_CHANGED');
 expect(f.calls).toEqual([]);
 await ops.verifyPublicAcceptance(identity); await ops.verifyPublicAcceptance(identity);
 expect(f.calls.filter(c => c === 'browser')).toHaveLength(2);
});

it('rejects unsafe observation counts and missing compiled transport', async () => {
 const f = fixture(), original = f.transport.readObservation;
 f.transport.readObservation = async () => ({ ...await original() as object, running: Number.MAX_SAFE_INTEGER + 1 });
 await expect(bindPublicAcceptance(f.binding, f.transport).observeOpenedCandidate(identity)).rejects.toThrow();
 expect(() => bindPublicAcceptance(f.binding, { ...f.transport, readObservation: undefined } as any)).toThrow('PUBLIC_ACCEPTANCE_TRANSPORT_MISSING:readObservation');
});
