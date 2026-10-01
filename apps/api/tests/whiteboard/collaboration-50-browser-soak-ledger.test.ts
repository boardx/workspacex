import {createHash} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import {nextBoardChain, signBoardSoakLedger, verifyBoardSoakLedger, type BoardSoakLedger} from '../../scripts/board-acceptance-ledger';
const key = 'k'.repeat(32), sha = 'a'.repeat(40), hash = 'b'.repeat(64);
/** Synthetic UNIT fixture. This file must never be used as a real soak acceptance lane. */
function fixture(): Omit<BoardSoakLedger, 'signature'> {
  const start = Date.parse('2026-09-27T00:00:00Z'), stamp = (ms: number) => new Date(start + ms).toISOString();
  const ledger: Omit<BoardSoakLedger, 'signature'> = {version: 2, sha, buildSha: sha,
    startedAt: stamp(0), finishedAt: stamp(1_800_000), durationMs: 1_800_000,
    clients: 50, writers: 20, convergenceP95Ms: 100, finalStateHash: hash, samples: [], acknowledgements: []};
  let revision = 0;
  for (let elapsed = 0; elapsed <= 1_800_000; elapsed += 30_000) {
    for (let writer = 0; writer < 20; writer++) ledger.acknowledgements.push({operationId: `operation-${++revision}`, actorId: `client-${writer}`, revision, stateHash: hash, sentAt: stamp(elapsed), acknowledgedAt: stamp(elapsed)});
    for (let client = 0; client < 50; client++) ledger.samples.push({at: stamp(elapsed), clientId: `client-${client}`, writer: client < 20, connected: true, revision, stateHash: hash, latencyMs: 100, chainHash: ''});
  }
  return ledger;
}
function seal(body: Omit<BoardSoakLedger, 'signature'>) {
  let chain = createHash('sha256').update(`${body.sha}:${body.startedAt}`).digest('hex');
  for (const sample of body.samples) { const {chainHash: _, ...value} = sample; chain = nextBoardChain(chain, value); sample.chainHash = chain; }
  return signBoardSoakLedger(body, key);
}
describe('soak ledger structural validator ONLY (not a runtime acceptance)', () => {
  it('validates a complete synthetic structure', () => expect(verifyBoardSoakLedger(seal(fixture()), key)).toBe(true));
  it.each([
    ['end-only samples', (body: ReturnType<typeof fixture>) => {body.samples = body.samples.filter(sample => sample.at === body.finishedAt);}],
    ['sampling gap', (body: ReturnType<typeof fixture>) => {body.samples = body.samples.filter(sample => sample.at !== '2026-09-27T00:10:00.000Z');}],
    ['inactive writer', (body: ReturnType<typeof fixture>) => {body.acknowledgements = body.acknowledgements.filter(ack => ack.actorId !== 'client-0');}],
    ['forged p95', (body: ReturnType<typeof fixture>) => {body.convergenceP95Ms = 1;}],
    ['slow observations', (body: ReturnType<typeof fixture>) => {body.samples.forEach(sample => {sample.latencyMs = 301;}); body.convergenceP95Ms = 301;}],
    ['duplicate ACK', (body: ReturnType<typeof fixture>) => {body.acknowledgements[1] = body.acknowledgements[0]!;}],
    ['invalid end', (body: ReturnType<typeof fixture>) => {body.finishedAt = 'invalid';}],
    ['duration mismatch', (body: ReturnType<typeof fixture>) => {body.durationMs++;}],
    ['build mismatch', (body: ReturnType<typeof fixture>) => {body.buildSha = 'c'.repeat(40);}],
    ['disconnected', (body: ReturnType<typeof fixture>) => {body.samples[0]!.connected = false;}],
  ])('rejects re-signed invalid data: %s', (_, mutate) => {
    const body = fixture(); mutate(body); expect(verifyBoardSoakLedger(seal(body), key)).toBe(false);
  });
});
