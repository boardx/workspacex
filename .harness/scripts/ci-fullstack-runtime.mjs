/** #4842: exact web Playwright dependencies, without per-run APT installation. */
import { createRequire } from 'node:module';
import { realpathSync, readFileSync, mkdirSync, writeFileSync, chmodSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function sealedImage(version, catalog) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('UNSUPPORTED_PLAYWRIGHT_VERSION');
  const digest = catalog?.schemaVersion === 1 && catalog.images?.[version]?.['linux/amd64'];
  if (!/^sha256:[a-f0-9]{64}$/.test(digest ?? '')) throw new Error('PLAYWRIGHT_IMAGE_NOT_REVIEWED');
  return `mcr.microsoft.com/playwright@${digest}`;
}

export function runtimeArgs({ root, home, tools, uid, gid, image, node, pnpm, docker, compose, socketGid, env, geometry = false }) {
  if (![uid, gid].every(v => Number.isInteger(v) && v >= 0)) throw new Error('INVALID_RUNTIME_IDENTITY');
  if (!/^mcr\.microsoft\.com\/playwright@sha256:[a-f0-9]{64}$/.test(image)) throw new Error('UNSEALED_RUNTIME_IMAGE');
  if (!Number.isInteger(socketGid) || socketGid < 0) throw new Error('INVALID_DOCKER_SOCKET_GROUP');
  const args = ['run', '--rm', '--init', '--network', 'host', '--ipc', 'host', '--user', `${uid}:${gid}`,
    '--group-add', String(socketGid), '--workdir', root, '--volume', `${root}:${root}`, '--volume', `${home}:${home}`,
    '--volume', `${tools}:/wsx-ci-tools:ro`, '--volume', `${node}:/wsx-ci-tools/bin/node:ro`,
    '--volume', `${pnpm}:/wsx-ci-tools/pnpm:ro`, '--volume', `${docker}:/wsx-ci-tools/bin/docker:ro`,
    '--volume', `${compose}:/wsx-ci-tools/docker-config/cli-plugins/docker-compose:ro`,
    '--volume', '/var/run/docker.sock:/var/run/docker.sock', '--volume', `${tools}/bin/apt-get:/usr/bin/apt-get:ro`, '--volume', `${tools}/bin/apt-get:/usr/bin/apt:ro`,
    '--env', `HOME=${home}`, '--env', 'PATH=/wsx-ci-tools/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    '--env', 'DOCKER_CONFIG=/wsx-ci-tools/docker-config', '--env', 'PLAYWRIGHT_BROWSERS_PATH=/ms-playwright'];
  // Do not pass arbitrary runner env: GitHub credentials never enter the test container.
  for (const key of ['CI', 'GITHUB_SHA', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'FULLSTACK_E2E_SERVER_TIMEOUT_MS']) {
    if (env[key]) args.push('--env', `${key}=${env[key]}`);
  }
  args.push(image, 'bash', '-euc',
    'docker version >/dev/null; docker compose version; if apt-get --version >/dev/null 2>&1; then exit 78; fi; node .harness/scripts/ci-fullstack-runtime.mjs browser; exec ' + (geometry ? 'pnpm --filter web run e2e:trace-geometry' : 'pnpm run verify:fullstack-smoke')); 
  return args;
}

function command(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 120_000, ...options });
  if (r.error || r.status !== 0) throw new Error(`CI_RUNTIME_COMMAND_FAILED:${cmd}`);
  return r.stdout?.trim() ?? '';
}

async function main(mode) {
  const root = realpathSync(process.cwd());
  const req = createRequire(resolve(root, 'apps/web/package.json'));
  const version = req('@playwright/test/package.json').version;
  if (req('playwright-core/package.json').version !== version) throw new Error('PLAYWRIGHT_VERSION_MISMATCH');
  if (mode === 'browser') {
    const blockedApt = spawnSync('apt-get', ['--version'], { timeout: 5000, stdio: 'ignore' });
    if (blockedApt.error || blockedApt.status !== 78) throw new Error('APT_NOT_BLOCKED');
    const browser = await req('playwright-core').chromium.launch({ headless: true });
    try { const page = await browser.newPage(); await page.setContent('<p>runtime-ready</p>');
      if (await page.textContent('p') !== 'runtime-ready') throw new Error('BROWSER_PROBE_FAILED');
      console.log(JSON.stringify({ browserReady: true, playwrightVersion: version, aptBlocked: true }));
    } finally { await browser.close(); }
    return;
  }
  if (!['run', 'geometry'].includes(mode) || process.platform !== 'linux' || process.arch !== 'x64') throw new Error('LINUX_AMD64_RUNNER_REQUIRED');
  const catalog = JSON.parse(readFileSync(new URL('../playwright-runtime-images.json', import.meta.url), 'utf8'));
  const image = sealedImage(version, catalog);
  command('docker', ['pull', '--platform', 'linux/amd64', image], { stdio: 'inherit' });
  const which = name => realpathSync(command('which', [name]));
  const docker = which('docker');
  const plugins = JSON.parse(command(docker, ['info', '--format', '{{json .ClientInfo.Plugins}}']));
  const compose = realpathSync(plugins.find(p => p.Name === 'compose')?.Path ?? '');
  const pnpm = dirname(dirname(which('pnpm')));
  if (!process.env.RUNNER_TEMP) throw new Error('RUNNER_TEMP_REQUIRED');
  const home = resolve(process.env.RUNNER_TEMP, 'wsx-smoke-runtime-home');
  const tools = resolve(process.env.RUNNER_TEMP, 'wsx-smoke-runtime-tools');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  mkdirSync(resolve(tools, 'bin'), { recursive: true, mode: 0o700 });
  mkdirSync(resolve(tools, 'docker-config/cli-plugins'), { recursive: true, mode: 0o700 });
  writeFileSync(resolve(tools, 'bin/pnpm'), '#!/bin/sh\nexec node /wsx-ci-tools/pnpm/bin/pnpm.cjs "$@"\n', { mode: 0o700 });
  chmodSync(resolve(tools, 'bin/pnpm'), 0o700);
  writeFileSync(resolve(tools, 'bin/apt-get'), '#!/bin/sh\nexit 78\n', { mode: 0o700 });
  for (const path of ['bin/node', 'bin/docker', 'docker-config/cli-plugins/docker-compose']) writeFileSync(resolve(tools, path), '', { mode: 0o600 });
  console.log(JSON.stringify({ runtimeImage: image, playwrightVersion: version, network: 'host', uid: process.getuid(), aptInstall: false }));
  const args = runtimeArgs({ root, home, tools, uid: process.getuid(), gid: process.getgid(), image,
    node: realpathSync(process.execPath), pnpm, docker, compose, socketGid: statSync('/var/run/docker.sock').gid, env: process.env, geometry: mode === 'geometry' });
  const child = spawn(docker, args, { stdio: 'inherit' });
  const forward = signal => child.kill(signal);
  const term = () => forward('SIGTERM');
  const interrupt = () => forward('SIGINT');
  process.once('SIGTERM', term); process.once('SIGINT', interrupt);
  try { process.exitCode = await new Promise((done, reject) => {
    child.once('error', () => reject(new Error('CI_RUNTIME_EXEC_FAILED')));
    child.once('exit', (code, signal) => done(code ?? (signal ? 143 : 1)));
  }); } finally { process.removeListener('SIGTERM', term); process.removeListener('SIGINT', interrupt); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
}
