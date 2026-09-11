import { constants } from "node:fs";
import { open, mkdir, lstat, link, unlink } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { isAbsolute, join } from "node:path";

export interface SecretOperationContext { signal?: AbortSignal; remainingMs?: () => number }
export function assertSecretOperationActive(context: SecretOperationContext = {}): void {
  if (context.signal?.aborted || (context.remainingMs && context.remainingMs() <= 0)) throw new Error("SECRET_OPERATION_CANCELLED");
}

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await directory.sync(); } finally { await directory.close(); }
}

/** Values never appear in errors. Files must be private regular files, bounded to 64 KiB. */
export async function resolveSecret(reference: string, env: NodeJS.ProcessEnv = process.env, context: SecretOperationContext = {}): Promise<string> {
  assertSecretOperationActive(context);
  if (/^env:[A-Z][A-Z0-9_]*$/.test(reference)) {
    const value = env[reference.slice(4)];
    if (!value || Buffer.byteLength(value) > 65_536 || value.includes("\0")) throw new Error("SECRET_UNAVAILABLE");
    return value;
  }
  if (!reference.startsWith("file:") || !isAbsolute(reference.slice(5))) throw new Error("INVALID_SECRET_REFERENCE");
  return readPrivateFile(reference.slice(5), context);
}

async function readPrivateFile(path: string, context: SecretOperationContext = {}): Promise<string> {
  assertSecretOperationActive(context);
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size <= 0 || stat.size > 65_536) throw new Error();
    const bytes = Buffer.alloc(65_537);
    let size = 0;
    while (size < bytes.length) {
      assertSecretOperationActive(context);
      const read = await file.read(bytes, size, bytes.length - size, null);
      if (!read.bytesRead) break;
      size += read.bytesRead;
    }
    if (!size || size > 65_536) throw new Error();
    const value = bytes.subarray(0, size).toString("utf8");
    if (value.includes("\0") || !Buffer.from(value).equals(bytes.subarray(0, size))) throw new Error();
    assertSecretOperationActive(context);
    return value;
  } catch { assertSecretOperationActive(context); throw new Error("SECRET_UNAVAILABLE"); }
  finally { await file?.close(); }
}

/** Stable generated secrets are published atomically; concurrent retries converge on the
 * original value. Existing unreadable/corrupt values fail instead of silently rotating keys.
 */
export async function ensureDeploymentSecret(directory: string, name: string, context: SecretOperationContext = {}): Promise<string> {
  assertSecretOperationActive(context);
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(name)) throw new Error("INVALID_SECRET_NAME");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  assertSecretOperationActive(context);
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error("UNSAFE_SECRET_DIRECTORY");
  assertSecretOperationActive(context);
  const path = join(directory, name);
  const temporary = join(directory, `.${randomUUID()}.tmp`);
  let created = false;
  try {
    const handle = await open(temporary, "wx", 0o600);
    created = true;
    try {
      assertSecretOperationActive(context);
      await handle.writeFile(randomBytes(32).toString("hex"));
      assertSecretOperationActive(context);
      await handle.sync();
    } finally { await handle.close(); }
    assertSecretOperationActive(context);
    try { await link(temporary, path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw new Error("SECRET_PERSIST_FAILED"); }
    // Persist the directory entry, not only the inode. Cancellation after an in-flight
    // link must still finish durability/cleanup, but cannot publish another key.
    await syncDirectory(directory);
    assertSecretOperationActive(context);
    const value = await readPrivateFile(path, context);
    if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("SECRET_INVALID");
    return value;
  } finally {
    if (created) {
      await unlink(temporary);
      await syncDirectory(directory);
    }
  }
}
