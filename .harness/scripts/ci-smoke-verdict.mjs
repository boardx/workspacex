/** Report actual smoke execution, independently of the informational PR job conclusion. */
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const SMOKE_STEPS = ['directory', 'smoke', 'sticky', 'geometry', 'evidence'];

export function smokeVerdict({ run, sourceResult, steps }) {
  if (run === 'false') {
    return steps?.dedup?.outcome === 'success' && sourceResult === 'success' ? 'success' : 'failure';
  }
  return run === 'true' && SMOKE_STEPS.every(name => steps?.[name]?.outcome === 'success')
    ? 'success' : 'failure';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const verdict = smokeVerdict({
      run: process.env.CI_SMOKE_RUN,
      sourceResult: process.env.CI_SMOKE_SOURCE_RESULT,
      steps: JSON.parse(process.env.CI_SMOKE_STEPS ?? 'null'),
    });
    if (!process.env.GITHUB_OUTPUT) throw new Error('Missing verdict output destination');
    appendFileSync(process.env.GITHUB_OUTPUT, `verdict=${verdict}\n`);
    console.log(`Actual smoke verdict: ${verdict}`);
  } catch {
    console.error('Cannot establish actual smoke verdict');
    process.exitCode = 1;
  }
}
