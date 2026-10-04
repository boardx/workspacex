import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runHostMaintenance, type HostBinding, type HostPrimitives } from './controller';
import { runFixedPython } from './fixed_transport';
const identity = { sourceRevision: 'a'.repeat(40), baselineRevision: 'b'.repeat(40), migrationPlanSha256: 'c'.repeat(64), attemptId: 'attempt-1' };
const request = { ...identity, maintenanceOptIn: 'stop-all-writes-and-require-database-recovery' as const };
const binding: HostBinding = { identity, writerPlanPath: '/private/plan.json', writerPlanSha256: 'd'.repeat(64), writerPlanCanonicalSha256: '3'.repeat(64), hold: { path: '/trusted/hold.py', sha256: 'e'.repeat(64) }, writerFence: { path: '/trusted/fence.py', sha256: 'f'.repeat(64) } };
function fixture() {
  const calls: string[] = []; let state = 'held';
  const record = () => ({ schemaVersion: 1, state, generation: '1'.repeat(32), identity, sha256: state === 'held' ? '2'.repeat(64) : '3'.repeat(64), device: 1, inode: state === 'held' ? 2 : 3 });
  const primitives: HostPrimitives = {
    assertTrustedBinding: async () => { calls.push('trust'); },
    verifyRecoveryExecutorCapability: async () => { calls.push('capability'); },
    acquireReleaseLock: async () => { calls.push('lock'); return async () => { calls.push('unlock'); }; },
    prepareOffline: async () => { calls.push('offline'); }, verifyThreeDatabaseRecovery: async () => { calls.push('recovery'); },
    migrateExactPlan: async () => { calls.push('migrate'); }, verifyProductionDynamic: async () => { calls.push('dynamic'); },
    verifyPreactivate: async () => { calls.push('preactivate'); }, activate: async () => { calls.push('activate'); }, verifyAcceptance: async () => { calls.push('accept'); },
  };
  const run = async (command: any, args: readonly string[], input?: any) => {
    if (command.path === binding.hold.path) {
      calls.push('hold:' + args[0]); assert.equal(args[1], '/var/lib/workspacex-cn/runtime');
      if (args[0] === 'create') assert.deepEqual(input, identity);
      if (args[0] === 'clear') { assert.deepEqual(input, record()); state = 'cleared'; }
      return { stdout: JSON.stringify(record()) };
    }
    assert.deepEqual(args.slice(0, 3), ['--apply-reviewed-fence', binding.writerPlanPath, binding.writerPlanSha256]);
    calls.push(args[3] ?? '');
    if (['verifyAllWritersDrained', 'verifyWritesBlocked'].includes(args[3] ?? '')) return { stdout: JSON.stringify({ schemaVersion: 1, kind: 'maintenance-writers-held', identity, holdGeneration: '1'.repeat(32), observedAt: Date.now() / 1000, host: { instanceId: 'fixture-instance', bootId: 'fixture-boot' }, databasePeers: { workspacex: {}, workspacex_agent: {}, workspacex_memory: {} }, holdSha256: '2'.repeat(64), planSha256: '3'.repeat(64), observationSha256: '4'.repeat(64), databaseSessionsSha256: '5'.repeat(64), families: ['http', 'socket', 'queue', 'background', 'agent', 'checkpoint', 'memory', 'privileged'], ready: false }) };
    return { stdout: JSON.stringify({ callback: args[3], identity, state: 'fixture-state', ready: false, productionAvailabilityProven: false }) };
  };
  return { calls, primitives, run };
}
test('connects existing state machine and original hold CAS without provision', async () => {
  const f = fixture(); await runHostMaintenance(request, binding, f.primitives, f.run);
  assert.deepEqual(f.calls, ['trust', 'capability', 'lock', 'offline', 'recovery', 'hold:create', 'hold:read', 'blockAllWrites', 'verifyAllWritersDrained', 'migrate', 'dynamic', 'preactivate', 'activate', 'accept', 'resumeWrites', 'verifyWritesResumed', 'hold:clear', 'hold:read', 'unlock']);
});
test('missing production recovery aborts before lock or mutation', async () => {
  const f = fixture(); f.primitives.verifyRecoveryExecutorCapability = async () => { throw new Error('PRODUCTION_RECOVERY_EXECUTOR_NOT_IMPLEMENTED'); };
  await assert.rejects(runHostMaintenance(request, binding, f.primitives, f.run), { message: 'PRODUCTION_RECOVERY_EXECUTOR_NOT_IMPLEMENTED' }); assert.deepEqual(f.calls, ['trust']);
});
test('identity mismatch aborts before trust or commands', async () => {
  const f = fixture(); await assert.rejects(runHostMaintenance({ ...request, attemptId: 'other' }, binding, f.primitives, f.run), { message: 'HOST_IDENTITY_MISMATCH' }); assert.deepEqual(f.calls, []);
});
test('missing explicit maintenance opt-in aborts before capability probing', async () => {
  const f = fixture(); await assert.rejects(runHostMaintenance({ ...request, maintenanceOptIn: 'normal-release' } as any, binding, f.primitives, f.run), { message: 'MAINTENANCE_OPT_IN_REQUIRED' }); assert.deepEqual(f.calls, []);
});
test('migration failure retains hold and requests database recovery', async () => {
  const f = fixture(); f.primitives.migrateExactPlan = async () => { throw new Error('fixture-db-error'); };
  await assert.rejects(runHostMaintenance(request, binding, f.primitives, f.run), { message: 'MAINTENANCE_DATABASE_RECOVERY_REQUIRED_WRITES_HELD' });
  assert.equal(f.calls.includes('hold:clear'), false); assert.equal(f.calls.includes('resumeWrites'), false);
  assert.deepEqual(f.calls.slice(-4), ['hold:read', 'verifyWritesBlocked', 'recordDatabaseRecoveryRequired', 'unlock']);
});
test('unknown blocked state retains release lock', async () => {
  const f = fixture(); f.primitives.migrateExactPlan = async () => { throw new Error('fixture-db-error'); };
  const original = f.run; f.run = async (command, args, input) => { if (args[3] === 'verifyWritesBlocked') throw new Error('unknown'); return original(command, args, input); };
  await assert.rejects(runHostMaintenance(request, binding, f.primitives, f.run), { message: 'MAINTENANCE_WRITE_STATE_RECONCILIATION_REQUIRED_LOCK_RETAINED' });
  assert.equal(f.calls.includes('unlock'), false); assert.equal(f.calls.includes('recordWriteStateReconciliationRequired'), true);
});
test('writer boolean success cannot substitute exact response protocol', async () => {
  const f = fixture(); const original = f.run;
  f.run = async (command, args, input) => command.path === binding.writerFence.path ? { stdout: JSON.stringify({ ready: true }) } : original(command, args, input);
  await assert.rejects(runHostMaintenance(request, binding, f.primitives, f.run), { message: 'MAINTENANCE_WRITE_STATE_RECONCILIATION_REQUIRED_LOCK_RETAINED' });
  assert.equal(f.calls.includes('migrate'), false);
});
test('fixed production command cannot run on this non-root macOS test host', async () => {
  if (process.platform !== 'linux' || process.getuid?.() !== 0) await assert.rejects(runFixedPython(binding.hold, ['read']), { message: 'ROOT_LINUX_REQUIRED' });
});
test('lost durable hold creation response reconciles by readback without proceeding to migration', async () => {
  const f = fixture(); const original = f.run;
  f.run = async (command, args, input) => { const result = await original(command, args, input); if (args[0] === 'create') throw new Error('response-lost'); return result; };
  await assert.rejects(runHostMaintenance(request, binding, f.primitives, f.run), { message: 'MAINTENANCE_DATABASE_RECOVERY_REQUIRED_WRITES_HELD' });
  assert.equal(f.calls.includes('migrate'), false); assert.equal(f.calls.includes('hold:clear'), false);
  assert.deepEqual(f.calls.slice(-4), ['hold:read', 'verifyWritesBlocked', 'recordDatabaseRecoveryRequired', 'unlock']);
});
test('stale real guard response cannot release the held-state gate', async () => {
  const f = fixture(); const original = f.run;
  f.run = async (command, args, input) => {
    const result = await original(command, args, input);
    if (['verifyAllWritersDrained', 'verifyWritesBlocked'].includes(args[3] ?? '')) { const value = JSON.parse(result.stdout); value.observedAt -= 60; return { stdout: JSON.stringify(value) }; }
    return result;
  };
  await assert.rejects(runHostMaintenance(request, binding, f.primitives, f.run), { message: 'MAINTENANCE_WRITE_STATE_RECONCILIATION_REQUIRED_LOCK_RETAINED' });
  assert.equal(f.calls.includes('migrate'), false); assert.equal(f.calls.includes('unlock'), false);
});

for (const field of ['holdSha256', 'planSha256'] as const) test('valid but mismatched guard '+field+' retains hold and lock', async () => {
 const f=fixture();const original=f.run;
 f.run=async(command,args,input)=>{const result=await original(command,args,input);if(['verifyAllWritersDrained','verifyWritesBlocked'].includes(args[3] ?? '')){const value=JSON.parse(result.stdout);value[field]='9'.repeat(64);return {stdout:JSON.stringify(value)};}return result;};
 await assert.rejects(runHostMaintenance(request,binding,f.primitives,f.run),{message:'MAINTENANCE_WRITE_STATE_RECONCILIATION_REQUIRED_LOCK_RETAINED'});
 assert.equal(f.calls.includes('migrate'),false);assert.equal(f.calls.includes('hold:clear'),false);assert.equal(f.calls.includes('unlock'),false);
});
