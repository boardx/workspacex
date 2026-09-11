import { lstat } from "node:fs/promises";
import { dirname, isAbsolute, normalize, relative, sep } from "node:path";

type PathStat = { uid: number; mode: number; isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean };
export interface TrustedPathOptions {
  /** Explicit root of trust, which is itself checked. Use / for host paths. */
  trustedRoot: string;
  kind: "directory" | "file";
  /** Require exactly 0700 for a directory or 0600 for a regular file. */
  private?: boolean;
  /** Service-owned data leaf only; never applies to ancestors or trustedRoot. */
  allowedLeafUids?: readonly number[];
}

/** Reject non-root control of every component before privileged reads/writes/mounts.
 * This checks existing paths only. For creation, check the existing parent first,
 * create exclusively, then check the result. No repair/chown/adoption is performed.
 * With every ancestor root-owned and non-writable to others, unprivileged users
 * cannot rename components between this check and the caller's operation.
 */
export async function assertTrustedPath(path: string, options: TrustedPathOptions,
  inspect: (path: string) => Promise<PathStat> = lstat): Promise<void> {
  try {
    const root = options.trustedRoot;
    if (![root, path].every(value => isAbsolute(value) && normalize(value) === value && (value === "/" || !value.endsWith(sep)) && !value.includes("\0"))) throw new Error();
    const within = relative(root, path);
    if (within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new Error();
    if (options.allowedLeafUids?.some(uid => !Number.isSafeInteger(uid) || uid < 0)) throw new Error();
    for (let current = path; ; current = dirname(current)) {
      const leaf = current === path;
      const stat = await inspect(current);
      const permittedOwner = stat.uid === 0 || (leaf && current !== root && options.kind === "directory" && options.allowedLeafUids?.includes(stat.uid));
      if (stat.isSymbolicLink() || !permittedOwner || (stat.mode & 0o022) !== 0) throw new Error();
      if (current === root && !stat.isDirectory()) throw new Error();
      if (leaf && options.kind === "file" ? !stat.isFile() : !stat.isDirectory()) throw new Error();
      if (leaf && options.private && (stat.mode & 0o777) !== (options.kind === "file" ? 0o600 : 0o700)) throw new Error();
      if (current === root) break;
      if (dirname(current) === current) throw new Error();
    }
  } catch {
    throw new Error("UNTRUSTED_HOST_PATH");
  }
}
