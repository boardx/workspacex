import { aggregateFailures } from './lib/ci-check-policy.mjs';
try {
  const results = JSON.parse(process.env.CI_BACKEND_RESULTS ?? 'null');
  const failed = aggregateFailures('backend-required', results);
  if (failed.length) {
    console.error(`Backend verification is not complete and successful: ${failed.join(', ')}`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
