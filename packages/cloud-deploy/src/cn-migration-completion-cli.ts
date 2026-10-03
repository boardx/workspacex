/** Root-protected fact witness wrapper. No migration, install or activation. */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { verifyMigrationCompletion, type MigrationCompletionExpected } from './cn-migration-completion';
export function readProtectedCompletionBytes(path: string, mode = 0o600, fixture?: { uid: number; gid: number; boundary: string }): Buffer {
  // Fixture API is not exposed by CLI; production always uses root defaults.
  const uid = fixture?.uid ?? 0, gid = fixture?.gid ?? 0;
  for (let parent = dirname(path); ; parent = dirname(parent)) {
    const st = fs.lstatSync(parent);
    if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== uid || st.gid !== gid || (st.mode & 0o022)) throw new Error('MIGRATION_COMPLETION_INPUT_PARENT');
    if (parent === (fixture?.boundary ?? '/')) break;
  }
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.uid !== uid || before.gid !== gid || before.nlink !== 1 || (before.mode & 0o777) !== mode || before.size > 32 * 1024 * 1024) throw new Error('MIGRATION_COMPLETION_INPUT_FILE');
    const raw = fs.readFileSync(fd), after = fs.fstatSync(fd), named = fs.lstatSync(path);
    if (!named.isFile() || named.isSymbolicLink() || named.dev !== before.dev || named.ino !== before.ino || named.nlink !== 1 || named.uid !== uid || named.gid !== gid || (named.mode & 0o777) !== mode) throw new Error('MIGRATION_COMPLETION_INPUT_CHANGED');
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error('MIGRATION_COMPLETION_INPUT_CHANGED');
    return raw;
  } finally { fs.closeSync(fd); }
}
export function readProtectedCompletionInput(path: string, fixture?: { uid: number; gid: number; boundary: string }): { raw: Buffer; value: unknown } {
  const raw = readProtectedCompletionBytes(path, 0o600, fixture);
  return { raw, value: JSON.parse(raw.toString('utf8')) };
}
export function verifyTrustedCompletionHelper() {
  const helper = '/usr/local/lib/workspacex-cn/cn-build-tool-identity.py';
  const profile = readProtectedCompletionInput('/etc/workspacex-cn/trusted-tool-binding.json').value as { toolRevision?: string; filesSha256?: Record<string, string> };
  const raw = readProtectedCompletionBytes(helper, 0o700);
  if (!/^[a-f0-9]{40}$/.test(profile.toolRevision ?? '') || createHash('sha256').update(raw).digest('hex') !== profile.filesSha256?.['.harness/scripts/vm/cn-build-tool-identity.py']) throw new Error('MIGRATION_COMPLETION_HELPER_BINDING');
  return helper;
}
export async function main(args = process.argv.slice(2)) {
  if (process.getuid?.() !== 0 || process.getgid?.() !== 0 || args.length !== 2 || !/^[a-f0-9]{40}$/.test(args[0]!) || !/^[A-Za-z0-9-]{1,128}$/.test(args[1]!)) throw new Error('MIGRATION_COMPLETION_ROOT_ARGUMENTS');
  const [source, attempt] = args;
  const input = readProtectedCompletionInput(`/etc/workspacex-cn/migration-completion-inputs/${source}/${attempt}.json`);
  const value = input.value as { snapshotInput: unknown; bindingInput: unknown; expected: MigrationCompletionExpected };
  if (!value || value.expected?.sourceRevision !== source || value.expected?.attemptId !== attempt) throw new Error('MIGRATION_COMPLETION_CLI_IDENTITY');
  const helper = verifyTrustedCompletionHelper();
  const checkout = execFileSync('/usr/bin/python3', [helper, '--completion-checkout', source!, attempt!], {
    encoding: 'utf8', timeout: 60_000, maxBuffer: 4096,
    stdio: ['ignore', 'pipe', 'pipe', 'ignore', 'ignore', 'ignore', 'ignore', 'ignore', 'ignore', 9],
    env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1', GIT_TERMINAL_PROMPT: '0' },
  }).trim();
  if (checkout !== `/var/lib/workspacex-cn/releases/${source}`) throw new Error('MIGRATION_COMPLETION_CHECKOUT_BINDING');
  for (const key of Object.keys(process.env)) if (key.startsWith('GIT_')) delete process.env[key];
  Object.assign(process.env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1', GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '4', GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: 'false', GIT_CONFIG_KEY_1: 'core.hooksPath', GIT_CONFIG_VALUE_1: '/dev/null', GIT_CONFIG_KEY_2: 'core.untrackedCache', GIT_CONFIG_VALUE_2: 'false', GIT_CONFIG_KEY_3: 'gc.auto', GIT_CONFIG_VALUE_3: '0' });
  const witness = await verifyMigrationCompletion(value.snapshotInput, value.bindingInput, checkout, value.expected);
  process.stdout.write(`CN_MIGRATION_COMPLETION_JSON=${JSON.stringify({ ...witness, protectedInputSha256: createHash('sha256').update(input.raw).digest('hex') })}\n`);
}
if (process.argv[1]?.endsWith('cn-migration-completion-cli.ts')) void main().catch(() => { process.stderr.write('CN_MIGRATION_COMPLETION_REJECTED\n'); process.exitCode = 1; });
