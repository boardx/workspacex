import {describe, expect, it} from 'vitest';
import {BOARD_ACCEPTANCE_RUBRIC, evaluateBoardAcceptance, type BoardLaneEvidence} from '@/lib/board-acceptance-rubric';
const sha = 'a'.repeat(40);
const row = (lane: BoardLaneEvidence['lane']): BoardLaneEvidence => ({lane, sha, buildSha: sha, dirty: false, status: 'passed',
  command: `verify ${lane}`, startedAt: '2026-09-27T00:00:00Z', endedAt: '2026-09-27T00:01:00Z',
  exitCode: 0, environment: 'unit-fixture', artifactSha256: 'b'.repeat(64), counterproof: true});
describe('acceptance metadata never grants an experience score', () => {
  it('stays closed even for perfect-looking metadata until real producers are integrated', () => {
    const result = evaluateBoardAcceptance(sha, BOARD_ACCEPTANCE_RUBRIC.requiredLanes.map(row));
    expect(result).toMatchObject({approved: false, score: null, metadataValid: true});
    expect(result.failures).toContain('PRODUCER_NOT_INTEGRATED:meeting-room');
    expect(result.failures).toContain('PRODUCER_NOT_INTEGRATED:visual');
  });
  it('rejects duplicate, malformed dates, dirty trees and mismatched builds', () => {
    const rows = BOARD_ACCEPTANCE_RUBRIC.requiredLanes.map(row);
    rows[0]!.endedAt = 'invalid'; rows[1]!.dirty = true; rows[2]!.buildSha = 'c'.repeat(40);
    rows.push(row('visual'));
    const result = evaluateBoardAcceptance(sha, rows);
    expect(result.metadataValid).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining(['INVALID_TIME:journeys', 'IDENTITY_MISMATCH:performance-1k', 'IDENTITY_MISMATCH:performance-5k', 'DUPLICATE:visual']));
  });
});
