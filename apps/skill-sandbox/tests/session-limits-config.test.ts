/**
 * `SKILL_SANDBOX_MAX_SESSIONS` 是并发 session 容量的部署可配项。这组用例锁三件事：
 *   ① 不设 ⇒ 用契约默认值（默认值仍只声明在 packages/contracts/src/sandbox-session.ts）；
 *   ② 设了合法值 ⇒ 生效，且 SessionManager 真的按新上限放行/拒绝（不是只改了个数字）；
 *   ③ 设了非法值 ⇒ **抛异常**，不退回默认——静默退回会造出"看起来配了、其实没配"的机器。
 *
 * schema.ts 在**模块加载时**读 env，所以每个用例都要 resetModules + 动态 import，
 * 不能在文件顶部静态 import。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const CONTRACT_DEFAULT: number = JSON.parse(
  readFileSync(new URL("../src/generated/sandbox-session-schema.json", import.meta.url), "utf8"),
).limits.maxSessions;

async function loadLimits(value?: string) {
  vi.resetModules();
  if (value === undefined) delete process.env.SKILL_SANDBOX_MAX_SESSIONS;
  else process.env.SKILL_SANDBOX_MAX_SESSIONS = value;
  return (await import("../src/session/schema.js")).sessionLimits;
}

afterEach(() => { delete process.env.SKILL_SANDBOX_MAX_SESSIONS; vi.resetModules(); });

describe("SKILL_SANDBOX_MAX_SESSIONS", () => {
  it("falls back to the contract default when unset or empty", async () => {
    expect((await loadLimits(undefined)).maxSessions).toBe(CONTRACT_DEFAULT);
    expect((await loadLimits("")).maxSessions).toBe(CONTRACT_DEFAULT);
    expect((await loadLimits("   ")).maxSessions).toBe(CONTRACT_DEFAULT);
  });

  it("overrides the default with a positive integer", async () => {
    expect((await loadLimits("64")).maxSessions).toBe(64);
    expect((await loadLimits(" 32 ")).maxSessions).toBe(32);
    expect((await loadLimits("1")).maxSessions).toBe(1);
  });

  it("leaves every other limit untouched", async () => {
    const overridden = await loadLimits("64");
    const base = await loadLimits(undefined);
    for (const key of Object.keys(base)) {
      if (key !== "maxSessions") expect(overridden[key]).toBe(base[key]);
    }
  });

  it("throws rather than silently falling back on an invalid value", async () => {
    // `1e3` / `0x10` 在这里必须红：`Number()` 会把它们收成 1000 / 16，
    // 而写下它们的人想要的几乎不是那个数。
    for (const bad of ["0", "-1", "abc", "8.5", "1e3", "0x10", "NaN", "Infinity"]) {
      await expect(loadLimits(bad)).rejects.toThrow(/SKILL_SANDBOX_MAX_SESSIONS/);
    }
  });

  it("is actually enforced by SessionManager, not just reported", async () => {
    vi.resetModules();
    process.env.SKILL_SANDBOX_MAX_SESSIONS = "2";
    const { SessionManager } = await import("../src/session/manager.js");
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = await mkdtemp(join(tmpdir(), "wx-session-cap-"));
    try {
      const manager = new SessionManager({ execute: async () => ({ exitCode: 0, output: "", truncated: false, timedOut: false, cancelled: false }) } as never, root);
      await manager.create();
      await manager.create();
      await expect(manager.create()).rejects.toThrow("SESSION_LIMIT");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
