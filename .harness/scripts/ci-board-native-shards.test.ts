import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { NATIVE_SHARDS, verifyNativeShardResults } from './ci-board-native-shards.mjs';

const sha = 'a'.repeat(40), runId = '123';
const success = () => ({ batch: { result: 'success', outputs: { sha, run: 'true' } },
  ...Object.fromEntries(NATIVE_SHARDS.map((name: string) => [`native-${name}`,
    { result: 'success', outputs: { artifact: `board-native-shard-${name}-${runId}-1` } }])) });

describe('parallel native acceptance preserves complete measurement', () => {
  it('requires every source-bound producer and its exact same-run artifact', () => {
    expect(verifyNativeShardResults(success(), sha, runId)).toBe(true);
  });
  it.each(['failure', 'skipped', 'cancelled', undefined])('rejects %s from any shard', result => {
    for (const name of NATIVE_SHARDS) expect(() => verifyNativeShardResults({ ...success(), [`native-${name}`]: { result } }, sha, runId)).toThrow();
  });
  it('rejects source drift, missing producer identity and artifacts from a different run', () => {
    expect(() => verifyNativeShardResults(success(), 'b'.repeat(40), runId)).toThrow();
    expect(() => verifyNativeShardResults(success(), sha, '124')).toThrow();
    expect(() => verifyNativeShardResults(null, sha, runId)).toThrow();
    expect(() => verifyNativeShardResults({ ...success(), batch: { result: 'success', outputs: { sha, run: 'false' } } }, sha, runId)).toThrow();
  });
  it('actual workflow runs four complete suites independently and aggregates them', () => {
    const w = parse(readFileSync(new URL('../../.github/workflows/board-native-acceptance.yml', import.meta.url), 'utf8'));
    expect(w.jobs['native-board'].needs).toEqual(['batch', ...NATIVE_SHARDS.map((name: string) => `native-${name}`)]);
    expect(w.jobs['native-board'].if).toContain('always()');
    const guard = w.jobs['native-board'].steps[0];
    expect(guard.name).toBe('Require successful batch admission');
    expect(guard.if).toBeUndefined();
    for (const [result, run, expected] of [['success', 'true', 0], ['success', 'false', 0], ['failure', '', 1], ['success', '', 1], ['cancelled', 'true', 1]]) {
      const checked = spawnSync('bash', ['-c', guard.run], { env: { ...process.env, BATCH_RESULT: result, BATCH_RUN: run } });
      expect(checked.status).toBe(expected);
    }
    for (const name of NATIVE_SHARDS) {
      const j = w.jobs[`native-${name}`];
      expect(j.needs).toBe('batch'); expect(j['runs-on']).toBe('ubuntu-latest');
      expect(j['continue-on-error']).toBeUndefined();
      expect(j.steps.filter((s: { run?: string }) => s.run?.includes('node apps/web/scripts/run-board-native-acceptance.mjs --'))).toHaveLength(1);
      expect(j.outputs.artifact).toBe('${{ steps.publish.outputs.artifact }}');
      const directory = mkdtempSync(join(tmpdir(), 'native-publish-'));
      try {
        const output = join(directory, 'output');
        const published = spawnSync('bash', ['-c', j.steps.find((s: { id?: string }) => s.id === 'publish').run], {
          env: { ...process.env, GITHUB_OUTPUT: output, GITHUB_RUN_ID: runId, GITHUB_RUN_ATTEMPT: '2' }, encoding: 'utf8',
        });
        expect(published.status).toBe(0);
        expect(readFileSync(output, 'utf8')).toBe(`artifact=board-native-shard-${name}-${runId}-2\n`);
      } finally { rmSync(directory, { recursive: true, force: true }); }
    }
    const downloads = w.jobs['native-board'].steps.filter((s: { uses?: string }) => s.uses?.startsWith('actions/download-artifact@'));
    expect(downloads).toHaveLength(4);
    for (const name of NATIVE_SHARDS) expect(downloads.some((s: { with: { name: string } }) => s.with.name === '${{ needs.native-' + name + '.outputs.artifact }}')).toBe(true);
  });
});
