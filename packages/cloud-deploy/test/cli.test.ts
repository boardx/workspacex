import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { deploymentExample } from "../src/index";

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const dirs: string[] = [];
const temp = () => { const dir = mkdtempSync(join(tmpdir(), "cloud-config-")); dirs.push(dir); return dir; };
const run = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", cli, ...args], { cwd: root, encoding: "utf8", timeout: 10_000 });
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("deployment CLI", () => {
  it.each(["starter", "production"] as const)("validates the %s generated example without cloud readiness claims", (profile) => {
    const generated = run("example", profile);
    expect(generated.status).toBe(0);
    const path = join(temp(), "config.json");
    writeFileSync(path, generated.stdout);
    const result = run("validate", path);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.plan.cloudVerified).toBe(false);
    expect(parsed.plan.profile).toBe(profile);
    expect(parsed.config).toBeUndefined();
    expect(result.stderr).toBe("");
  });
  it("returns multiple errors with nonzero status and no submitted secret", () => {
    const input = deploymentExample("production");
    const secret = "NEVER_PRINT_THIS_PASSWORD";
    const path = join(temp(), "bad.json");
    writeFileSync(path, JSON.stringify({ ...input, environment: { ...input.environment,
      databaseSecretRef: secret, redisSecretRef: secret, [secret]: secret,
    } }));
    const result = run("validate", path);
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout).errors.length).toBeGreaterThanOrEqual(3);
    expect(result.stdout + result.stderr).not.toContain(secret);
  });
  it.each(["malformed", "oversized"])("rejects %s input without leaking content", (kind) => {
    const path = join(temp(), "bad.json");
    writeFileSync(path, kind === "malformed" ? '{"key":"SECRET' : "SECRET".repeat(12_000));
    const result = run("validate", path);
    expect(result.status).toBe(2);
    expect(result.stdout + result.stderr).not.toContain("SECRET");
  });
  it("rejects nonexistent files, directories, unknown profiles and extra arguments", () => {
    for (const args of [["validate", join(temp(), "missing")], ["validate", temp()],
      ["example", "staging"], ["example", "starter", "--extra"], ["provision", "config.json"]]) {
      expect(run(...args).status).toBe(2);
    }
  });
  it("does not hang when given a FIFO", () => {
    const fifo = join(temp(), "pipe");
    execFileSync("mkfifo", [fifo]);
    const result = run("validate", fifo);
    expect(result.status).toBe(2);
  });
});
