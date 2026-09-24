import { chmod, mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileBoardMasterKeySource } from '../../src/infrastructure/whiteboard/file-board-master-key-source';

async function fixture(): Promise<{ root: string; encoded: string }> {
  const parent = await mkdtemp(join(tmpdir(), 'wsx-board-keys-'));
  const root = join(parent, 'keys'); await mkdir(root, { mode: 0o700 }); await chmod(root, 0o700);
  const encoded = Buffer.alloc(32, 9).toString('base64');
  await writeFile(join(root, 'v4.key'), `${encoded}\n`, { mode: 0o600 }); await chmod(join(root, 'v4.key'), 0o600);
  return { root, encoded };
}

describe('FileBoardMasterKeySource', () => {
  it('loads only the requested immutable version from a private deployment secrets directory', async () => {
    const { root } = await fixture();
    const result = await new FileBoardMasterKeySource(root).resolveVersion({ tenantId: 'org-a', version: 4 });
    expect(result).toEqual({ version: 4, keyMaterial: new Uint8Array(32).fill(9) });
    await expect(new FileBoardMasterKeySource(root).resolveVersion({ tenantId: 'org-a', version: 5 })).rejects.toMatchObject({ code: 'ENCRYPTION_UNAVAILABLE' });
  });

  it('rejects relative, group-readable, symlinked, and malformed key sources with sanitized errors', async () => {
    expect(() => new FileBoardMasterKeySource('relative/keys')).toThrow(/absolute/);
    const { root } = await fixture();
    await chmod(join(root, 'v4.key'), 0o640);
    await expect(new FileBoardMasterKeySource(root).resolveVersion({ tenantId: 'org-a', version: 4 })).rejects.toMatchObject({ code: 'ENCRYPTION_UNAVAILABLE', message: 'versioned board key service is unavailable' });
    await chmod(join(root, 'v4.key'), 0o600); await writeFile(join(root, 'bad.key'), 'not-secret', { mode: 0o600 });
    await symlink(join(root, 'bad.key'), join(root, 'v5.key'));
    await expect(new FileBoardMasterKeySource(root).resolveVersion({ tenantId: 'org-a', version: 5 })).rejects.toMatchObject({ code: 'ENCRYPTION_UNAVAILABLE' });
    await writeFile(join(root, 'v6.key'), 'not-base64', { mode: 0o600 });
    await expect(new FileBoardMasterKeySource(root).resolveVersion({ tenantId: 'org-a', version: 6 })).rejects.toMatchObject({ code: 'ENCRYPTION_UNAVAILABLE' });
  });
});
