import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
const root = process.cwd();
it("rejects any extra or replacement command before starting the isolated runner", () => {
  for (const args of [["--", "echo", "1 passed"], ["--", "pnpm", "--filter", "web", "exec", "playwright", "test", "--config", "playwright.skill-files.config.ts", "--list"]]) {
    const result = spawnSync(process.execPath, ["scripts/studio-skill-files-e2e.mjs", ...args], { cwd: root, encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Only the fixed skill-files browser command is supported");
    expect(result.stdout).not.toContain("BROWSER_PASS");
  }
});
it("lists the actual single spec without credentials but still refuses execution without explicit lane", () => {
  const env = { ...process.env };
  delete env.STUDIO_LANE; delete env.STUDIO_EVIDENCE_DIR; delete env.E2E_BASE_URL; delete env.STUDIO_API_BASE_URL;
  const args = ["exec", "playwright", "test", "--config", "playwright.skill-files.config.ts"];
  const listed = execFileSync("pnpm", [...args, "--list", "--reporter=json"], { cwd: resolve(root, "apps/web"), env, encoding: "utf8" });
  const report = JSON.parse(listed.slice(listed.indexOf("{")));
  expect(report.suites).toHaveLength(1);
  expect(report.suites[0].file).toBe("skill-file-pin-live.spec.ts");
  const executed = spawnSync("pnpm", args, { cwd: resolve(root, "apps/web"), env, encoding: "utf8" });
  expect(executed.status).not.toBe(0);
  expect(executed.stderr).toContain("Enable this lane explicitly");
  const disguised = spawnSync("pnpm", [...args, "--grep-invert", "--list", "--reporter=json"], { cwd: resolve(root, "apps/web"), env, encoding: "utf8" });
  expect(disguised.status).not.toBe(0);
  expect(disguised.stderr).toContain("Enable this lane explicitly");
});
it("CI executes the exact allowed command with isolation and retains failures as artifacts", () => {
  const workflow = readFileSync(resolve(root, ".github/workflows/skill-files-e2e.yml"), "utf8");
  expect(workflow).toContain("pull_request:"); expect(workflow).toContain("workflow_dispatch:");
  expect(workflow).not.toContain("continue-on-error"); expect(workflow).not.toContain("paths:");
  expect(workflow).toContain("pnpm exec tsx .harness/scripts/with-test-isolation.ts -- node scripts/studio-skill-files-e2e.mjs -- pnpm --filter web exec playwright test --config playwright.skill-files.config.ts");
  expect(workflow).toContain("if: always()"); expect(workflow).toContain("if-no-files-found: error");
});
