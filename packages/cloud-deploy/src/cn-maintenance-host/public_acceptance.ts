import { z } from 'zod';
import type { MaintenanceIdentity } from '../cn-maintenance-release';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const identitySchema = z.object({ sourceRevision: z.string().regex(/^[a-f0-9]{40}$/), baselineRevision: z.string().regex(/^[a-f0-9]{40}$/), migrationPlanSha256: hash, attemptId: z.string().regex(/^[A-Za-z0-9-]{1,128}$/) }).strict();
const browserSchema = z.object({ login: z.literal(true), hello: z.literal(true), asr: z.literal(true), githubFeedbackRead: z.literal(true), skillTool: z.literal(true), pdfDownload: z.literal(true) }).strict();
const markerSchema = z.object({ sourceRevision: z.string(), deploymentMarker: z.string().min(1), trustworthy: z.literal(true) }).strict();
const observationSchema = z.object({ identity: identitySchema, deploymentMarker: z.string(), holdPresent: z.literal(false), queued: z.number().int().nonnegative().safe(), running: z.number().int().nonnegative().safe(), writebackPending: z.number().int().nonnegative().safe(), failedOwnedRuns: z.literal(0), unhealthyServices: z.literal(0) }).strict();
export interface PublicAcceptanceTransport {
 /** Independent reads; writes/promotions belong to the step-six host adapter. */
 readPublicIdentity(): Promise<unknown>;
 verifyCanonical(): Promise<unknown>;
 runBrowserSmoke(): Promise<unknown>;
 readObservation(): Promise<unknown>;
}
export interface PublicAcceptanceBinding {
 identity: MaintenanceIdentity;
 deploymentMarker: string;
 /** Fixed local host policy, never supplied by a browser result. */
 observationSamples: number;
 maximumOutstandingRuns: number;
}
/** Reuses canonical eight-stage and browser six-journey consumers. This module
 * never converts plan flags into acceptance evidence and never opens traffic. */
export function bindPublicAcceptance(binding: PublicAcceptanceBinding, transport: PublicAcceptanceTransport) {
 const identity = Object.freeze(identitySchema.parse(binding.identity));
 const marker = binding.deploymentMarker;
 if (typeof marker !== 'string' || !marker || !Number.isSafeInteger(binding.observationSamples) || binding.observationSamples < 2 || binding.observationSamples > 60 || !Number.isSafeInteger(binding.maximumOutstandingRuns) || binding.maximumOutstandingRuns < 0) throw Error('PUBLIC_ACCEPTANCE_POLICY_INVALID');
 const samples = binding.observationSamples, maximum = binding.maximumOutstandingRuns;
 for (const name of ['readPublicIdentity', 'verifyCanonical', 'runBrowserSmoke', 'readObservation'] as const) if (typeof transport?.[name] !== 'function') throw Error('PUBLIC_ACCEPTANCE_TRANSPORT_MISSING:' + name);
 // Snapshot implementations before the first external read.
 const readIdentity = transport.readPublicIdentity.bind(transport), canonical = transport.verifyCanonical.bind(transport), browser = transport.runBrowserSmoke.bind(transport), observe = transport.readObservation.bind(transport);
 const same = (value: MaintenanceIdentity) => JSON.stringify(identitySchema.parse(value)) === JSON.stringify(identity);
 async function readMarker() {
  const value = markerSchema.parse(await readIdentity());
  if (value.sourceRevision !== identity.sourceRevision || value.deploymentMarker !== marker) throw Error('PUBLIC_ACCEPTANCE_IDENTITY_DRIFT');
 }
 return {
  verifyPublicAcceptance: async (value: MaintenanceIdentity) => {
   if (!same(value)) throw Error('PUBLIC_ACCEPTANCE_IDENTITY_CHANGED');
   await readMarker();
   z.object({ status: z.literal('passed'), lockRetained: z.literal(true), passedStages: z.literal(8) }).strict().parse(await canonical());
   browserSchema.parse(await browser());
   // A deployment change during real provider/browser work invalidates evidence.
   await readMarker();
  },
  /** Invoke only after hold clear CAS and independent readback. Failure requires
   * re-hold/reconciliation; this consumer cannot restore baseline after SQL. */
  observeOpenedCandidate: async (value: MaintenanceIdentity) => {
   if (!same(value)) throw Error('PUBLIC_ACCEPTANCE_IDENTITY_CHANGED');
   for (let sample = 0; sample < samples; sample++) {
    await readMarker();
    const result = observationSchema.parse(await observe());
    if (!same(result.identity) || result.deploymentMarker !== marker || result.queued + result.running + result.writebackPending > maximum) throw Error('OPENED_CANDIDATE_OBSERVATION_REJECTED');
   }
  },
 };
}
