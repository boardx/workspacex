/** Prepare only dependencies required by the actual Turbo affected test plan. */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {planTargeted} from '../../.harness/scripts/ci-targeted-ui.mjs';
import {runUnit,runIdentity} from '../../.harness/scripts/ci-targeted-runner.mjs';

export const PIXEL_TEST = 'apps/web/tests/ui/board-drawing-stroke-path.test.ts';
export function selectsWebTest(plan) {
  if (!plan || !Array.isArray(plan.tasks)) throw new Error('Invalid Turbo affected test plan');
  return plan.tasks.some(task => task.taskId === 'web#test' &&
    typeof task.command === 'string' && task.command.length > 0 && task.command !== '<NONEXISTENT>');
}
export function runAffectedTests({
  cwd = process.cwd(), env = process.env,
  execute = (command, args, options) => {
    const result = spawnSync(command, args, { cwd, env, ...options });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} exited ${result.status ?? result.signal}`);
    return result.stdout;
  },
  exists = existsSync,
  targetedPlan = planTargeted, runSelectedUnit = runUnit,
  coreCli = () => {
    // The pixel test imports playwright-core from web: use that exact installed package,
    // rather than a root/global Playwright CLI which could request another browser revision.
    const requireWeb = createRequire(join(cwd, 'apps/web/package.json'));
    return join(dirname(requireWeb.resolve('playwright-core/package.json')), 'cli.js');
  },
} = {}) {
  const webShard = env.CI_AFFECTED_WEB_SHARD;
  if (webShard !== undefined && !/^[1-4]\/4$/.test(webShard)) throw new Error('INVALID_WEB_SHARD');
  const selected = targetedPlan({baseSha:env.CI_SCOPE_BASE_SHA,headSha:env.GITHUB_SHA,...(webShard && env.CI_AFFECTED_WEB_FORCE_FULL === 'true' ? {enabled:false} : {})});
  if(selected.mode==='targeted-ui'){
    if(!env.RUNNER_TEMP||!isAbsolute(env.RUNNER_TEMP))throw new Error('TARGETED_ARTIFACT_DIRECTORY_REQUIRED');
    runSelectedUnit(selected,join(env.RUNNER_TEMP,'targeted-ui-affected'),join(cwd,'apps/web'),runIdentity(env));
    return;
  }
  const webHandled = Object.hasOwn(env, 'CI_AFFECTED_WEB_SHARDS_RESULT');
  if (webHandled && env.CI_AFFECTED_WEB_SHARDS_RESULT !== 'success') throw new Error('WEB_SHARDS_NOT_SUCCESSFUL');
  const run = (command, args, options) => execute(command, args, { cwd, env, ...options });
  const args = ['turbo', 'run', 'test', '--affected', ...(env.IS_FORK_PR === 'true' ? [] : ['--filter=!@repo/api'])];
  const raw = run('pnpm', [...args, '--dry=json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  const plan = JSON.parse(raw);
  if (webShard && !selectsWebTest(plan)) return;
  if (!webHandled && selectsWebTest(plan) && exists(join(cwd, PIXEL_TEST))) {
    if (!env.PLAYWRIGHT_BROWSERS_PATH || !isAbsolute(env.PLAYWRIGHT_BROWSERS_PATH)) {
      throw new Error('Explicit absolute PLAYWRIGHT_BROWSERS_PATH required for web pixel tests');
    }
    if (env.CI_AFFECTED_BROWSER_PREINSTALLED === '1') {
      if (!webShard || env.PLAYWRIGHT_BROWSERS_PATH !== '/ms-playwright') throw new Error('INVALID_PREINSTALLED_BROWSER_SCOPE');
      // Launch the exact installed revision before tests. Missing libraries/browser fail;
      // no APT/network fallback can turn this into another unbounded preparation step.
      run(process.execPath, ['--input-type=module', '-e', "import {createRequire} from 'node:module'; const req=createRequire(process.cwd()+'/apps/web/package.json'); const browser=await req('playwright-core').chromium.launch(); await browser.close();"], { stdio: 'inherit' });
    } else {
      run(process.execPath, [coreCli(), 'install', '--with-deps', '--only-shell', 'chromium'], { stdio: 'inherit' });
    }
  }
  if (webShard) {
    // Keep Turbo's actual web task and ^build prerequisites; only partition Vitest files.
    run('pnpm', ['turbo', 'run', 'test', '--filter=web', '--', `--shard=${webShard}`, '--bail=1'], { stdio: 'inherit' });
    return;
  }
  // CN's fixed 40s discover shares this runner with the full affected fanout.
  // Complete the selected package fresh before competing package tests start.
  const selectedCloud = plan.tasks.some(task => task.taskId === '@repo/cloud-deploy#test' &&
    typeof task.command === 'string' && task.command.length > 0 && task.command !== '<NONEXISTENT>');
  if (selectedCloud) {
    run('pnpm', ['turbo', 'run', 'test', '--filter=@repo/cloud-deploy', '--force', '--', '--bail=1'], { stdio: 'inherit' });
  }
  // Same base, fork filter and browser path; exclude only a package that just passed in full.
  run('pnpm', [...args, ...(selectedCloud ? ['--filter=!@repo/cloud-deploy'] : []), ...(webHandled ? ['--filter=!web'] : []), '--', '--bail=1'], { stdio: 'inherit' });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { runAffectedTests(); } catch (error) { console.error(error); process.exitCode = 1; }
}
