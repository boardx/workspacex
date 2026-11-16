import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';

export const sha256 = text => createHash('sha256').update(text).digest('hex');
export const assert = (condition, code) => { if (!condition) throw new Error(code); };
export function readLedger(file) {
  assert(isAbsolute(file) && file.endsWith('.json'), 'ABSOLUTE_SUPPLEMENT_LEDGER_REQUIRED');
  const ledger = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { schemaVersion: 1, budget: 'supplement-design-20261116', maximumBusinessTasks: 2, entries: [] };
  assert(ledger.schemaVersion === 1 && ledger.budget === 'supplement-design-20261116' && ledger.maximumBusinessTasks === 2 && Array.isArray(ledger.entries), 'SUPPLEMENT_LEDGER_INVALID');
  return ledger;
}
function mutate(file, apply) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const lock = `${file}.lock`; mkdirSync(lock, { mode: 0o700 });
  try {
    const ledger = readLedger(file), result = apply(ledger), temporary = `${file}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(ledger, null, 2), { flag: 'wx', mode: 0o600 }); renameSync(temporary, file); return result;
  } finally { rmdirSync(lock); }
}
export function reserveTask(file, { phase, projectId, designId, prompt }) {
  return mutate(file, ledger => {
    assert(['v1', 'v2'].includes(phase) && projectId && designId && prompt, 'TASK_IDENTITY_REQUIRED');
    assert(ledger.entries.length < 2, 'SUPPLEMENT_BUDGET_EXHAUSTED');
    assert(!ledger.entries.some(row => row.phase === phase), 'TASK_ALREADY_RESERVED_NO_AUTOMATIC_RETRY');
    if (phase === 'v2') assert(ledger.entries.some(row => row.phase === 'v1' && row.status === 'succeeded' && row.projectId === projectId && row.designId === designId), 'V1_SUCCESS_REQUIRED');
    const task = { id: randomUUID(), phase, projectId, designId, promptSha256: sha256(prompt), reservedAt: new Date().toISOString(), status: 'reserved', physicalRequests: 'pending-stack-owner-audit', tokens: 'pending-stack-owner-audit', settlement: 'pending-stack-owner-audit' };
    ledger.entries.push(task); return task.id;
  });
}
export function markRequest(file, id) {
  mutate(file, ledger => { const row = ledger.entries.find(row => row.id === id); assert(row?.status === 'reserved', 'TASK_REQUEST_ALREADY_OBSERVED'); row.status = 'request-observed'; row.sentAt = new Date().toISOString(); row.businessPostCount = 1; });
}
export function finishTask(file, id, outcome) {
  mutate(file, ledger => { const row = ledger.entries.find(row => row.id === id); assert(row && ['request-observed', 'reserved'].includes(row.status), 'TASK_OUTCOME_ALREADY_RECORDED'); Object.assign(row, outcome, { status: outcome.succeeded ? 'succeeded' : 'failed-or-interrupted', finishedAt: new Date().toISOString() }); });
}
export function assertFrozen(snapshot, expected) { assert(typeof snapshot === 'string' && snapshot === expected, 'OLD_S6_SNAPSHOT_CHANGED'); }
export function assertLaterVersion(first, next) { assert(next.id !== first.id && next.seq > first.seq && next.prototypeSha256 !== first.prototypeSha256, 'V2_NOT_DISTINCT_LATER_VERSION'); }
