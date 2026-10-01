import {describe, expect, it} from 'vitest';
import {signBoardRecoveryLedger, verifyBoardRecoveryLedger, type BoardRecoveryLedger} from '../../scripts/board-acceptance-ledger';
const key = 'r'.repeat(32), hash = 'b'.repeat(64), sha = 'a'.repeat(40);
function fixture(): Omit<BoardRecoveryLedger, 'signature'> {
  return {version: 2, sha, buildSha: sha,
    events: [
      {at: '2026-09-27T00:00:00Z', type: 'ack', actorId: 'writer', operationId: 'op-7', revision: 7, stateHash: hash},
      {at: '2026-09-27T00:00:01Z', type: 'revoke', actorId: 'writer', revision: 7, stateHash: hash},
      {at: '2026-09-27T00:00:02Z', type: 'rejected', actorId: 'writer', operationId: 'op-8', status: 403, revision: 7, stateHash: hash},
      {at: '2026-09-27T00:00:03Z', type: 'blob-corrupt', actorId: 'system', revision: 7, stateHash: hash},
      {at: '2026-09-27T00:00:04Z', type: 'restore', actorId: 'system', revision: 7, stateHash: hash},
      {at: '2026-09-27T00:00:05Z', type: 'converged', actorId: 'reader', revision: 7, stateHash: hash},
    ], acknowledgements: [{operationId: 'op-7', actorId: 'writer', revision: 7, stateHash: hash, sentAt: '2026-09-27T00:00:00Z', acknowledgedAt: '2026-09-27T00:00:00Z'}],
    acknowledgedRevisions: [7], restoredRevision: 7, finalStateHash: hash,
    restoredOperations: [{operationId: 'op-7', revision: 7, stateHash: hash}]};
}
describe('recovery structural validator ONLY, no runtime proof', () => {
  it('accepts internally consistent synthetic evidence', () => expect(verifyBoardRecoveryLedger(signBoardRecoveryLedger(fixture(), key), key)).toBe(true));
  it.each([
    ['missing ACK event', (body: ReturnType<typeof fixture>) => {body.events = body.events.filter(event => event.type !== 'ack');}],
    ['missing restored operation', (body: ReturnType<typeof fixture>) => {body.restoredOperations = [];}],
    ['wrong restored content', (body: ReturnType<typeof fixture>) => {body.restoredOperations[0]!.stateHash = 'c'.repeat(64);}],
    ['missing rejection', (body: ReturnType<typeof fixture>) => {body.events = body.events.filter(event => event.type !== 'rejected');}],
    ['ACK after revoke', (body: ReturnType<typeof fixture>) => {body.events[2]!.type = 'ack';}],
    ['unlisted ACK revision', (body: ReturnType<typeof fixture>) => {body.acknowledgedRevisions = [6];}],
    ['invalid date', (body: ReturnType<typeof fixture>) => {body.events[1]!.at = 'invalid';}],
    ['wrong build', (body: ReturnType<typeof fixture>) => {body.buildSha = 'c'.repeat(40);}],
  ])('rejects re-signed invalid data: %s', (_, mutate) => {
    const body = fixture(); mutate(body); expect(verifyBoardRecoveryLedger(signBoardRecoveryLedger(body, key), key)).toBe(false);
  });
});
