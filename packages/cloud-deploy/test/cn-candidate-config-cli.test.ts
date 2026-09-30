import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
const directory = fileURLToPath(new URL("..", import.meta.url));
describe("candidate configuration CLI", () => {
  it.each([[], ["unknown", "secret-that-must-not-appear"], ["prepare", "not-a-sha", "2026.9.30-cn.1", "123-1"], ["commit", "a".repeat(40), "2026.9.30-cn.1", "123-1", "secret-that-must-not-appear"]].map(args => ({ args })))("rejects invalid arguments without secrets or filesystem mutations: %j", ({ args }) => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "src/cn-candidate-config-cli.ts", ...args], { cwd: directory, encoding: "utf8", timeout: 5000 });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim()).toBe(JSON.stringify({ ok: false, reason: "candidate_configuration_rejected" }));
  });
});
