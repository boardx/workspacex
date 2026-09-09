/** Aggregate only the required full regression lanes; never equate skipped with passed. */
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { LANES } from './ci-lane-dedup.mjs';

export const FULL_REGRESSION_LANES = Object.keys(LANES).filter(name => LANES[name].fullRegression);

export function failedLanes(results) {
  return FULL_REGRESSION_LANES.filter(name => results?.[name]?.result !== 'success');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const results = JSON.parse(process.env.CI_LANE_RESULTS ?? 'null');
    const failed = failedLanes(results);
    const summary = FULL_REGRESSION_LANES.map(name => `- ${name}: ${results?.[name]?.result ?? 'missing'}`).join('\n');
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Full regression\n\n${summary}\n`);
    if (failed.length) process.exitCode = 1;
  } catch (error) {
    console.error(`Cannot validate full regression: ${error.message}`);
    process.exitCode = 1;
  }
}
