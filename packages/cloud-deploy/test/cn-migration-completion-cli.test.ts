import { describe, it, expect, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, readProtectedCompletionInput } from '../src/cn-migration-completion-cli';
describe('protected migration completion CLI', () => {
  it('rejects invalid arguments before reading inputs', async () => {
    await expect(main(['main', 'fixture'])).rejects.toThrow('MIGRATION_COMPLETION_ROOT_ARGUMENTS');
  });
  it('rejects an untrusted root even with exact arguments', async () => {
    const uid = vi.spyOn(process as { getuid: () => number }, 'getuid').mockReturnValue(1000);
    try { await expect(main(['9'.repeat(40), 'fixture'])).rejects.toThrow('MIGRATION_COMPLETION_ROOT_ARGUMENTS'); }
    finally { uid.mockRestore(); }
  });
  it('actual CLI returns stable rejection and no witness', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../src/cn-migration-completion-cli.ts', import.meta.url)), 'main', 'fixture'], { encoding: 'utf8' });
    expect(result.status).toBe(1); expect(result.stdout).toBe(''); expect(result.stderr.trim()).toBe('CN_MIGRATION_COMPLETION_REJECTED');
  });
  it.each(['success', 'mode', 'symlink', 'hardlink', 'parent-mode', 'replace-race', 'wrong-gid'] as const)('actual private filesystem fixture %s', (kind) => {
    const directory = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), 'completion-input-'));
    fs.chmodSync(directory, 0o700); const path = join(directory, 'input.json');
    fs.writeFileSync(path, '{"fixture":true}', { mode: 0o600 });
    const owner = fs.lstatSync(directory);
    const fixture = { uid: owner.uid, gid: owner.gid, boundary: directory };
    let spy: { mockRestore(): void } | undefined;
    try {
      if (kind === 'wrong-gid') fixture.gid += 1;
      if (kind === 'mode') fs.chmodSync(path, 0o644);
      if (kind === 'parent-mode') fs.chmodSync(directory, 0o777);
      if (kind === 'hardlink') fs.linkSync(path, join(directory, 'alias'));
      if (kind === 'symlink') { fs.renameSync(path, join(directory, 'actual')); fs.symlinkSync(join(directory, 'actual'), path); }
      if (kind === 'replace-race') {
        const read = fs.readFileSync.bind(fs);
        spy = vi.spyOn(fs, 'readFileSync').mockImplementation(((...args: Parameters<typeof fs.readFileSync>) => {
          const value = read(...args); fs.renameSync(path, join(directory, 'old')); fs.writeFileSync(path, '{}', { mode: 0o600 }); return value;
        }) as typeof fs.readFileSync);
      }
      if (kind === 'success') expect(readProtectedCompletionInput(path, fixture).value).toEqual({ fixture: true });
      else {
        // New recovery verification: a TypeError must never satisfy a security negative.
        const expected = { mode: 'MIGRATION_COMPLETION_INPUT_FILE', hardlink: 'MIGRATION_COMPLETION_INPUT_FILE',
          'wrong-gid': 'MIGRATION_COMPLETION_INPUT_PARENT', 'parent-mode': 'MIGRATION_COMPLETION_INPUT_PARENT', 'replace-race': 'MIGRATION_COMPLETION_INPUT_CHANGED', symlink: 'ELOOP' }[kind];
        expect(() => readProtectedCompletionInput(path, fixture)).toThrow(expected);
      }
    } finally { spy?.mockRestore(); fs.rmSync(directory, { recursive: true, force: true }); }
  });
  it('missing protected input cannot yield a witness', () => {
    expect(() => readProtectedCompletionInput('/etc/workspacex-cn/missing-fixture.json')).toThrow();
  });
});
