import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { constants } from "node:fs";
const memory = vi.hoisted(() => ({ entries: new Map<string, { bytes: string; uid: number; mode: number; gid?: number; directory?: boolean; symlink?: boolean }>(), opens: [] as { path: string; flags: number }[], renameFailure: false, writes: [] as string[], syncs: [] as string[], fdInfo: "", fdLink: "", fdInode: 123 }));
vi.mock("node:fs", async importOriginal => ({ ...(await importOriginal<typeof import("node:fs")>()),
  fstatSync: () => ({ dev: 1, ino: memory.fdInode, uid: 0, gid: 0, mode: 0o600, isFile: () => true }),
}));
vi.mock("node:fs/promises", () => {
  const missing = () => Object.assign(new Error("missing"), { code: "ENOENT" });
  const stat = (path: string) => { const item = memory.entries.get(path); if (!item) throw missing(); return { gid: 0, dev: 1, ino: 123, ...item, size: Buffer.byteLength(item.bytes), isFile: () => !item.directory && !item.symlink, isDirectory: () => !!item.directory, isSymbolicLink: () => !!item.symlink }; };
  return {
    readlink: vi.fn(async () => memory.fdLink),
    readFile: vi.fn(async () => memory.fdInfo),
    lstat: vi.fn(async (path: string) => stat(path)),
    mkdir: vi.fn(async (path: string, options: { mode: number }) => { if (memory.entries.has(path)) throw Object.assign(new Error(), { code: "EEXIST" }); memory.entries.set(path, { bytes: "", uid: 0, mode: options.mode, directory: true }); }),
    open: vi.fn(async (path: string, flags: number, mode?: number) => {
      memory.opens.push({ path, flags });
      if (flags & constants.O_CREAT) {
        if (memory.entries.has(path) && (flags & constants.O_EXCL)) throw Object.assign(new Error(), { code: "EEXIST" });
        memory.entries.set(path, { bytes: "", uid: 0, mode: mode! });
      }
      stat(path);
      return { stat: async () => stat(path), readFile: async () => memory.entries.get(path)!.bytes,
        writeFile: async (bytes: string) => { memory.writes.push(path); memory.entries.get(path)!.bytes = bytes; },
        sync: async () => { memory.syncs.push(path); }, close: async () => {} };
    }),
    rename: vi.fn(async (from: string, to: string) => { if (memory.renameFailure) throw new Error("rename rejected"); const value = memory.entries.get(from)!; memory.entries.set(to, value); memory.entries.delete(from); }),
    unlink: vi.fn(async (path: string) => { if (!memory.entries.delete(path)) throw missing(); }),
    rmdir: vi.fn(async (path: string) => { if (!memory.entries.delete(path)) throw missing(); }),
  };
});
import { deploymentExample } from "../src/index";
import { candidateConfigHostAction, candidateConfigurationPaths } from "../src/cn-candidate-config";
const identity = { revision: "a".repeat(40), release: "2026.9.30-cn.1", attemptId: "12345-1" };
const paths = candidateConfigurationPaths(identity), originalPlatform = process.platform;
const baseline = JSON.stringify(deploymentExample("production"));
beforeEach(() => {
  memory.entries.clear(); memory.opens.length = 0; memory.writes.length = 0; memory.syncs.length = 0; memory.renameFailure = false; memory.fdInfo = "lock:\t1: FLOCK ADVISORY WRITE 54321 00:01:123 0 EOF\n"; memory.fdLink = "/var/lib/workspacex-cn/runtime/release.lock"; memory.fdInode = 123;
  for (const path of ["/", "/etc", "/etc/workspacex-cn"]) memory.entries.set(path, { bytes: "", uid: 0, mode: path === "/etc/workspacex-cn" ? 0o700 : 0o755, directory: true });
  for (const path of ["/var", "/var/lib", "/var/lib/workspacex-cn", "/var/lib/workspacex-cn/runtime"]) memory.entries.set(path, { bytes: "", uid: 0, mode: 0o755, directory: true });
  memory.entries.set("/var/lib/workspacex-cn/runtime/release.lock", { bytes: "", uid: 0, gid: 0, mode: 0o600 });
  memory.entries.set(paths.active, { bytes: baseline, uid: 0, mode: 0o600 });
  Object.defineProperty(process, "platform", { value: "linux", configurable: true });
  vi.spyOn(process as { getuid: () => number }, "getuid").mockReturnValue(0);
});
afterEach(() => { Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true }); vi.restoreAllMocks(); });
describe("trusted candidate host operations", () => {
  it("prepares private snapshots without writing active configuration", async () => {
    expect((await candidateConfigHostAction("prepare", identity)).state).toBe("prepared");
    expect(memory.entries.get(paths.active)!.bytes).toBe(baseline);
    for (const path of [paths.baseline, paths.candidate, paths.receipt]) expect(memory.entries.get(path)!.mode).toBe(0o600);
    expect(memory.entries.get(paths.directory)!.mode).toBe(0o700);
    expect(memory.opens.every(call => !!(call.flags & constants.O_NOFOLLOW))).toBe(true);
    expect(memory.entries.has("/etc/workspacex-cn/candidate-config.lock")).toBe(false);
  });
  it("reuses exact prepared attempt without rewriting snapshots", async () => {
    await candidateConfigHostAction("prepare", identity); memory.writes.length = 0;
    await candidateConfigHostAction("prepare", identity); expect(memory.writes).toEqual([]);
  });
  it("commits and restores atomically and permits activated reconciliation", async () => {
    await candidateConfigHostAction("prepare", identity);
    const candidate = memory.entries.get(paths.candidate)!.bytes;
    expect((await candidateConfigHostAction("commit", identity)).state).toBe("activated");
    expect(memory.entries.get(paths.active)!.bytes).toBe(candidate);
    expect((await candidateConfigHostAction("prepare", identity)).state).toBe("activated");
    expect((await candidateConfigHostAction("verify", identity)).state).toBe("activated");
    expect((await candidateConfigHostAction("commit", identity)).state).toBe("activated");
    expect((await candidateConfigHostAction("restore", identity)).state).toBe("prepared");
    expect(memory.entries.get(paths.active)!.bytes).toBe(baseline);
    expect(memory.syncs).toContain("/etc/workspacex-cn");
  });
  it.each(["commit", "restore"] as const)("%s rejects concurrent config drift without overwriting it", async action => {
    await candidateConfigHostAction("prepare", identity); memory.entries.get(paths.active)!.bytes = "drift";
    await expect(candidateConfigHostAction(action, identity)).rejects.toThrow("ACTIVE_CONFIGURATION_CHANGED");
    expect(memory.entries.get(paths.active)!.bytes).toBe("drift");
  });
  it("rejects an altered candidate before commit", async () => {
    await candidateConfigHostAction("prepare", identity); memory.entries.get(paths.candidate)!.bytes += "\n";
    await expect(candidateConfigHostAction("commit", identity)).rejects.toThrow("CANDIDATE_CONFIGURATION_CHANGED");
    expect(memory.entries.get(paths.active)!.bytes).toBe(baseline);
  });
  it("failed atomic rename leaves active configuration intact and removes temporary file", async () => {
    await candidateConfigHostAction("prepare", identity); memory.renameFailure = true;
    await expect(candidateConfigHostAction("commit", identity)).rejects.toThrow();
    expect(memory.entries.get(paths.active)!.bytes).toBe(baseline);
    expect([...memory.entries.keys()].some(path => path.startsWith(`${paths.active}.candidate-`))).toBe(false);
  });
  it.each([{ uid: 1000 }, { mode: 0o644 }, { symlink: true }])("rejects unsafe baseline %j", async changes => {
    Object.assign(memory.entries.get(paths.active)!, changes);
    await expect(candidateConfigHostAction("prepare", identity)).rejects.toThrow("UNTRUSTED_HOST_PATH");
    expect(memory.writes).toEqual([]);
  });
  it("rejects writable ancestor before opening any config", async () => {
    memory.entries.get("/etc")!.mode = 0o777;
    await expect(candidateConfigHostAction("prepare", identity)).rejects.toThrow("UNTRUSTED_HOST_PATH");
    expect(memory.opens).toEqual([]);
  });
  it("rejects stale lock rather than adopting it", async () => {
    memory.entries.set("/etc/workspacex-cn/candidate-config.lock", { bytes: "", uid: 0, mode: 0o700, directory: true });
    await expect(candidateConfigHostAction("prepare", identity)).rejects.toThrow();
    expect(memory.writes).toEqual([]);
  });
  it("rejects interrupted preparation with baseline snapshot but no receipt", async () => {
    await candidateConfigHostAction("prepare", identity); memory.entries.delete(paths.receipt);
    await expect(candidateConfigHostAction("prepare", identity)).rejects.toThrow();
    expect(memory.entries.get(paths.active)!.bytes).toBe(baseline);
  });
  it("rejects non-root group on 0600 baseline", async () => {
    memory.entries.get(paths.active)!.gid = 1000;
    await expect(candidateConfigHostAction("prepare", identity)).rejects.toThrow("UNTRUSTED_CONFIGURATION_FILE");
    expect(memory.writes).toEqual([]);
  });
  it.each(["unlocked", "shared", "other-inode", "other-path"])("rejects unproven canonical fd9: %s", async kind => {
    if (kind === "unlocked") memory.fdInfo = "pos: 0\n";
    if (kind === "shared") memory.fdInfo = memory.fdInfo.replace("WRITE", "READ");
    if (kind === "other-inode") memory.fdInode = 456;
    if (kind === "other-path") memory.fdLink = "/tmp/release.lock";
    await expect(candidateConfigHostAction("prepare", identity)).rejects.toThrow("CANONICAL_DEPLOYMENT_LOCK_UNPROVEN");
    expect(memory.writes).toEqual([]);
  });
  it("rejects non-root callers before any filesystem work", async () => {
    vi.mocked(process.getuid!).mockReturnValue(1000);
    await expect(candidateConfigHostAction("prepare", identity)).rejects.toThrow("CANDIDATE_CONFIG_ROOT_REQUIRED");
    expect(memory.opens).toEqual([]);
  });
});


it("accepts root-owned runner-readable manifest parent while keeping candidate subtree root-private", async () => {
  memory.entries.get("/etc/workspacex-cn")!.mode = 0o750;
  memory.entries.get("/etc/workspacex-cn")!.gid = 1001;
  const result = await candidateConfigHostAction("prepare", identity);
  expect(result.state).toBe("prepared");
  expect(memory.entries.get(paths.directory)!.mode).toBe(0o700);
});
