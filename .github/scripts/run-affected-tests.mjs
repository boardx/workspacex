/** Prepare only dependencies required by the actual Turbo affected test plan. */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  coreCli = () => {
    // The pixel test imports playwright-core from web: use that exact installed package,
    // rather than a root/global Playwright CLI which could request another browser revision.
    const requireWeb = createRequire(join(cwd, 'apps/web/package.json'));
    return join(dirname(requireWeb.resolve('playwright-core/package.json')), 'cli.js');
  },
} = {}) {
  const run = (command, args, options) => execute(command, args, { cwd, env, ...options });
  const args = ['turbo', 'run', 'test', '--affected', ...(env.IS_FORK_PR === 'true' ? [] : ['--filter=!@repo/api'])];
  const raw = run('pnpm', [...args, '--dry=json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  const plan = JSON.parse(raw);
  if (selectsWebTest(plan) && exists(join(cwd, PIXEL_TEST))) {
    if (!env.PLAYWRIGHT_BROWSERS_PATH || !isAbsolute(env.PLAYWRIGHT_BROWSERS_PATH)) {
      throw new Error('Explicit absolute PLAYWRIGHT_BROWSERS_PATH required for web pixel tests');
    }
    run(process.execPath, [coreCli(), 'install', '--with-deps', '--only-shell', 'chromium'], { stdio: 'inherit' });
  }
  // CN's fixed 40s discover shares this runner with the full affected fanout.
  // Complete the selected package fresh before competing package tests start.
  const selectedCloud = plan.tasks.some(task => task.taskId === '@repo/cloud-deploy#test' &&
    typeof task.command === 'string' && task.command.length > 0 && task.command !== '<NONEXISTENT>');
  if (selectedCloud) {
    run('pnpm', ['turbo', 'run', 'test', '--filter=@repo/cloud-deploy', '--force'], { stdio: 'inherit' });
  }
  // Same base, fork filter and browser path; exclude only a package that just passed in full.
  run('pnpm', [...args, ...(selectedCloud ? ['--filter=!@repo/cloud-deploy'] : [])], { stdio: 'inherit' });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { runAffectedTests(); } catch (error) { console.error(error); process.exitCode = 1; }
}
