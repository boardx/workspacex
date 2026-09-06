import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, symlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "../src/session/manager.js";
import { BubblewrapProvider, bubblewrapArguments, type SessionExecutionProvider } from "../src/session/provider.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function setup(provider: SessionExecutionProvider = new BubblewrapProvider()) {
  const root = await mkdtemp(join(tmpdir(), "wx-session-test-")); roots.push(root);
  const manager = new SessionManager(provider, root);
  const session = await manager.create([{ path: "/skills/research/SKILL.md", contentBase64: Buffer.from("research").toString("base64") }]);
  return { manager, session };
}
describe("trusted session manager", () => {
  it("roundtrips bytes with isolated capabilities and immutable skills", async () => {
    const { manager, session } = await setup();
    const other = await manager.create();
    await manager.write(session.sessionId, session.token, { path: "/workspace/中文.txt", contentBase64: "AAH/" });
    expect((await manager.read(session.sessionId, session.token, "/workspace/中文.txt")).contentBase64).toBe("AAH/");
    await expect(manager.read(session.sessionId, other.token, "/workspace/中文.txt")).rejects.toThrow("SESSION_NOT_FOUND");
    await expect(manager.write(session.sessionId, session.token, { path: "/skills/research/SKILL.md", contentBase64: "" })).rejects.toThrow("SESSION_PATH_READ_ONLY");
    await manager.destroy(session.sessionId, session.token);
    await expect(manager.read(session.sessionId, session.token, "/workspace/中文.txt")).rejects.toThrow("SESSION_NOT_FOUND");
  });
  it("fails closed when the OS isolation provider is unavailable", async () => {
    const { manager, session } = await setup({ probe: async () => false, execute: async () => { throw new Error("must not execute"); } });
    await expect(manager.execute(session.sessionId, session.token, { executionId: "e1", command: "echo hello", timeoutMs: 1000 })).rejects.toThrow("SESSION_EXECUTION_UNAVAILABLE");
  });
  it("reserves capacity before asynchronous directory creation", async () => {
    const { manager } = await setup();
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => manager.create()));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(15);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(5);
  });
  it("accepts the 8 MiB limit without regex recursion and rejects noncanonical padding", async () => {
    const { manager, session } = await setup();
    await manager.write(session.sessionId, session.token, { path: "/workspace/large", contentBase64: Buffer.alloc(8388608).toString("base64") });
    expect((await manager.read(session.sessionId, session.token, "/workspace/large")).sizeBytes).toBe(8388608);
    await expect(manager.write(session.sessionId, session.token, { path: "/workspace/bad", contentBase64: "YR==" })).rejects.toThrow("INVALID_SESSION_INPUT");
  });
  it("rejects symlinks planted by executed code and caches completed executions", async () => {
    let calls = 0;
    const { manager, session } = await setup({ probe: async () => true, execute: async (input) => {
      calls++;
      await symlink("/etc/passwd", join(input.workspace, "escape"));
      return { executionId: input.executionId, exitCode: 0, output: "ok", truncated: false, timedOut: false, cancelled: false };
    } });
    const input = { executionId: "e1", command: "fixture", timeoutMs: 1000 };
    await manager.execute(session.sessionId, session.token, input);
    await manager.execute(session.sessionId, session.token, input);
    expect(calls).toBe(1);
    await expect(manager.read(session.sessionId, session.token, "/workspace/escape")).rejects.toThrow("INVALID_SESSION_PATH");
    await expect(manager.execute(session.sessionId, session.token, { ...input, command: "other" })).rejects.toThrow("SESSION_EXECUTION_CONFLICT");
  });
  it("does not expose host roots, socket paths, credentials or other sessions in bwrap policy", () => {
    const args = bubblewrapArguments("/tmp/session-a/workspace", "/tmp/session-a/skills");
    expect(args).toContain("--unshare-all");
    expect(args).not.toContain("/proc"); // Nested namespaces are denied by mandatory BPF.
    expect(args).toContain("--clearenv");
    expect(args).not.toContain("/");
    expect(args).not.toContain("/run/sandbox");
    expect(args.slice(args.indexOf("--bind"), args.indexOf("--bind") + 3)).toEqual(["--bind", "/tmp/session-a/workspace", "/workspace"]);
  });
  it("cancels the active provider and blocks concurrent file access", async () => {
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const { manager, session } = await setup({ probe: async () => true, execute: (input) => new Promise((resolve) => {
      started();
      input.signal.addEventListener("abort", () => resolve({ executionId: input.executionId, exitCode: null,
        output: "", truncated: false, timedOut: false, cancelled: true }), { once: true });
    }) });
    const pending = manager.execute(session.sessionId, session.token, { executionId: "e1", command: "fixture", timeoutMs: 1000 });
    await ready;
    await expect(manager.read(session.sessionId, session.token, "/skills/research/SKILL.md")).rejects.toThrow("SESSION_BUSY");
    expect(manager.cancel(session.sessionId, session.token, "e1")).toEqual({ cancelled: true });
    expect((await pending).cancelled).toBe(true);
  });
  it("cancels while the capability probe is pending without starting user code", async () => {
    let finish!: (ready: boolean) => void;
    let calls = 0;
    const { manager, session } = await setup({ probe: () => new Promise((resolve) => { finish = resolve; }),
      execute: async () => { calls++; throw new Error("must not execute"); } });
    const pending = manager.execute(session.sessionId, session.token, { executionId: "pending", command: "fixture", timeoutMs: 1000 });
    await Promise.resolve();
    expect(manager.cancel(session.sessionId, session.token, "pending").cancelled).toBe(true);
    finish(true);
    expect((await pending).cancelled).toBe(true);
    expect(calls).toBe(0);
  });
  it("removes a closing session before awaiting its pending probe", async () => {
    let finish!: (ready: boolean) => void;
    const { manager, session } = await setup({ probe: () => new Promise((resolve) => { finish = resolve; }),
      execute: async () => { throw new Error("must not execute"); } });
    const pending = manager.execute(session.sessionId, session.token, { executionId: "closing", command: "fixture", timeoutMs: 1000 });
    await Promise.resolve();
    const closing = manager.destroy(session.sessionId, session.token);
    await expect(manager.read(session.sessionId, session.token, "/workspace/file")).rejects.toThrow("SESSION_NOT_FOUND");
    finish(true);
    expect((await pending).cancelled).toBe(true);
    expect(await closing).toEqual({ deleted: true });
  });
  it("caps retained execution identities without enabling replay by eviction", async () => {
    const { manager, session } = await setup({ probe: async () => true, execute: async (input) => ({
      executionId: input.executionId, exitCode: 0, output: "", truncated: false, timedOut: false, cancelled: false }) });
    for (let i = 0; i < 128; i++) await manager.execute(session.sessionId, session.token, { executionId: String(i), command: "true", timeoutMs: 1000 });
    await expect(manager.execute(session.sessionId, session.token, { executionId: "129", command: "true", timeoutMs: 1000 })).rejects.toThrow("SESSION_LIMIT");
    expect((await manager.execute(session.sessionId, session.token, { executionId: "0", command: "true", timeoutMs: 1000 })).exitCode).toBe(0);
  });

  it("rejects oversized directory listings instead of returning partial or unbounded output", async () => {
    const { manager, session } = await setup({ probe: async () => true, execute: async (input) => {
      for (let offset = 0; offset < 4097; offset += 32) {
        await Promise.all(Array.from({ length: Math.min(32, 4097 - offset) }, (_, index) =>
          mkdir(join(input.workspace, String(offset + index)))));
      }
      return { executionId: input.executionId, exitCode: 0, output: "", truncated: false, timedOut: false, cancelled: false };
    } });
    await manager.execute(session.sessionId, session.token, { executionId: "many-files", command: "fixture", timeoutMs: 1000 });
    await expect(manager.list(session.sessionId, session.token, "/workspace")).rejects.toThrow("SESSION_LIMIT");
    // Directory iteration must release its handle/lock even when the bound is exceeded.
    expect((await manager.list(session.sessionId, session.token, "/skills")).entries).toHaveLength(1);
  }, 20_000);

});
