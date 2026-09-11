import { lstat, readdir, readlink } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { assertTrustedPath } from "./trusted-path";

/** The bootstrap code itself must come from an externally verified release package.
 * This gate protects subsequent child commands/module loads. No untrusted component
 * is adopted or repaired. Symlinks may only traverse this same trusted checkout.
 */
export async function assertTrustedTree(checkout: string, options: {
  trustedRoot?: string;
  inspect?: typeof lstat;
  signal?: AbortSignal;
  remainingMs?: () => number;
} = {}): Promise<void> {
  const inspect = options.inspect ?? lstat;
  try {
    await assertTrustedPath(checkout, { trustedRoot: options.trustedRoot ?? "/", kind: "directory" }, inspect);
    const inside = (path: string) => {
      const value = relative(checkout, path);
      if (value === ".." || value.startsWith(`..${sep}`) || isAbsolute(value)) throw new Error();
    };
    const trusted = async (path: string) => {
      if (options.signal?.aborted || (options.remainingMs && options.remainingMs() <= 0)) throw new Error();
      const stat = await inspect(path);
      if (stat.uid !== 0 || (!stat.isSymbolicLink() && (stat.mode & 0o022) !== 0) ||
        (!stat.isSymbolicLink() && !stat.isFile() && !stat.isDirectory())) throw new Error();
      return stat;
    };
    const resolveLink = async (path: string, depth = 0): Promise<string> => {
      inside(path); if (depth > 40) throw new Error();
      const parts = relative(checkout, path).split(sep).filter(Boolean);
      let current = checkout;
      for (let i = 0; i < parts.length; i++) {
        current = join(current, parts[i]!);
        const stat = await trusted(current);
        if (stat.isSymbolicLink()) {
          const target = resolve(dirname(current), await readlink(current));
          inside(target);
          return resolveLink(join(target, ...parts.slice(i + 1)), depth + 1);
        }
        if (i < parts.length - 1 && !stat.isDirectory()) throw new Error();
      }
      return current;
    };
    const visited = new Set<string>();
    const visit = async (path: string): Promise<void> => {
      const stat = await trusted(path);
      if (stat.isSymbolicLink()) { await visit(await resolveLink(path)); return; }
      if (visited.has(path)) return;
      visited.add(path);
      if (stat.isDirectory()) for (const name of await readdir(path)) await visit(join(path, name));
    };
    if (!isAbsolute(checkout) || normalize(checkout) !== checkout) throw new Error();
    await visit(checkout);
  } catch { throw new Error("UNTRUSTED_RELEASE_TREE"); }
}
