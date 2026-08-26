import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveTestIsolation } from "./lib/test-isolation";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

/**
 * 2026-08-12（#1010 项目 Agent 定论）：`harness verify` 的顺序是「先跑各 feature
 * verification 再跑 verify:base」，而有的 feature 验证会起完整 Next dev server——
 * load 的衰减均值在 kill 后仍高位停留数分钟，紧接着本套件并行 63 文件，spawn 就绪窗口被压垮：同机同 SHA，单独跑 13/13 连绿三次，verify 序列里 7 条
 * 全红且全部卡在 5.00–5.02s 的「wrapper did not start」，无一条是断言失败。
 *
 * 修法是**只对就绪超时重试一次（换新进程）**，不是调大常数：真「wrapper 起不来」
 * （with-test-isolation.ts 坏了）两次都起不来，门照响；负载尖峰下第二次通常落在尖峰衰减之后。断言失败永不重试。
 * 就绪窗口 10s/次（#1010 实测 load≈28 时 5s×2 仍被压穿；窗口是「标记何时打印」的
 * 预算不是门义，真死 wrapper 两次都不会打印标记）。
 */
async function runWrapper(options: {
  childExit?: number;
  dockerExit?: number;
  signal?: "SIGINT" | "SIGTERM";
}) {
  try {
    return await runWrapperOnce(options);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "wrapper did not start") throw error;
    return await runWrapperOnce(options);
  }
}

async function runWrapperOnce(options: {
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
    "--import", "tsx", ".harness/scripts/fixtures/with-test-isolation-fixture.ts", "--",
    process.execPath, "-e", childScript,
  ], {
    cwd: ROOT,
    env: {
      ...process.env,
      ...isolation,
      // This fixture deliberately starts a standalone wrapper scope. When the
      // suite itself runs inside `harness verify`, the parent's match markers
      // describe a different scope and must not leak into this child fixture.
      WORKSPACEX_VERIFY_OUTER_DB: undefined,
      WORKSPACEX_VERIFY_OUTER_COMPOSE: undefined,
      PATH: `${temp}:${process.env.PATH ?? ""}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
  const exit = new Promise<number | null>((resolveExit) => child.once("exit", resolveExit));
  try {
    if (options.signal) {
      try {
        await new Promise<void>((resolveReady, reject) => {
          const timeout = setTimeout(() => reject(new Error("wrapper did not start")), 10_000);
          child.stdout?.on("data", (chunk) => {
            if (!String(chunk).includes("[test-isolation]")) return;
            clearTimeout(timeout);
            resolveReady();
          });
        });
      } catch (error) {
        // 就绪超时的子进程还活着（keep-alive childScript），重试前必须收尸，
        // 否则「重试一次」会把泄漏翻倍——恰好加重它想解决的负载问题。
        child.kill("SIGKILL");
        // 2026-08-12（#1032 修法3）：stdout/stderr 被捕获进变量不转发，导致
        // 「wrapper 卡在哪一步」永远隐形——今晚四轮误诊的共同放大器。失败时如实吐出。
        console.error(`[fullstack-smoke] wrapper ready-timeout; captured stdout:\n${stdout}\ncaptured stderr:\n${stderr}`);
        throw error;
      }
      child.kill(options.signal);
    }
    // 非 signal 路径同样要可诊断：vitest 60s 挂钟杀测试时什么都不吐。自设 55s
    // 看门狗抢在挂钟前 dump 捕获的输出并收尸（#1032 修法3 的另一半）。
    const code = await Promise.race([
      exit,
      new Promise<never>((_, reject) => setTimeout(() => {
        console.error(`[fullstack-smoke] wrapper exit-timeout(55s); captured stdout:\n${stdout}\ncaptured stderr:\n${stderr}`);
        child.kill("SIGKILL");
        reject(new Error("wrapper did not exit within 55s"));
      }, 55_000).unref?.() ?? undefined),
    ]);
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

  it("keeps lifecycle fixtures deterministic without exposing an admission bypass to package scripts", () => {
    const scripts = JSON.stringify(JSON.parse(read("package.json")) as { scripts: Record<string, string> });
    const wrapper = read(".harness/scripts/with-test-isolation.ts");
    const fixture = read(".harness/scripts/fixtures/with-test-isolation-fixture.ts");

    expect(scripts).not.toContain("with-test-isolation-fixture");
    expect(wrapper).toContain("acquireSlot: acquireStackSlot");
    expect(fixture).toContain("acquireSlot: async () =>");
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
    // 本条要的是「每个真正的证据上传步骤在失败时也跑」。此前写成 `if: always()` 在全文里
    // 恰好出现 2 次 —— 那是意图的代用品，而不是意图本身：#512 给 e2e-full 加了一个
    // 独立信号步骤（Chat 链路，同样要 always()），代用品当场误报，而真正要守的两个
    // 上传步骤一个都没动。改成把 always() 直接绑在 upload-artifact 上，比数数更严。
    //
    // 2026-08-26（issue #2114）：3 —— 新增第三个 job `chat-task-workbench`（记分牌车道，
    // 只在 workflow_dispatch 手动勾选时跑，不在 pull_request/push/schedule 上跑），
    // 它自己的证据上传步骤同样需要 always()（记分牌红了也要能看到 test-results 截图），
    // 是真实新增的第三个「always() + upload-artifact」配对，不是漂移或误加。
    expect(workflow.match(/if: always\(\)\n\s+uses: actions\/upload-artifact@v4/g)).toHaveLength(3);
    expect(workflow).toContain("phase-01-fullstack-smoke-evidence");
    expect(workflow).toContain("phase-01-e2e-full-evidence");
    expect(workflow).toContain("phase-01-chat-task-workbench-evidence");
    expect(read(".harness/scripts/verify-readiness-evidence.ts")).toContain("manifest.commit !== target");
  });

  it("keeps the chat-task-workbench scorecard lane opt-in and off the blocking path (issue #2114)", () => {
    const workflow = read(".github/workflows/harness-verify.yml");
    expect(workflow).toMatch(/^  chat-task-workbench:\n/m);
    // 只认 workflow_dispatch 且显式勾选，默认 false：不会随普通 dispatch（比如只想跑
    // e2e-full）顺带被拉起,也绝不会出现在 pull_request/push/schedule 触发的运行里。
    expect(workflow).toContain("run_chat_task_workbench:");
    expect(workflow).toContain("default: false");
    expect(workflow).toContain("if: github.event_name == 'workflow_dispatch' && inputs.run_chat_task_workbench");
    // ⚠⚠ 同 run_e2e_full 那个坑（#2121）：必须是 `inputs.x`，不能是
    // `github.event.inputs.x`（后者对 boolean 输入返回字符串 "false"，在 `if` 里恒真）。
    expect(workflow).not.toContain("github.event.inputs.run_chat_task_workbench");
    expect(workflow).toContain("pnpm run verify:chat-task-workbench");
    // 阻塞路径（verify:chat-read:raw，被 e2e-full 的 `pnpm run verify:chat-read` 调用）
    // 必须显式收窄到 chat-read project，否则记分牌会继续随 e2e-full 一起跑、白拆。
    const scripts = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(scripts.scripts["verify:chat-read:raw"]).toContain("--project=chat-read");
    expect(scripts.scripts["verify:chat-task-workbench:raw"]).toContain("--project=chat-task-workbench");
    expect(scripts.scripts["verify:chat-task-workbench"]).toContain("with-test-isolation.ts");
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
