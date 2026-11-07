import { pathToFileURL } from 'node:url';
import { NATIVE_RECEIPTS } from './lib/board-native-receipts.mjs';

export const NATIVE_SHARDS = ['r01', ...Object.keys(NATIVE_RECEIPTS)];

export function verifyNativeShardResults(results, sha, runId) {
  if (!/^[a-f0-9]{40}$/.test(sha ?? '') || !/^[1-9]\d*$/.test(runId ?? '') ||
      results?.batch?.result !== 'success' || results.batch.outputs?.sha !== sha ||
      results.batch.outputs?.run !== 'true') throw new Error('INVALID_NATIVE_BATCH');
  for (const shard of NATIVE_SHARDS) {
    const result = results?.[`native-${shard}`];
    if (result?.result !== 'success' ||
        !new RegExp(`^board-native-shard-${shard}-${runId}-[1-9]\\d*$`).test(result.outputs?.artifact ?? '')) {
      throw new Error(`NATIVE_SHARD_NOT_PASSED: ${shard}`);
    }
  }
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    verifyNativeShardResults(JSON.parse(process.env.CI_NATIVE_NEEDS ?? 'null'), process.env.EXPECTED_SHA, process.env.GITHUB_RUN_ID);
    console.log('All four complete native shard producers passed');
  } catch {
    console.error('NATIVE_SHARD_EVIDENCE_INVALID'); process.exitCode = 1;
  }
}
