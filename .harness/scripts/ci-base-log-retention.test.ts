import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';
import { expect, it } from 'vitest';

const lane = parse(readFileSync('.github/workflows/harness-verify.yml', 'utf8')).jobs['full-regression-core'];

it('retains unfinished package logs after a failed or timed-out base step, without requiring any log', () => {
  const collect = lane.steps.find((step: { name?: string }) => step.name === 'Collect base task logs (success or failure)');
  expect(collect).toBeDefined();
  expect(collect.if).toBe("always() && steps.dedup.outputs.run == 'true'");
  const root = mkdtempSync(join(tmpdir(), 'wsx-base-logs-'));
  try {
    for (const file of ['apps/api/.turbo/turbo-test.log', 'packages/nested/a package/.turbo/turbo-test.log', 'apps/api/node_modules/ignored/.turbo/turbo-test.log']) {
      mkdirSync(join(root, file, '..'), { recursive: true });
      writeFileSync(join(root, file), 'test still running before runner timeout\n');
    }
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', collect.run], { cwd: root, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    const evidence = join(root, 'phases/phase-01-run-a-project/evidence/ci/task-logs');
    expect(readFileSync(join(evidence, 'apps/api/test.log'), 'utf8')).toContain('test still running');
    expect(readFileSync(join(evidence, 'packages/nested/a package/test.log'), 'utf8')).toContain('test still running');
    expect(existsSync(join(evidence, 'apps/api/node_modules'))).toBe(false);
    rmSync(join(root, 'apps'), { recursive: true });
    rmSync(join(root, 'packages'), { recursive: true });
    expect(spawnSync('bash', ['-e', '-o', 'pipefail', '-c', collect.run], { cwd: root }).status).toBe(0);
    const upload = lane.steps.find((step: { uses?: string }) => step.uses?.startsWith('actions/upload-artifact@'));
    expect(upload.with.path).toContain('phases/phase-01-run-a-project/evidence/ci/');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
