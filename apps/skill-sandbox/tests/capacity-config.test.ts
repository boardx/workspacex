import { expect, it } from 'vitest';
import { capacityOwner, capacityPolicy } from '../src/capacity-config.js';
import { ExecutionCapacity } from '../src/execution-capacity.js';
import { sessionLimits as L } from '../src/session/schema.js';
it('uses generated contract defaults and validates all configured bounds before serving work', () => {
  expect(capacityPolicy({})).toEqual({concurrency:L.executionConcurrency,maxQueue:L.executionMaxQueue,ownerConcurrency:L.executionOwnerConcurrency,ownerMaxQueue:L.executionOwnerMaxQueue,queueWaitMs:L.executionQueueWaitMs});
  for(const name of ['SKILL_SANDBOX_CONCURRENCY','SKILL_SANDBOX_MAX_QUEUE','SKILL_SANDBOX_USER_CONCURRENCY','SKILL_SANDBOX_USER_MAX_QUEUE','SKILL_SANDBOX_QUEUE_WAIT_MS']) {
    for(const value of ['0','-1','1.5','1e2','0x10','garbage','9007199254740992']) expect(()=>capacityPolicy({[name]:value})).toThrow(`INVALID_CAPACITY_CONFIG:${name}`);
  }
  expect(()=>new ExecutionCapacity(capacityPolicy({SKILL_SANDBOX_USER_CONCURRENCY:'2'}))).toThrow('INVALID_CAPACITY_POLICY');
});
it('validates only opaque private transport keys and groups omitted identities conservatively', () => {
  expect(capacityOwner(undefined)).toBe('unscoped');
  expect(capacityOwner('a'.repeat(64))).toBe('a'.repeat(64));
  for(const raw of ['alice','a'.repeat(65),['a'.repeat(64)],'']) expect(()=>capacityOwner(raw)).toThrow('INVALID_CAPACITY_OWNER');
});
