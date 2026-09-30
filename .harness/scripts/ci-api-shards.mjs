import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('../../', import.meta.url));
export function shardPlan(input) {
  if (input?.schemaVersion !== 1 || !Number.isInteger(input.count) || input.count < 1 || input.count > 32 || Object.keys(input).sort().join(',') !== 'count,schemaVersion') throw new Error('INVALID_SHARD_POLICY');
  return { count: input.count, shards: Array.from({length: input.count}, (_, i) => i + 1) };
}
export function assertCoverage(full, partitions) {
  if (!full.length || new Set(full).size !== full.length || !partitions.length) throw new Error('INVALID_FULL_DISCOVERY');
  const expected = new Set(full), seen = new Set();
  for (const files of partitions) {
    if (!files.length) throw new Error('EMPTY_SHARD');
    for (const file of files) {
      if (!expected.has(file)) throw new Error('UNEXPECTED_SHARD_FILE');
      if (seen.has(file)) throw new Error('DUPLICATE_SHARD_FILE');
      seen.add(file);
    }
  }
  if (seen.size !== expected.size) throw new Error('MISSING_SHARD_FILE');
  return { files: full.length, shards: partitions.length, counts: partitions.map(files => files.length),
    discoverySha256: createHash('sha256').update([...full].sort().join('\n')).digest('hex') };
}
export async function discoverCoverage(plan) {
  const config = readFileSync(resolve(root, 'apps/api/vitest.config.ts'), 'utf8');
  if (!/maxWorkers:\s*1\b/.test(config) || !/minWorkers:\s*1\b/.test(config) || /\b(?:sequencer|pool):/.test(config)) throw new Error('UNPROVEN_VITEST_SEQUENCE_OR_ISOLATION');
  const cwd = resolve(root, 'apps/api'), directory = mkdtempSync(resolve(tmpdir(), 'wsx-api-discovery-'));
  const discover = (shard) => {
    const output = resolve(directory, shard ? `shard-${shard}.json` : 'full.json');
    const args = [resolve(root, 'node_modules/vitest/vitest.mjs'), 'list', '--filesOnly', `--json=${output}`];
    if (shard) args.push(`--shard=${shard}/${plan.count}`);
    const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 30000 });
    if (result.error || result.status !== 0) throw new Error('VITEST_DISCOVERY_FAILED');
    const rows = JSON.parse(readFileSync(output, 'utf8'));
    if (!Array.isArray(rows)) throw new Error('INVALID_DISCOVERY_OUTPUT');
    return rows.map(row => { const file = relative(cwd, row.file); if (file.startsWith('..') || !file.endsWith('.test.ts')) throw new Error('INVALID_DISCOVERY_FILE'); return file; });
  };
  try {
    // Vitest 2 list --filesOnly bypasses sharding. Use its public, installed
    // sequencer on actual full discovery, rather than copying a hash algorithm.
    const full = discover();
    const { BaseSequencer } = await import('vitest/node');
    const specs = full.map(file => ({ moduleId: resolve(cwd, file) }));
    const partitions = [];
    for (const index of plan.shards) {
      const sequencer = new BaseSequencer({config:{root:cwd,shard:{index,count:plan.count}}});
      partitions.push((await sequencer.shard(specs)).map(spec => relative(cwd, spec.moduleId)));
    }
    return assertCoverage(full, partitions);
  }
  finally { rmSync(directory, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const plan = shardPlan(JSON.parse(readFileSync(resolve(root, '.harness/api-test-shards.json'), 'utf8')));
  if (process.argv[2] === '--plan' && process.argv.length === 3) {
    if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT_REQUIRED');
    writeFileSync(process.env.GITHUB_OUTPUT, `count=${plan.count}\nshards=${JSON.stringify(plan.shards)}\n`, { flag: 'a' });
  } else if (process.argv[2] === '--verify' && process.argv.length === 3) {
    console.log(JSON.stringify({schemaVersion:1, status:'discovery-coverage-verified', ...await discoverCoverage(plan)}));
  } else throw new Error('INVALID_SHARD_COMMAND');
}
