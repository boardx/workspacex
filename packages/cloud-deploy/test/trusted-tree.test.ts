import { mkdtemp, mkdir, writeFile, symlink, chmod, lstat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { assertTrustedTree } from "../src/trusted-tree";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "trusted-tree-")); roots.push(root);
  await mkdir(join(root, "node_modules/.pnpm/pkg/node_modules/pkg"), { recursive: true });
  await writeFile(join(root, "node_modules/.pnpm/pkg/node_modules/pkg/index.js"), "export const ready = true;");
  await symlink(".pnpm/pkg/node_modules/pkg", join(root, "node_modules/pkg"));
  // Real filesystem permissions and link resolution; map only the test runner's uid.
  const inspect = (async (path: string) => Object.assign(await lstat(path), { uid: 0 })) as typeof lstat;
  return { root, options: { trustedRoot: root, inspect } };
}
it("accepts a real pnpm relative link inside the trusted checkout", async () => {
  const f = await fixture(); await expect(assertTrustedTree(f.root, f.options)).resolves.toBeUndefined();
});
it("rejects a real link escaping the checkout", async () => {
  const f = await fixture(); await symlink("../../outside", join(f.root, "node_modules/escape"));
  await expect(assertTrustedTree(f.root, f.options)).rejects.toThrow("UNTRUSTED_RELEASE_TREE");
});
it("rejects chained links which leave and reenter the tree", async () => {
  const f = await fixture(); const outside = await mkdtemp(join(tmpdir(), "tree-outside-")); roots.push(outside);
  await symlink(join(f.root, "node_modules/pkg"), join(outside, "return"));
  await symlink(join(outside, "return"), join(f.root, "escape"));
  await expect(assertTrustedTree(f.root, f.options)).rejects.toThrow("UNTRUSTED_RELEASE_TREE");
});
it("rejects real cyclic links", async () => {
  const f = await fixture(); await symlink("b", join(f.root, "a")); await symlink("a", join(f.root, "b"));
  await expect(assertTrustedTree(f.root, f.options)).rejects.toThrow("UNTRUSTED_RELEASE_TREE");
});
it("rejects a writable nested module", async () => {
  const f = await fixture(); await chmod(join(f.root, "node_modules/.pnpm/pkg/node_modules/pkg/index.js"), 0o666);
  await expect(assertTrustedTree(f.root, f.options)).rejects.toThrow("UNTRUSTED_RELEASE_TREE");
});
it("rejects a non-root nested file even when the root is trusted", async () => {
  const f = await fixture(); const inspect = (async (path: string) => Object.assign(await lstat(path), { uid: path.endsWith("index.js") ? 1000 : 0 })) as typeof lstat;
  await expect(assertTrustedTree(f.root, { ...f.options, inspect })).rejects.toThrow("UNTRUSTED_RELEASE_TREE");
});
it("rejects special filesystem entries and observes a cancelled budget", async () => {
  const f = await fixture(); const inspect = (async (path: string) => {
    const stat = Object.assign(await lstat(path), { uid: 0 });
    if (path.endsWith("index.js")) { stat.isFile = () => false; stat.isDirectory = () => false; }
    return stat;
  }) as typeof lstat;
  await expect(assertTrustedTree(f.root, { ...f.options, inspect })).rejects.toThrow("UNTRUSTED_RELEASE_TREE");
  await expect(assertTrustedTree(f.root, { ...f.options, signal: AbortSignal.abort() })).rejects.toThrow("UNTRUSTED_RELEASE_TREE");
});
