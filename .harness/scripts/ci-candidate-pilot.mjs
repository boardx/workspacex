/** Main-owned controller entry point. Candidate output is retained as data, never printed. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runCandidatePilot } from './lib/ci-candidate-pilot.mjs';

export async function pilotMain(argv = process.argv.slice(2)) {
  const options = {};
  if (argv.length !== 8) throw new Error('usage: --repository PATH --sha SHA --policy PATH --output NEW_DIRECTORY');
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!['--repository', '--sha', '--policy', '--output'].includes(key) || options[key] || !argv[index + 1]) throw new Error('invalid pilot arguments');
    options[key] = argv[index + 1];
  }
  const receipt = await runCandidatePilot({ repositoryRoot: resolve(options['--repository']), candidateSha: options['--sha'],
    outputDirectory: resolve(options['--output']), policy: JSON.parse(readFileSync(resolve(options['--policy']), 'utf8')) });
  console.log(JSON.stringify({ suite: receipt.suite, scope: receipt.scope, suiteExecuted: receipt.suiteExecuted, executionSuccessful: receipt.executionSuccessful,
    measurementComplete: receipt.measurementComplete, proofComplete: receipt.proofComplete, runFull: true, skip: false, verified: false, blockers: receipt.blockers, receiptFingerprint: receipt.receiptFingerprint }));
  return receipt;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  pilotMain().then(receipt => { if (!receipt.executionSuccessful || !receipt.measurementComplete) process.exitCode = 1; })
    .catch(error => { console.error(`Candidate pilot did not complete: ${error.message}`); process.exitCode = 1; });
}
