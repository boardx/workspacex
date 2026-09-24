import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { BoardBlobError } from '../../application/whiteboard/blob-ports';
import { DEFAULT_BOARD_KEY_ID, type VersionedBoardMasterKeySource } from './aes-gcm-board-blob-codec';

const MAX_ENCODED_KEY_BYTES = 128;

/** Reads exact-version production keys from a deployment-managed secrets directory. */
export class FileBoardMasterKeySource implements VersionedBoardMasterKeySource {
  readonly currentKeyId: string;

  constructor(private readonly root: string, keyId = DEFAULT_BOARD_KEY_ID) {
    if (!isAbsolute(root)) throw new BoardBlobError('ENCRYPTION_UNAVAILABLE', 'board key directory must be absolute');
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(keyId) || keyId.includes('..')) throw new BoardBlobError('ENCRYPTION_UNAVAILABLE', 'board key identity is invalid');
    this.currentKeyId = keyId;
  }

  async resolveVersion(input: { tenantId: string; keyId: string; version: number }): Promise<{ keyId: string; version: number; keyMaterial: Uint8Array }> {
    if (!input.tenantId || !Number.isSafeInteger(input.version) || input.version < 1) throw new BoardBlobError('INVALID_INPUT');
    if (input.keyId !== this.currentKeyId) throw new BoardBlobError('ENCRYPTION_UNAVAILABLE', 'requested board key identity is unavailable');
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
        const result = new Uint8Array(keyMaterial);
        keyMaterial.fill(0);
        return { keyId: input.keyId, version: input.version, keyMaterial: result };
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
