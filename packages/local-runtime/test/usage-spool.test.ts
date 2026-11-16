import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiEnv, deepAgentEnv, paths, resolveLocalConfig } from "../src/config";
import { ensurePrivateUsageSpool } from "../src/usage-spool";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const dirs: string[] = [];
function temporary() { const dir = mkdtempSync(join(tmpdir(), "wsx-usage-spool-")); dirs.push(dir); return dir; }
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("private local model usage journal preparation", () => {
  it("creates a private directory and preserves an existing journal across starts", () => {
    const spool = join(temporary(), "usage-spool");
    ensurePrivateUsageSpool(spool);
    if (process.platform !== "win32") expect(statSync(spool).mode & 0o777).toBe(0o700);
    const journal = join(spool, "model-usage.sqlite3"); writeFileSync(journal, "journal-marker");
    ensurePrivateUsageSpool(spool);
    expect(readFileSync(journal, "utf8")).toBe("journal-marker");
  });
  it.skipIf(process.platform === "win32")("refuses a symlink without touching its target", () => {
    const dir = temporary(), victim = join(dir, "victim"), spool = join(dir, "usage-spool");
    mkdirSync(victim, { mode: 0o700 }); writeFileSync(join(victim, "sentinel"), "untouched");
    symlinkSync(victim, spool, "dir");
    expect(() => ensurePrivateUsageSpool(spool)).toThrow(/symlink/);
    expect(readFileSync(join(victim, "sentinel"), "utf8")).toBe("untouched");
  });
  it.skipIf(process.platform === "win32")("refuses an existing nonprivate directory without changing permissions", () => {
    const spool = join(temporary(), "usage-spool");
    // The managed runtime's restrictive umask would turn mkdir(0755) into 0700.
    // Create only this disposable fixture with its own process umask; never chmod existing data.
    const fixture = spawnSync(process.execPath, ["-e", "process.umask(0o022); require('node:fs').mkdirSync(process.argv[1], {mode:0o755})", spool]);
    expect(fixture.status).toBe(0);
    const before = statSync(spool).mode;
    expect(() => ensurePrivateUsageSpool(spool)).toThrow(/not private/);
    expect(statSync(spool).mode).toBe(before);
  });
  it("refuses a file or relative path without deleting data", () => {
    const file = join(temporary(), "usage-spool"); writeFileSync(file, "keep");
    expect(() => ensurePrivateUsageSpool(file)).toThrow(/symlink or another file/);
    expect(readFileSync(file, "utf8")).toBe("keep");
    expect(() => ensurePrivateUsageSpool("relative-spool")).toThrow(/absolute/);
  });
  it.skipIf(process.platform === "win32")("checks existing parent ownership before creating a journal directory", () => {
    const dir = temporary(), spool = join(dir, "usage-spool"), uid = process.getuid!();
    vi.spyOn(process as { getuid: () => number }, "getuid").mockReturnValue(uid + 1);
    expect(() => ensurePrivateUsageSpool(spool)).toThrow(/parent must remain owned/);
    expect(existsSync(spool)).toBe(false);
  });
  it.each(["default", "aidt"] as const)("keeps %s Local on loopback despite hostile cloud host variables", profile => {
    vi.stubEnv("KERNEL_MODEL_BASE_URL", "https://external.invalid/v1");
    vi.stubEnv("KERNEL_MODEL_API_KEY", "external-host-key");
    vi.stubEnv("DEEP_AGENT_USAGE_SPOOL_DIR", "/untrusted-host-spool");
    const c = resolveLocalConfig({ repoRoot: root, dataDir: temporary(), profile });
    const py = deepAgentEnv(c), api = apiEnv(c);
    expect(py.DEEP_AGENT_USAGE_SPOOL_DIR).toBe(paths.usageSpool(c));
    expect(isAbsolute(py.DEEP_AGENT_USAGE_SPOOL_DIR!)).toBe(true);
    expect(py.KERNEL_MODEL_PROVIDER).toBe("ollama");
    expect(py.KERNEL_MODEL_BASE_URL).toBe(`http://127.0.0.1:${c.ports.ollama}/v1`);
    expect(py.KERNEL_MODEL_API_KEY).toBe("ollama-local");
    expect(api.KERNEL_SUBTASK_CALLBACK_BASE_URL).toBe(`http://127.0.0.1:${c.ports.api}`);
    expect(api.ENABLE_AIDT_MODULE).toBe(profile === "aidt" ? "1" : "0");
    expect(Object.values(py)).not.toContain("external-host-key");
  });
});
