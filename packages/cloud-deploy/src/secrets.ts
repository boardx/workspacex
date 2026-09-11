import { constants } from "node:fs";
import { open, mkdir, lstat, link, unlink } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { isAbsolute, join } from "node:path";

/** Values never appear in errors. Files must be private regular files, bounded to 64 KiB. */
export async function resolveSecret(reference: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  if (/^env:[A-Z][A-Z0-9_]*$/.test(reference)) {
    const value = env[reference.slice(4)];
    if (!value || Buffer.byteLength(value) > 65_536 || value.includes("\0")) throw new Error("SECRET_UNAVAILABLE");
    return value;
  }
  if (!reference.startsWith("file:") || !isAbsolute(reference.slice(5))) throw new Error("INVALID_SECRET_REFERENCE");
  return readPrivateFile(reference.slice(5));
}

async function readPrivateFile(path: string): Promise<string> {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size <= 0 || stat.size > 65_536) throw new Error();
    const bytes = Buffer.alloc(65_537);
    let size = 0;
    while (size < bytes.length) {
      const read = await file.read(bytes, size, bytes.length - size, null);
      if (!read.bytesRead) break;
      size += read.bytesRead;
    }
    if (!size || size > 65_536) throw new Error();
    const value = bytes.subarray(0, size).toString("utf8");
    if (value.includes("\0") || !Buffer.from(value).equals(bytes.subarray(0, size))) throw new Error();
    return value;
  } catch { throw new Error("SECRET_UNAVAILABLE"); }
  finally { await file?.close(); }
}

/** Stable generated secrets are published atomically; concurrent retries converge on the
 * original value. Existing unreadable/corrupt values fail instead of silently rotating keys.
 */
export async function ensureDeploymentSecret(directory: string, name: string): Promise<string> {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(name)) throw new Error("INVALID_SECRET_NAME");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error("UNSAFE_SECRET_DIRECTORY");
  const path = join(directory, name);
  const temporary = join(directory, `.${randomUUID()}.tmp`);
  const generated = randomBytes(32).toString("hex");
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(generated); await handle.sync(); } finally { await handle.close(); }
  try {
    try { await link(temporary, path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw new Error("SECRET_PERSIST_FAILED"); }
    const value = await readPrivateFile(path);
    if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("SECRET_INVALID");
    return value;
  } finally { await unlink(temporary); }
}
