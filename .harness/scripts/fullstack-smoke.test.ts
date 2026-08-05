import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveTestIsolation } from "./lib/test-isolation";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

async function runWrapper(options: {
  childExit?: number;
  dockerExit?: number;
  signal?: "SIGINT" | "SIGTERM";
}) {
  const temp = mkdtempSync(join(tmpdir(), "fullstack-cleanup-"));
  const log = join(temp, "docker.log");
  const fakeDocker = join(temp, "docker");
  writeFileSync(
    fakeDocker,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\nexit ${options.dockerExit ?? 0}\n`,
  );
  chmodSync(fakeDocker, 0o755);
  const isolation = deriveTestIsolation({ isolationId: `cleanup-${Math.random()}`, worktreePath: ROOT });
  const childScript = options.signal
    ? "setInterval(() => {}, 1000)"
    : `process.exit(${options.childExit ?? 0})`;
  const child = spawn(process.execPath, [
    "--import", "tsx", ".harness/scripts/with-test-isolation.ts", "--",
    process.execPath, "-e", childScript,
  ], {
    cwd: ROOT,
    env: { ...process.env, ...isolation, PATH: `${temp}:${process.env.PATH ?? ""}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
  const exit = new Promise<number | null>((resolveExit) => child.once("exit", resolveExit));
  try {
    if (options.signal) {
      await new Promise<void>((resolveReady, reject) => {
        const timeout = setTimeout(() => reject(new Error("wrapper did not start")), 5_000);
        child.stdout?.on("data", (chunk) => {
          if (!String(chunk).includes("[test-isolation]")) return;
          clearTimeout(timeout);
          resolveReady();
        });
      });
      child.kill(options.signal);
    }
    const code = await exit;
    const calls = readFileSync(log, "utf8").trim().split("\n");
    return { code, stdout, stderr, calls, isolation };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function expectedCleanup(composeProject: string): string {
  return `compose -f ${resolve(ROOT, "apps/api/docker-compose.dev.yml")} -p ${composeProject} down -v`;
}

describe("#387 trusted full-stack gate contract", () => {
  it("derives browser and API ports inside the same #74 isolation scope", () => {
    const a = deriveTestIsolation({ isolationId: "fullstack-a", worktreePath: ROOT });
    const b = deriveTestIsolation({ isolationId: "fullstack-b", worktreePath: ROOT });

    expect(a.WORKSPACEX_API_PORT).not.toBe(b.WORKSPACEX_API_PORT);
    expect(a.WORKSPACEX_WEB_PORT).not.toBe(b.WORKSPACEX_WEB_PORT);
    expect(new Set([
      a.PGPORT, a.REDIS_PORT, a.MINIO_PORT, a.MINIO_CONSOLE_PORT,
      a.WORKSPACEX_API_PORT, a.WORKSPACEX_WEB_PORT,
    ]).size).toBe(6);
  });

  it("exposes one isolation wrapper per public gate and never nests it in raw scripts", () => {
    const scripts = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    for (const name of ["verify:fullstack-smoke", "verify:full"] as const) {
      expect(scripts.scripts[name]).toContain("with-test-isolation.ts");
      expect(scripts.scripts[name].match(/with-test-isolation\.ts/g)).toHaveLength(1);
    }
    expect(scripts.scripts["verify:fullstack-smoke:raw"]).not.toContain("with-test-isolation");
    expect(scripts.scripts["verify:full:raw"]).not.toContain("with-test-isolation");
  });

  it("pins fresh dynamic servers and the same-origin API allowlist", () => {
    const config = read("apps/web/playwright.fullstack-smoke.config.ts");
    expect(config).toContain("WORKSPACEX_API_PORT");
    expect(config).toContain("WORKSPACEX_WEB_PORT");
    expect(config).toContain("reuseExistingServer: false");
    expect(config).toContain("next build && next start");
    expect(config).not.toContain("next dev");

    const next = read("apps/web/next.config.mjs");
    for (const path of ["/auth/", "/identity/", "/chat/", "/projects/", "/artifacts/"]) {
      expect(next).toContain(path);
    }
  });

  it("walks the real Files entry and asserts every required 2xx response", () => {
    const spec = read("apps/web/e2e/fullstack-smoke.spec.ts");
    expect(spec).toContain("javaScriptEnabled: false");
    expect(spec).toContain('headers: { RSC: "1" }');
    expect(spec).toContain("headers().location");
    expect(spec).toContain("projects-card-${FULLSTACK_E2E.projectId}-enter");
    expect(spec).toContain("project-home-surface-files");
    expect(spec).toContain("FULLSTACK_E2E.sentinelFile");
    expect(spec.match(/page\.goto\("\/login"\)/g)).toHaveLength(1);
    expect(spec.match(/page\.goto\("\/"\)/g)).toHaveLength(2);
    expect(spec.match(/page\.goto\("\/projects"\)/g)).toHaveLength(1);
    for (const key of ["login", "identity", "projects", "overview", "artifacts"]) {
      expect(spec).toContain(`${key}:`);
    }
    expect(spec).toContain('"artifact-tree":');
    expect(spec).toContain("requestfailed");
    expect(spec).toContain('message.type() === "error"');
  });

  it("keeps three anti-vacuity probes and scoped down -v cleanup mechanical", () => {
    const anti = read(".harness/scripts/verify-fullstack-anti-vacuity.ts");
    for (const mode of ["wrong-api-origin", "database-unavailable", "broken-controller-route"]) {
      expect(anti).toContain(mode);
    }
    expect(anti).toContain("expected a nonzero exit");

    const wrapper = read(".harness/scripts/with-test-isolation.ts");
    expect(wrapper).toContain('"down", "-v"');
    expect(wrapper).toContain("COMPOSE_PROJECT_NAME");
    expect(wrapper).toContain("SIGTERM");
  });

  it("CI jobs execute the public scripts and retain success or failure evidence", () => {
    const workflow = read(".github/workflows/harness-verify.yml");
    expect(workflow).toMatch(/^  fullstack-smoke:\n/m);
    expect(workflow).toMatch(/^  e2e-full:\n/m);
    expect(workflow).toContain("pnpm run verify:fullstack-smoke");
    expect(workflow).toContain("TURBO_FORCE=true pnpm run verify:full");
    // 本条要的是「两个证据上传步骤在失败时也跑」。此前写成 `if: always()` 在全文里
    // 恰好出现 2 次 —— 那是意图的代用品，而不是意图本身：#512 给 e2e-full 加了一个
    // 独立信号步骤（Chat 链路，同样要 always()），代用品当场误报，而真正要守的两个
    // 上传步骤一个都没动。改成把 always() 直接绑在 upload-artifact 上，比数数更严。
    expect(workflow.match(/if: always\(\)\n\s+uses: actions\/upload-artifact@v4/g)).toHaveLength(2);
    expect(workflow).toContain("phase-01-fullstack-smoke-evidence");
    expect(workflow).toContain("phase-01-e2e-full-evidence");
    expect(read(".harness/scripts/verify-readiness-evidence.ts")).toContain("manifest.commit !== target");
  });

  it.each([
    ["successful child", { childExit: 0 }, 0],
    ["failed child", { childExit: 7 }, 7],
    ["SIGTERM", { signal: "SIGTERM" as const }, 143],
  ])("%s runs one successful scoped down -v and preserves the child outcome", async (_name, options, expected) => {
    const result = await runWrapper(options);
    expect(result.code).toBe(expected);
    expect(result.stderr).not.toContain("cleanup failed");
    expect(result.calls).toEqual([expectedCleanup(result.isolation.COMPOSE_PROJECT_NAME)]);
  });

  it.each([
    ["successful child", { childExit: 0, dockerExit: 42 }, 1],
    ["failed child", { childExit: 7, dockerExit: 42 }, 7],
    ["SIGINT", { signal: "SIGINT" as const, dockerExit: 42 }, 130],
    ["SIGTERM", { signal: "SIGTERM" as const, dockerExit: 42 }, 143],
  ])("%s fails closed when its only scoped down -v fails", async (_name, options, expected) => {
    const result = await runWrapper(options);
    expect(result.code).toBe(expected);
    expect(result.stderr).toContain("cleanup failed: docker compose down -v exited 42");
    expect(result.calls).toEqual([expectedCleanup(result.isolation.COMPOSE_PROJECT_NAME)]);
  });
});
