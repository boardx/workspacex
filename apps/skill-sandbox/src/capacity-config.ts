import { sessionLimits as L } from './session/schema.js';
import type { CapacityPolicy } from './execution-capacity.js';
export function capacityPolicy(env: NodeJS.ProcessEnv = process.env): CapacityPolicy {
  const read = (name: string, fallback: number, maximum: number) => {
    const raw = env[name]?.trim();
    if (!raw) return fallback;
    if (!/^[0-9]+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1 || Number(raw) > maximum) {
      throw new Error(`INVALID_CAPACITY_CONFIG:${name}`);
    }
    return Number(raw);
  };
  return {
    concurrency: read('SKILL_SANDBOX_CONCURRENCY', L.executionConcurrency!, 128),
    maxQueue: read('SKILL_SANDBOX_MAX_QUEUE', L.executionMaxQueue!, 1024),
    ownerConcurrency: read('SKILL_SANDBOX_USER_CONCURRENCY', L.executionOwnerConcurrency!, 128),
    ownerMaxQueue: read('SKILL_SANDBOX_USER_MAX_QUEUE', L.executionOwnerMaxQueue!, 1024),
    queueWaitMs: read('SKILL_SANDBOX_QUEUE_WAIT_MS', L.executionQueueWaitMs!, 60000),
  };
}
/** Private UDS transport metadata only; a missing owner shares one conservative bucket. */
export function capacityOwner(raw: string | string[] | undefined): string {
  if (raw === undefined) return 'unscoped';
  if (typeof raw !== 'string' || !/^[a-f0-9]{64}$/.test(raw)) throw new Error('INVALID_CAPACITY_OWNER');
  return raw;
}
