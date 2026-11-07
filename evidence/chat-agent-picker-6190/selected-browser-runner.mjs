import { spawnSync } from 'node:child_process';
const args = ['--filter', 'web', 'exec', ...process.argv.slice(2)];
if (!args.includes('--workers=1')) throw new Error('Require exactly one worker');
console.log('[6190-exact-argv]', JSON.stringify(['pnpm', ...args]));
const listed = spawnSync('pnpm', [...args, '--list'], {env:process.env, encoding:'utf8'});
process.stdout.write(listed.stdout ?? ''); process.stderr.write(listed.stderr ?? '');
if (listed.status !== 0 || !/Total: 3 tests in 1 file/.test(listed.stdout ?? '')) {
  console.error('[6190-scope-rejected] No browser started'); process.exit(1);
}
console.log('[6190-scope-accepted] Same argv/env; only --list removed. Three cases, one file, one worker.');
const result = spawnSync('pnpm', args, {env:process.env, stdio:'inherit'});
process.exit(result.status ?? 1);
