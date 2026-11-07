import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {aggregateFailures,CURRENT_POLICY} from './lib/ci-check-policy.mjs';

/** A skip is valid only for the unselected API matrix, never as a passing test. */
export function backendFailures(results, sourceSha, baseSha, policy=CURRENT_POLICY) {
  const failed = new Set(aggregateFailures('backend-required', results, policy));
  const planner = results?.['api-test-plan'];
  const proof = planner?.outputs;
  const validSha = value => /^[a-f0-9]{40}$/.test(value ?? '') && !/^0+$/.test(value);
  if (planner?.result !== 'success' || !['full', 'targeted-ui'].includes(proof?.mode) ||
      !/^[a-f0-9]{64}$/.test(proof?.plan_digest ?? '') ||
      !validSha(sourceSha) || !validSha(baseSha) ||
      proof?.source_sha !== sourceSha || proof?.base_sha !== baseSha) {
    failed.add('api-test-plan');
  } else if (proof.mode === 'targeted-ui') {
    if (results?.['gates-test']?.result === 'skipped') failed.delete('gates-test');
    else failed.add('gates-test');
  }
  return [...failed];
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const results = JSON.parse(process.env.CI_BACKEND_RESULTS ?? 'null');
    const failed = backendFailures(results, process.env.CI_SOURCE_SHA, process.env.CI_SCOPE_BASE_SHA);
    if (failed.length) {
      console.error(`Backend verification is not complete and successful: ${failed.join(', ')}`);
      process.exitCode = 1;
    } else {
      console.log(`Backend route: ${results['api-test-plan'].outputs.mode}; unrelated API matrix: ${results['gates-test'].result}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
