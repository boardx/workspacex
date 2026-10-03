import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs';

export interface TrustedExecutable { path: string; sha256: string; writerFenceModule?: { path: string; sha256: string } }
export interface CommandResult { stdout: string }
export type CommandRunner = (command: TrustedExecutable, args: readonly string[], input?: unknown) => Promise<CommandResult>;
const fail = (code: string): never => { throw new Error(code); };
export function protectedPrivateJson(path: string, expectedSha256?: string): unknown {
  if (!path.startsWith('/') || path.split('/').includes('..')) fail('PRIVATE_PATH_INVALID');
  const parts = path.split('/').filter(Boolean);
  for (let i = 1; i < parts.length; i++) {
    const st = lstatSync('/' + parts.slice(0, i).join('/'));
    if (!st.isDirectory() || st.uid !== 0 || st.gid !== 0 || (st.mode & 0o022)) fail('PRIVATE_PARENT_UNTRUSTED');
  }
  const before = lstatSync(path), fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.uid !== 0 || st.gid !== 0 || st.nlink !== 1 || (st.mode & 0o777) !== 0o600 || st.dev !== before.dev || st.ino !== before.ino || st.size > 1048576) fail('PRIVATE_FILE_UNTRUSTED');
    const bytes = readFileSync(fd), after = fstatSync(fd);
    if (expectedSha256 !== undefined && (!/^[a-f0-9]{64}$/.test(expectedSha256) || createHash('sha256').update(bytes).digest('hex') !== expectedSha256)) fail('PRIVATE_FILE_HASH_MISMATCH');
    if (st.size !== after.size || st.mtimeMs !== after.mtimeMs || st.ctimeMs !== after.ctimeMs) fail('PRIVATE_FILE_CHANGED');
    try { return JSON.parse(bytes.toString('utf8')); } catch { fail('PRIVATE_JSON_INVALID'); }
  } finally { closeSync(fd); }
}
/** Every parent is root-owned and unwritable to group/other. Symlinks and hardlinks
 * are rejected; the verified open descriptor is used as the interpreter input. */
export function protectedExecutable(command: TrustedExecutable): number {
  if (!command.path.startsWith('/') || command.path.includes('..') || !/^[a-f0-9]{64}$/.test(command.sha256)) fail('COMMAND_BINDING_INVALID');
  const parts = command.path.split('/').filter(Boolean);
  for (let i = 1; i < parts.length; i++) {
    const st = lstatSync('/' + parts.slice(0, i).join('/'));
    if (!st.isDirectory() || st.uid !== 0 || st.gid !== 0 || (st.mode & 0o022)) fail('COMMAND_PARENT_UNTRUSTED');
  }
  const before = lstatSync(command.path);
  if (!before.isFile() || before.uid !== 0 || before.gid !== 0 || before.nlink !== 1 || (before.mode & 0o777) !== 0o700) fail('COMMAND_METADATA_UNTRUSTED');
  const fd = openSync(command.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const after = fstatSync(fd);
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mtimeMs !== before.mtimeMs) fail('COMMAND_CHANGED');
    if (createHash('sha256').update(readFileSync(fd)).digest('hex') !== command.sha256) fail('COMMAND_HASH_MISMATCH');
    return fd;
  } catch (error) { closeSync(fd); throw error; }
}
/** No shell, ambient credentials, PATH lookup or FD-9 reacquisition. FD 10 pins
 * the exact verified script bytes through exec; /proc is an explicit Linux requirement. */
async function runFixed(command: TrustedExecutable, args: readonly string[], input: unknown, interpreter: 'python' | 'bash'): Promise<CommandResult> {
  if (process.platform !== 'linux' || process.getuid?.() !== 0) fail('ROOT_LINUX_REQUIRED');
  try { fstatSync(9); } catch { fail('INHERITED_FD9_REQUIRED'); }
  const fd = protectedExecutable(command);
  let dependency: number | undefined;
  try {
    if (command.writerFenceModule) dependency = protectedExecutable(command.writerFenceModule);
    return await new Promise<CommandResult>((resolve, reject) => {
      const bootstrap = "import sys,runpy,importlib.util,importlib.machinery; " + (dependency === undefined ? '' : "s=importlib.util.spec_from_loader('writer_fence',importlib.machinery.SourceFileLoader('writer_fence','/proc/self/fd/11')); m=importlib.util.module_from_spec(s);sys.modules['writer_fence']=m;s.loader.exec_module(m); ") + "sys.argv=['/proc/self/fd/10']+sys.argv[1:];runpy.run_path('/proc/self/fd/10',run_name='__main__')";
      const child = spawn(interpreter === 'python' ? '/usr/bin/python3' : '/usr/bin/bash', interpreter === 'python' ? ['-I', '-c', bootstrap, ...args] : ['/proc/self/fd/10', ...args], {
        shell: false, detached: true, env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C.UTF-8', PYTHONNOUSERSITE: '1' },
        stdio: ['pipe', 'pipe', 'pipe', 'ignore', 'ignore', 'ignore', 'ignore', 'ignore', 'ignore', 9, fd, dependency === undefined ? 'ignore' : dependency],
      });
      let stdout = '', size = 0;
      const killGroup = () => { if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ } } };
      const timer = setTimeout(killGroup, 300000);
      child.stdout!.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 1048576) killGroup(); else stdout += chunk; });
      // Do not echo child stderr: a failed database adapter can contain credentials.
      child.stderr!.resume();
      child.on('error', () => { clearTimeout(timer); reject(new Error('FIXED_COMMAND_SPAWN_FAILED')); });
      child.on('close', (code) => { clearTimeout(timer); code === 0 && size <= 1048576 ? resolve({ stdout }) : reject(new Error('FIXED_COMMAND_FAILED')); });
      child.stdin!.end(input === undefined ? '' : JSON.stringify(input) + '\n');
    });
  } finally { if (dependency !== undefined) closeSync(dependency); closeSync(fd); }
}
export const runFixedPython: CommandRunner = (command, args, input) => runFixed(command, args, input, 'python');
export const runFixedBash: CommandRunner = (command, args, input) => runFixed(command, args, input, 'bash');
/** Launcher owns this flock open description. The controller never opens a
 * second description to acquire it and never releases it on unknown state. */
export async function inheritedFd9Lock(): Promise<() => Promise<void>> {
  if (process.platform !== 'linux' || process.getuid?.() !== 0) fail('ROOT_LINUX_REQUIRED');
  const parent = lstatSync('/var/lib/workspacex-cn/runtime');
  if (!parent.isDirectory() || parent.uid !== 0 || parent.gid !== 0 || (parent.mode & 0o777) !== 0o700) fail('LOCK_PARENT_UNTRUSTED');
  const actual = lstatSync('/var/lib/workspacex-cn/runtime/release.lock');
  const inherited = fstatSync(9);
  if (!actual.isFile() || actual.uid !== 0 || actual.gid !== 0 || actual.nlink !== 1 || (actual.mode & 0o777) !== 0o600 || actual.dev !== inherited.dev || actual.ino !== inherited.ino) fail('CANONICAL_FD9_REQUIRED');
  const fdinfo = readFileSync('/proc/self/fdinfo/9', 'utf8');
  if (!/^lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+WRITE\s+/m.test(fdinfo)) fail('CANONICAL_FD9_LOCK_NOT_HELD');
  let released = false;
  return async () => { if (released) fail('CANONICAL_FD9_ALREADY_RELEASED'); released = true; closeSync(9); };
}
