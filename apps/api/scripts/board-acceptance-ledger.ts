import {createHash, createHmac, timingSafeEqual} from 'node:crypto';

/** Structural validator only: a signature does not establish that a load test ran.
 * A trusted real producer and runtime/build attestation are still required by R10.
 */
export const BOARD_SOAK_REQUIREMENTS = {
  clients: 50, writers: 20, durationMs: 30 * 60 * 1000, convergenceP95Ms: 300,
  maxSampleGapMs: 30_000, maxWriterAckGapMs: 60_000,
} as const;
export type BoardAck = {
  operationId: string; actorId: string; revision: number; stateHash: string;
  sentAt: string; acknowledgedAt: string;
};
export type BoardSoakSample = {
  at: string; clientId: string; writer: boolean; connected: boolean;
  revision: number; stateHash: string; latencyMs: number; chainHash: string;
};
export type BoardSoakLedger = {
  version: 2; sha: string; buildSha: string; startedAt: string; finishedAt: string;
  durationMs: number; clients: number; writers: number; convergenceP95Ms: number;
  finalStateHash: string; samples: BoardSoakSample[]; acknowledgements: BoardAck[]; signature: string;
};
const hashPattern = /^[a-f0-9]{64}$/;
const shaPattern = /^[a-f0-9]{40}$/;
const canonical = (value: unknown): string => Array.isArray(value)
  ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object'
    ? `{${Object.entries(value as Record<string, unknown>).filter(([key]) => key !== 'signature').sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
    : JSON.stringify(value);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function sign<T extends object>(body: T, key: string): T & {signature: string} {
  if (key.length < 32) throw new Error('BOARD_LEDGER_KEY_TOO_SHORT');
  return {...body, signature: createHmac('sha256', key).update(canonical(body)).digest('hex')};
}
function authentic(body: {signature: string}, key: string) {
  if (key.length < 32 || !hashPattern.test(body.signature)) return false;
  const expected = createHmac('sha256', key).update(canonical(body)).digest();
  const actual = Buffer.from(body.signature, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function validAck(ack: BoardAck, start: number, end: number) {
  const sent = Date.parse(ack.sentAt), received = Date.parse(ack.acknowledgedAt);
  return !!ack.operationId && !!ack.actorId && Number.isSafeInteger(ack.revision) && ack.revision > 0
    && hashPattern.test(ack.stateHash) && Number.isFinite(sent) && Number.isFinite(received)
    && start <= sent && sent <= received && received <= end;
}
function coversWindow(times: number[], start: number, end: number, gap: number) {
  return times.length >= 2 && times[0]! - start <= gap && end - times.at(-1)! <= gap
    && times.every((time, i) => i === 0 || (time > times[i - 1]! && time - times[i - 1]! <= gap));
}
export function nextBoardChain(previous: string, sample: Omit<BoardSoakSample, 'chainHash'>) {
  return digest(`${previous}:${canonical(sample)}`);
}
export function signBoardSoakLedger(body: Omit<BoardSoakLedger, 'signature'>, key: string): BoardSoakLedger { return sign(body, key); }
export function verifyBoardSoakLedger(ledger: BoardSoakLedger, key: string): boolean {
  try {
    if (!authentic(ledger, key) || ledger.version !== 2 || !shaPattern.test(ledger.sha) || ledger.buildSha !== ledger.sha) return false;
    const start = Date.parse(ledger.startedAt), end = Date.parse(ledger.finishedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < BOARD_SOAK_REQUIREMENTS.durationMs
      || ledger.durationMs !== end - start || !hashPattern.test(ledger.finalStateHash)
      || !Number.isSafeInteger(ledger.clients) || ledger.clients < BOARD_SOAK_REQUIREMENTS.clients
      || !Number.isSafeInteger(ledger.writers) || ledger.writers < BOARD_SOAK_REQUIREMENTS.writers || ledger.writers > ledger.clients) return false;
    const clients = new Map<string, BoardSoakSample[]>();
    let chain = digest(`${ledger.sha}:${ledger.startedAt}`), previousAt = start;
    for (const sample of ledger.samples) {
      const at = Date.parse(sample.at), history = clients.get(sample.clientId) ?? [];
      if (!sample.clientId || typeof sample.writer !== 'boolean' || sample.connected !== true
        || !Number.isFinite(at) || at < previousAt || at > end || !hashPattern.test(sample.stateHash)
        || !Number.isSafeInteger(sample.revision) || sample.revision < 0
        || !Number.isFinite(sample.latencyMs) || sample.latencyMs < 0
        || history.some(prior => prior.writer !== sample.writer)
        || (history.length && sample.revision < history.at(-1)!.revision)) return false;
      previousAt = at;
      const {chainHash, ...body} = sample;
      chain = nextBoardChain(chain, body);
      if (chain !== chainHash) return false;
      history.push(sample); clients.set(sample.clientId, history);
    }
    const writers = [...clients].filter(([, samples]) => samples[0]!.writer).map(([id]) => id);
    if (clients.size !== ledger.clients || writers.length !== ledger.writers) return false;
    for (const history of clients.values()) {
      if (!coversWindow(history.map(sample => Date.parse(sample.at)), start, end, BOARD_SOAK_REQUIREMENTS.maxSampleGapMs)
        || history.at(-1)!.stateHash !== ledger.finalStateHash) return false;
    }
    const operations = new Set<string>(), revisions = new Set<number>(), writerTimes = new Map<string, number[]>();
    let previousAck = start;
    for (const ack of ledger.acknowledgements) {
      const at = Date.parse(ack.acknowledgedAt);
      if (!validAck(ack, start, end) || !writers.includes(ack.actorId) || operations.has(ack.operationId)
        || revisions.has(ack.revision) || at < previousAck) return false;
      previousAck = at; operations.add(ack.operationId); revisions.add(ack.revision);
      const times = writerTimes.get(ack.actorId) ?? []; times.push(at); writerTimes.set(ack.actorId, times);
    }
    if (writerTimes.size !== ledger.writers) return false;
    for (const times of writerTimes.values()) if (!coversWindow(times, start, end, BOARD_SOAK_REQUIREMENTS.maxWriterAckGapMs)) return false;
    const maxRevision = Math.max(...revisions);
    if ([...clients.values()].some(history => history.at(-1)!.revision !== maxRevision)) return false;
    const sortedRevisions = [...revisions].sort((a, b) => a - b);
    if (sortedRevisions.some((revision, i) => i > 0 && revision !== sortedRevisions[i - 1]! + 1)) return false;
    const latencies = ledger.samples.map(sample => sample.latencyMs).sort((a, b) => a - b);
    const p95 = latencies[Math.ceil(latencies.length * .95) - 1]!;
    return p95 === ledger.convergenceP95Ms && p95 <= BOARD_SOAK_REQUIREMENTS.convergenceP95Ms;
  } catch { return false; }
}

export type BoardRecoveryEvent = {
  at: string; type: 'ack' | 'revoke' | 'rejected' | 'disconnect' | 'blob-corrupt' | 'restore' | 'converged';
  actorId: string; revision: number; stateHash: string; operationId?: string; status?: number;
};
export type BoardRecoveryLedger = {
  version: 2; sha: string; buildSha: string; events: BoardRecoveryEvent[];
  acknowledgements: BoardAck[]; acknowledgedRevisions: number[];
  restoredOperations: Array<{operationId: string; revision: number; stateHash: string}>;
  restoredRevision: number; finalStateHash: string; signature: string;
};
export function signBoardRecoveryLedger(body: Omit<BoardRecoveryLedger, 'signature'>, key: string): BoardRecoveryLedger { return sign(body, key); }
export function verifyBoardRecoveryLedger(ledger: BoardRecoveryLedger, key: string): boolean {
  try {
    if (!authentic(ledger, key) || ledger.version !== 2 || !shaPattern.test(ledger.sha) || ledger.buildSha !== ledger.sha
      || !ledger.acknowledgements.length || !hashPattern.test(ledger.finalStateHash)) return false;
    let previous = -Infinity, corruptAt = -1, restoreAt = -1;
    let restoreEvent: BoardRecoveryEvent | undefined;
    const revoked = new Set<string>(), rejected = new Set<string>(), recorded = new Map<string, BoardRecoveryEvent>();
    for (const event of ledger.events) {
      const at = Date.parse(event.at);
      if (!['ack', 'revoke', 'rejected', 'disconnect', 'blob-corrupt', 'restore', 'converged'].includes(event.type)
        || !Number.isFinite(at) || at < previous || !event.actorId || !hashPattern.test(event.stateHash)
        || !Number.isSafeInteger(event.revision) || event.revision < 0) return false;
      previous = at;
      if (event.type === 'revoke') revoked.add(event.actorId);
      if (event.type === 'rejected') {
        if (!revoked.has(event.actorId) || !event.operationId || event.status !== 403) return false;
        rejected.add(event.actorId);
      }
      if (event.type === 'ack') {
        if (revoked.has(event.actorId) || !event.operationId || recorded.has(event.operationId)) return false;
        recorded.set(event.operationId, event);
      }
      if (event.type === 'blob-corrupt') corruptAt = at;
      if (event.type === 'restore') { if (corruptAt < 0 || at <= corruptAt) return false; restoreAt = at; restoreEvent = event; }
    }
    if (!revoked.size || [...revoked].some(actor => !rejected.has(actor)) || corruptAt < 0 || restoreAt <= corruptAt) return false;
    const start = Date.parse(ledger.events[0]!.at), end = Date.parse(ledger.events.at(-1)!.at);
    const acks = ledger.acknowledgements;
    if (recorded.size !== acks.length || new Set(acks.map(ack => ack.operationId)).size !== acks.length
      || new Set(acks.map(ack => ack.revision)).size !== acks.length) return false;
    for (const ack of acks) {
      const event = recorded.get(ack.operationId);
      if (!validAck(ack, start, end) || !event || event.actorId !== ack.actorId || event.revision !== ack.revision
        || event.stateHash !== ack.stateHash || event.at !== ack.acknowledgedAt) return false;
    }
    const revisions = acks.map(ack => ack.revision).sort((a, b) => a - b);
    if (canonical([...ledger.acknowledgedRevisions].sort((a, b) => a - b)) !== canonical(revisions)
      || ledger.restoredOperations.length !== acks.length) return false;
    const restored = new Map(ledger.restoredOperations.map(op => [op.operationId, op]));
    if (restored.size !== acks.length || acks.some(ack => restored.get(ack.operationId)?.revision !== ack.revision
      || restored.get(ack.operationId)?.stateHash !== ack.stateHash)) return false;
    const lastAck = revisions.at(-1)!, final = ledger.events.at(-1)!;
    return Number.isSafeInteger(ledger.restoredRevision) && ledger.restoredRevision >= lastAck
      && final.type === 'converged' && end > restoreAt && final.revision === ledger.restoredRevision
      && final.stateHash === ledger.finalStateHash && restoreEvent?.stateHash === ledger.finalStateHash
      && restoreEvent.revision === ledger.restoredRevision;
  } catch { return false; }
}
