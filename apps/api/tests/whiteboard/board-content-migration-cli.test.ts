import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { BoardContentMigrationReport } from '../../src/application/whiteboard/migrate-board-content';
import { runBoardContentMigrationCli } from '../../scripts/migrate-board-content';

const ids = ['org-cli', '0199aabb-ccdd-7eef-8abc-0123456789ab', '0199aabb-ccdd-7eef-8abc-012345678901'];
const argv = ['--tenant-id', ids[0]!, '--board-id', ids[1]!, '--job-id', ids[2]!];
const report = (state: BoardContentMigrationReport['state']): BoardContentMigrationReport => ({ jobId: ids[2]!, state, sourceEpoch: 2, sourceHeadSeq: 9, candidateManifestDigest: 'a'.repeat(64), cleanupThroughSeq: state === 'completed' ? 9 : 0, attempts: 1, errorCode: null, cutoverAt: state === 'cutover' ? new Date(0).toISOString() : null, retirementNotBefore: null, retirementProofDigest: null });

describe('Board content migration operator CLI', () => {
  it('requires explicit identities and exits non-zero with structured metadata', async () => {
    const errors: string[] = [];
    const code = await runBoardContentMigrationCli([], { step: async () => report('completed') }, { out: () => {}, err: value => errors.push(value) });
    expect(code).toBe(2);
    expect(errors.map(value => JSON.parse(value) as unknown)).toEqual([{ ok: false, errorCode: 'INVALID_ARGUMENTS' }]);
  });

  it('loops through resumable phases and emits metadata-only JSON', async () => {
    const states: BoardContentMigrationReport['state'][] = ['candidate_ready', 'verified', 'cutover', 'cleaning', 'completed'];
    const output: string[] = [];
    const code = await runBoardContentMigrationCli(argv, { step: async () => report(states.shift()!) }, { out: value => output.push(value), err: () => {} });
    expect(code).toBe(0);
    expect(output.map(line => JSON.parse(line).state)).toEqual(['candidate_ready', 'verified', 'cutover']);
    expect(output.join('\n')).not.toMatch(/snapshot|update|manifestKey|plaintext|ciphertext|secret/i);
  });

  it('redacts internal failures and has no public HTTP trigger', async () => {
    const errors: string[] = [];
    const code = await runBoardContentMigrationCli(argv, { step: async () => { throw new Error('secret-key-and-board-content'); } }, { out: () => {}, err: value => errors.push(value) });
    expect(code).toBe(1);
    expect(errors).toEqual([JSON.stringify({ ok: false, errorCode: 'MIGRATION_FAILED' })]);
    const source = readFileSync(new URL('../../scripts/migrate-board-content.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/@Controller|\.listen\(|create\(KernelModule/);
    expect(source).not.toMatch(/String\(error\)|error\.message|console\./);
  });
});
