import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { BoardBlobError } from '../../application/whiteboard/blob-ports';
import type { VersionedBoardMasterKeySource } from './aes-gcm-board-blob-codec';

const MAX_ENCODED_KEY_BYTES = 128;

/** Reads exact-version production keys from a deployment-managed secrets directory. */
export class FileBoardMasterKeySource implements VersionedBoardMasterKeySource {
  constructor(private readonly root: string) {
    if (!isAbsolute(root)) throw new BoardBlobError('ENCRYPTION_UNAVAILABLE', 'board key directory must be absolute');
  }

  async resolveVersion(input: { tenantId: string; version: number }): Promise<{ version: number; keyMaterial: Uint8Array }> {
    if (!input.tenantId || !Number.isSafeInteger(input.version) || input.version < 1) throw new BoardBlobError('INVALID_INPUT');
    try {
      const rootStat = await lstat(this.root);
      if (rootStat.isSymbolicLink() || !rootStat.isDirectory() || (rootStat.mode & 0o077) !== 0 || !this.trustedOwner(rootStat.uid)) throw new Error('unsafe root');
      // Use the canonical directory after rejecting a direct symlink. macOS exposes /tmp and
      // /var through system aliases, so string equality with realpath would reject safe roots.
      const path = join(await realpath(this.root), `v${input.version}.key`);
      const before = await lstat(path);
      if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1 || (before.mode & 0o077) !== 0 || !this.trustedOwner(before.uid)
        || before.size < 40 || before.size > MAX_ENCODED_KEY_BYTES) throw new Error('unsafe key');
      const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const opened = await handle.stat();
        if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino) throw new Error('changed key');
        const encoded = (await handle.readFile({ encoding: 'utf8' })).trim();
        const keyMaterial = Buffer.from(encoded, 'base64');
        if (keyMaterial.byteLength !== 32 || keyMaterial.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) throw new Error('invalid key');
        return { version: input.version, keyMaterial: new Uint8Array(keyMaterial) };
      } finally { await handle.close(); }
    } catch (error) {
      if (error instanceof BoardBlobError) throw error;
      throw new BoardBlobError('ENCRYPTION_UNAVAILABLE', 'versioned board key service is unavailable');
    }
  }

  private trustedOwner(uid: number): boolean {
    return typeof process.getuid !== 'function' || uid === process.getuid() || uid === 0;
  }
}
