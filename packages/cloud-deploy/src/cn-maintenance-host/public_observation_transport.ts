import { z } from 'zod';
import type { MaintenanceIdentity } from '../cn-maintenance-release';
const identitySchema = z.object({ sourceRevision: z.string().regex(/^[a-f0-9]{40}$/), baselineRevision: z.string().regex(/^[a-f0-9]{40}$/), migrationPlanSha256: z.string().regex(/^[a-f0-9]{64}$/), attemptId: z.string().regex(/^[A-Za-z0-9-]{1,128}$/) }).strict();
const count = z.number().int().nonnegative().safe();
const sampleSchema = z.object({ identity: identitySchema, observedAt: z.string().datetime(), deploymentMarker: z.string().min(1), hold: z.object({ state: z.literal('cleared'), generation: z.string().regex(/^[a-f0-9]{32}$/), sha256: z.string().regex(/^[a-f0-9]{64}$/), device: count, inode: count }).strict(), queue: z.object({ queued: count, running: count, writebackPending: count }).strict(), ownedRuns: z.array(z.object({ runId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), status: z.literal('succeeded') }).strict()).min(1), services: z.object({ web: z.literal('healthy'), api: z.literal('healthy'), agent: z.literal('healthy'), sandbox: z.literal('healthy') }).strict() }).strict();
const httpSchema = z.object({ url: z.string().url(), status: z.literal(200), observedAt: z.string().datetime(), body: z.record(z.unknown()) }).strict();
export interface PublicObservationReaders {
 /** Compiled reader must use no redirects/no cache, enforce response byte bound,
  * and stamp observedAt locally; no timestamp or status from response body. */
 readFixedPublicJson(url: string): Promise<unknown>;
 /** Read actual local hold CAS record, queue, persisted owned runs and health. */
 readHostEvidence(identity: MaintenanceIdentity): Promise<unknown>;
 /** Mandatory retained-writer/socket checks, independently of public results. */
 verifyRetainedHostObservation(identity: MaintenanceIdentity): Promise<void>;
 now(): Date;
}
export function bindPublicObservationReaders(binding: {identity: MaintenanceIdentity; publicOrigin: string; deploymentMarker: string; maximumAgeMs: number}, readers: PublicObservationReaders) {
 const identity = Object.freeze(identitySchema.parse(binding.identity));
 if(identity.sourceRevision !== '9b25bfa65662b96c0826fe67506b562ea46aa6d0' || identity.baselineRevision !== 'ba6343199f3c834d6a198f83d0c771614292c82b') throw Error('PUBLIC_OBSERVATION_FIXED_RELEASE_REQUIRED');
 const origin = new URL(binding.publicOrigin);
 if(origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/' || !binding.deploymentMarker || !Number.isSafeInteger(binding.maximumAgeMs) || binding.maximumAgeMs < 1 || binding.maximumAgeMs > 60000) throw Error('PUBLIC_OBSERVATION_POLICY_INVALID');
 for(const name of ['readFixedPublicJson','readHostEvidence','verifyRetainedHostObservation','now'] as const) if(typeof readers?.[name] !== 'function') throw Error('PUBLIC_OBSERVATION_READER_MISSING:'+name);
 const read = readers.readFixedPublicJson.bind(readers), host = readers.readHostEvidence.bind(readers), retained = readers.verifyRetainedHostObservation.bind(readers), now = readers.now.bind(readers);
 const marker = binding.deploymentMarker, maxAge = binding.maximumAgeMs;
 const same = (value: MaintenanceIdentity) => JSON.stringify(identitySchema.parse(value)) === JSON.stringify(identity);
 function fresh(value: string) { const age = now().getTime() - Date.parse(value); if(!Number.isFinite(age) || age < 0 || age > maxAge) throw Error('PUBLIC_OBSERVATION_STALE'); }
 async function endpoint(path: string) {
  const url = new URL(path, origin).href, value = httpSchema.parse(await read(url));
  if(value.url !== url) throw Error('PUBLIC_OBSERVATION_REDIRECT'); fresh(value.observedAt); return value.body;
 }
 async function readPublicIdentity() {
  const deployment = await endpoint('/.well-known/workspacex-deployment'), health = await endpoint('/api/healthz');
  if(deployment.deploymentMarker !== marker || health.deploymentMarker !== marker || health.trustworthy !== true) throw Error('PUBLIC_OBSERVATION_MARKER_REJECTED');
  // Source revision is bound by the reviewed marker mapping, not invented from
  // a response field the fixed 9b endpoints do not emit.
  return { sourceRevision: identity.sourceRevision, deploymentMarker: marker, trustworthy: true as const };
 }
 return { readPublicIdentity, readObservation: async () => {
  await retained(identity);
  const evidence = sampleSchema.parse(await host(identity));
  if(!same(evidence.identity) || evidence.deploymentMarker !== marker || new Set(evidence.ownedRuns.map(r=>r.runId)).size !== evidence.ownedRuns.length) throw Error('PUBLIC_OBSERVATION_HOST_IDENTITY');
  fresh(evidence.observedAt);
  try { await readPublicIdentity(); } finally { await retained(identity); }
  fresh(evidence.observedAt);
  // Derived from validated nonempty actual persisted runs/services, never fixed
  // plan flags. Mandatory retained observation cannot be replaced by these reads.
  return { identity, deploymentMarker: marker, holdPresent: false as const, ...evidence.queue, failedOwnedRuns: 0 as const, unhealthyServices: 0 as const };
 }};
}
