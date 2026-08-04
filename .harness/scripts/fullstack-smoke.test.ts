import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveTestIsolation } from "./lib/test-isolation";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

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

    const next = read("apps/web/next.config.mjs");
    for (const path of ["/auth/", "/identity/", "/chat/", "/projects/", "/artifacts/"]) {
      expect(next).toContain(path);
    }
  });

  it("walks the real Files entry and asserts every required 2xx response", () => {
    const spec = read("apps/web/e2e/fullstack-smoke.spec.ts");
    expect(spec).toContain("projects-card-${FULLSTACK_E2E.projectId}-enter");
    expect(spec).toContain("project-home-surface-files");
    expect(spec).toContain("FULLSTACK_E2E.sentinelFile");
    expect(spec.match(/page\.goto\(/g)).toHaveLength(1);
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
    expect(workflow.match(/if: always\(\)/g)).toHaveLength(2);
    expect(workflow).toContain("phase-01-fullstack-smoke-evidence");
    expect(workflow).toContain("phase-01-e2e-full-evidence");
    expect(read(".harness/scripts/verify-readiness-evidence.ts")).toContain("manifest.commit !== target");
  });

  it("SIGTERM runs exactly one down -v for only the inherited compose project", async () => {
    const temp = mkdtempSync(join(tmpdir(), "fullstack-cleanup-"));
    try {
      const log = join(temp, "docker.log");
      const fakeDocker = join(temp, "docker");
      writeFileSync(fakeDocker, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\n`);
      chmodSync(fakeDocker, 0o755);
      const isolation = deriveTestIsolation({ isolationId: "sigterm-proof", worktreePath: ROOT });
      const child = spawn(process.execPath, [
        "--import", "tsx", ".harness/scripts/with-test-isolation.ts", "--",
        process.execPath, "-e", "setInterval(() => {}, 1000)",
      ], {
        cwd: ROOT,
        env: { ...process.env, ...isolation, PATH: `${temp}:${process.env.PATH ?? ""}` },
        stdio: ["ignore", "pipe", "pipe"],
      });
      await new Promise((resolveReady, reject) => {
        const timeout = setTimeout(() => reject(new Error("wrapper did not start")), 5_000);
        child.stdout.on("data", (chunk) => {
          if (!String(chunk).includes("[test-isolation]")) return;
          clearTimeout(timeout);
          resolveReady(undefined);
        });
      });
      child.kill("SIGTERM");
      const code = await new Promise<number | null>((resolveExit) => child.once("exit", resolveExit));
      expect(code).toBe(143);
      const calls = readFileSync(log, "utf8").trim().split("\n");
      expect(calls).toEqual([
        `compose -f ${resolve(ROOT, "apps/api/docker-compose.dev.yml")} -p ${isolation.COMPOSE_PROJECT_NAME} down -v`,
      ]);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
