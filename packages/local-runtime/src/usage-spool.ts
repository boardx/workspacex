import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, realpathSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";

/** Prepare only the local runtime's own usage journal directory. Never repair,
 * chmod, remove or traverse an existing symlink supplied at this location. */
export function ensurePrivateUsageSpool(path: string): void {
  if (!isAbsolute(path)) throw new Error("Local model usage spool requires an absolute path.");
  const posix = process.platform !== "win32";
  const parent = lstatSync(realpathSync(dirname(path)));
  const uid = process.getuid?.();
  if (!parent.isDirectory() || (posix && (parent.uid !== uid || (parent.mode & 0o022) !== 0))) {
    throw new Error("Local model usage spool parent must remain owned and protected by this user.");
  }
  try { mkdirSync(path, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const info = lstatSync(path);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("Local model usage spool cannot be a symlink or another file.");
  if (posix && (info.uid !== uid || (info.mode & 0o077) !== 0)) {
    throw new Error("Existing local model usage spool is not private and owned; no permissions were changed.");
  }
  if (!posix) return; // Windows user-directory ACLs remain managed by the existing host.
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(fd);
    if (!opened.isDirectory() || opened.dev !== info.dev || opened.ino !== info.ino || opened.uid !== uid || (opened.mode & 0o077) !== 0) {
      throw new Error("Local model usage spool changed during preparation.");
    }
  } finally { closeSync(fd); }
}
