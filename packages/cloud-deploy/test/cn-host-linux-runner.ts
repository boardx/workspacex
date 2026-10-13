import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdtempSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
const image = 'workspacex-cn-host-tests:node22';
let built = false;
/** Real Linux process/FD tests; no services, ports, credentials or host Docker socket. */
export function runLinuxHostFixture(root: string, command: string, args: string[], runtimeTimeoutMs = 90000) {
  if (!Number.isInteger(runtimeTimeoutMs) || runtimeTimeoutMs < 1 || runtimeTimeoutMs > 90000) throw new Error("CN_TEST_RUNTIME_BUDGET_INVALID");
  if (command !== process.execPath && command !== "python3") throw new Error("CN_TEST_COMMAND_INVALID");
  const mirror = process.env.CN_HOST_TEST_APT_MIRROR ?? "https://deb.debian.org";
  if (!["https://deb.debian.org", "https://mirrors.aliyun.com"].includes(mirror)) throw new Error("CN_TEST_APT_MIRROR_INVALID");
  const preparationDeadline = performance.now() + 180000;
  if (!built) {
    const build = spawnSync('docker', ['build', '--build-arg', `APT_MIRROR=${mirror}`, '-t', image, '-f', join(root, '.harness/docker/cn-host-test-runner.Dockerfile'), join(root, '.harness/docker')], { encoding: 'utf8', timeout: 180000, killSignal: 'SIGKILL' });
    if (build.error || build.status !== 0) throw new Error(`CN_TEST_IMAGE_BUILD_FAILED: ${(build.error?.message ?? "") + " " + build.stderr.slice(-6000)}`);
    built = true;
  }
  const name = `wsx-cn-host-test-${randomUUID()}`;
  const gitDirectory = mkdtempSync(join(tmpdir(), 'cn-host-git-'));
  chmodSync(gitDirectory, 0o755);
  for (const args of [['init', '--bare', gitDirectory], ['-C', gitDirectory, 'fetch', '--depth=2', `file://${root}`, 'HEAD'], ['-C', gitDirectory, 'update-ref', 'HEAD', 'FETCH_HEAD']]) {
    const remaining = Math.floor(preparationDeadline - performance.now());
    if (remaining < 1) { rmSync(gitDirectory, {recursive:true, force:true}); throw new Error('CN_TEST_PREPARATION_TIMEOUT'); }
    const setup = spawnSync('git', args, { encoding: 'utf8', timeout: Math.min(30000, remaining), killSignal: 'SIGKILL' });
    if (setup.error || setup.status !== 0) { rmSync(gitDirectory, {recursive:true, force:true}); throw new Error('CN_TEST_GIT_PREPARATION_FAILED'); }
  }
  const mounts = ['apps/api/src', 'apps/api/migrations', '.agents/skills/workspacex-cn-release/scripts', 'tsconfig.json', 'deploy', '.harness', 'packages', 'scripts', 'requirements', 'docs', '.github', 'package.json', 'pnpm-lock.yaml'].flatMap(path => ['--mount', `type=bind,source=${join(root,path)},target=/workspace/${path},readonly`]);
  mounts.push('--mount', `type=bind,source=${gitDirectory},target=/workspace/.git,readonly`);
  const executable = command === process.execPath ? '/usr/bin/node' : '/usr/bin/python3';
  const translatedArgs = args.map(arg => arg.startsWith(root) ? '/workspace/' + arg.slice(root.length).replace(/^\//,'') : arg);
  try {
    const result = spawnSync('docker', ['run', '--rm', '--name', name, '--label', 'workspacex.test-owner=cn-host-fixtures', '--env', 'GIT_CONFIG_COUNT=1', '--env', 'GIT_CONFIG_KEY_0=safe.directory', '--env', 'GIT_CONFIG_VALUE_0=/workspace', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '256', '--cpus', '2', '--memory', '1g', '--tmpfs', '/tmp:rw,exec,nosuid,nodev,size=512m,mode=1777', ...mounts, image, executable, ...translatedArgs], { encoding: 'utf8', timeout: runtimeTimeoutMs, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024 });
    return { ...result, containerName: name };
  } finally {
    try {
    const cleanup = spawnSync('docker', ['rm', '-f', name], { encoding: 'utf8', timeout: 10000, killSignal: 'SIGKILL' });
    if (cleanup.error || (cleanup.status !== 0 && !cleanup.stderr.includes('No such container'))) throw new Error('CN_TEST_CONTAINER_CLEANUP_FAILED');
    } finally { rmSync(gitDirectory, { recursive: true, force: true }); }
  }
}
