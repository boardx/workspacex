import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assertDatabaseCapacity, assertIsolatedDatabase, deriveTestIsolation, ensureTestIsolation } from "./test-isolation";

const ROOT = resolve(import.meta.dirname, "../../..");

function turboApiTestHash(env: Record<string, string>): string {
  const result = spawnSync(
    "pnpm",
    ["exec", "turbo", "run", "test", "--filter=@repo/api", "--dry=json"],
    {
      cwd: ROOT,
      env: { ...process.env, TURBO_TELEMETRY_DISABLED: "1", ...env },
      encoding: "utf8",
    },
  );
  if (result.status !== 0) throw new Error(`turbo dry run failed: ${result.stderr}`);
  const dryRun = JSON.parse(result.stdout) as {
    tasks: Array<{ package: string; task: string; hash: string }>;
  };
  const task = dryRun.tasks.find((entry) => entry.package === "@repo/api" && entry.task === "test");
  if (!task) throw new Error("turbo dry run did not include @repo/api#test");
  return task.hash;
}

describe("test isolation contract (#74)", () => {
  it("reuses every derived resource for the same explicit isolation id", () => {
    const first = deriveTestIsolation({
      isolationId: "reuse-proof",
      worktreePath: "/tmp/worktree-a",
    });
    const second = deriveTestIsolation({
      isolationId: "reuse-proof",
      worktreePath: "/tmp/worktree-a",
    });

    expect(second).toEqual(first);
    expect(first.PGDATABASE).toBe(first.WORKSPACEX_DB);
    expect(first.REDIS_PREFIX).toContain(first.WORKSPACEX_ISOLATION_ID);
  });

  it("isolates separate runs and separate worktrees", () => {
    const runA = deriveTestIsolation({ isolationId: "run-a", worktreePath: "/tmp/worktree-a" });
    const runB = deriveTestIsolation({ isolationId: "run-b", worktreePath: "/tmp/worktree-a" });
    const treeB = deriveTestIsolation({ isolationId: "run-a", worktreePath: "/tmp/worktree-b" });

    for (const key of ["WORKSPACEX_DB", "COMPOSE_PROJECT_NAME", "PGPORT", "REDIS_PORT"] as const) {
      expect(runA[key]).not.toBe(runB[key]);
      expect(runA[key]).not.toBe(treeB[key]);
    }
  });

  it("does not collide when distinct raw ids normalize to the same safe prefix", () => {
    const slash = deriveTestIsolation({ isolationId: "feature/74", worktreePath: "/tmp/worktree-a" });
    const dash = deriveTestIsolation({ isolationId: "feature-74", worktreePath: "/tmp/worktree-a" });

    for (const key of [
      "WORKSPACEX_ISOLATION_ID",
      "WORKSPACEX_DB",
      "COMPOSE_PROJECT_NAME",
      "PGPORT",
      "REDIS_PORT",
      "REDIS_PREFIX",
    ] as const) {
      expect(slash[key]).not.toBe(dash[key]);
    }
  });

  it("generates safe PostgreSQL names and non-overlapping valid port bands", () => {
    const env = deriveTestIsolation({
      isolationId: "Feature/74: spaces and punctuation!".repeat(8),
      worktreePath: "/tmp/worktree-a",
    });

    expect(env.WORKSPACEX_DB).toMatch(/^[a-z_][a-z0-9_]{0,62}$/);
    expect(env.WORKSPACEX_DB.length).toBeLessThanOrEqual(63);
    const ports = [env.PGPORT, env.REDIS_PORT, env.MINIO_PORT, env.MINIO_CONSOLE_PORT].map(Number);
    expect(new Set(ports).size).toBe(ports.length);
    for (const port of ports) expect(port).toBeGreaterThanOrEqual(10_000);
    for (const port of ports) expect(port).toBeLessThanOrEqual(65_535);
  });

  it("creates a new run by default but preserves an inherited run", () => {
    const inherited = ensureTestIsolation(
      { WORKSPACEX_ISOLATION_ID: "parent-run" },
      { worktreePath: "/tmp/worktree-a" },
    );
    const inheritedAgain = ensureTestIsolation(
      { WORKSPACEX_ISOLATION_ID: "parent-run" },
      { worktreePath: "/tmp/worktree-a" },
    );
    const freshA = ensureTestIsolation({}, { worktreePath: "/tmp/worktree-a" });
    const freshB = ensureTestIsolation({}, { worktreePath: "/tmp/worktree-a" });

    expect(inheritedAgain).toEqual(inherited);
    expect(inherited.WORKSPACEX_ISOLATION_ID).toMatch(/^parent-run-[a-f0-9]{12}$/);
    expect(freshA.WORKSPACEX_ISOLATION_ID).not.toBe(freshB.WORKSPACEX_ISOLATION_ID);
  });

  it("is idempotent when a derived scope is nested through another wrapper", () => {
    const outer = ensureTestIsolation({}, { worktreePath: "/tmp/worktree-a" });
    const inner = ensureTestIsolation({ ...outer }, { worktreePath: "/tmp/worktree-a" });

    expect(inner).toEqual(outer);
    expect(inner.WORKSPACEX_DB).toBe(outer.WORKSPACEX_DB);
    expect(inner.COMPOSE_PROJECT_NAME).toBe(outer.COMPOSE_PROJECT_NAME);
  });

  it("wires init, pre-push and harness verify through the same helper", () => {
    const init = readFileSync(resolve(ROOT, "init.sh"), "utf8");
    const verify = readFileSync(resolve(ROOT, ".harness/scripts/verify.ts"), "utf8");
    const packageJson = readFileSync(resolve(ROOT, "package.json"), "utf8");

    expect(init).toContain("with-test-isolation");
    expect(init).toContain("git rev-parse --git-path hooks/pre-push");
    expect(init).not.toContain('if [ -d ".git" ]');
    // #468：入口从 ensureTestIsolation 换成 ensureReservedTestIsolation（端口改为
    // 向 OS 预留）。本条断言的意图是「verify 必须经共用的隔离 helper，而不是自己
    // 拼一套 env」——钉死具体函数名会让一次正当的改名撞红，而意图毫发无损。
    expect(verify).toMatch(/ensure(Reserved)?TestIsolation/);
    expect(verify).toContain('from "./lib/test-isolation"');
    expect(verify).toContain("WORKSPACEX_VERIFY_OUTER_DB");
    expect(verify).toContain("WORKSPACEX_VERIFY_OUTER_COMPOSE");
    expect(packageJson).toContain("with-test-isolation");
  });

  it("asserts the harness verify outer and inner scopes match at wrapper runtime", () => {
    const outer = deriveTestIsolation({ isolationId: "verify-nested", worktreePath: ROOT });
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        ".harness/scripts/with-test-isolation.ts",
        "--",
        process.execPath,
        "-e",
        "process.exit(0)",
      ],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          ...outer,
          WORKSPACEX_VERIFY_OUTER_DB: outer.WORKSPACEX_DB,
          WORKSPACEX_VERIFY_OUTER_COMPOSE: outer.COMPOSE_PROJECT_NAME,
          WORKSPACEX_KEEP_TEST_STACK: "1",
        },
        encoding: "utf8",
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      `[harness-isolation] outer_db=${outer.WORKSPACEX_DB} inner_db=${outer.WORKSPACEX_DB} ` +
      `outer_compose=${outer.COMPOSE_PROJECT_NAME} inner_compose=${outer.COMPOSE_PROJECT_NAME} status=matched`,
    );
  });

  it("caps Vitest's actual default forks pool via maxWorkers", () => {
    // 2026-08-12（项目 Agent 两轮定位）：这条断言原本钉死 `maxWorkers: 4` 这个
    // 字面值，而用例名说的是性质——「有上限」。第一次踩坑：4→1（DDL/RLS 重的
    // 测试文件在 4 个并行 fork 间死锁，`DROP POLICY` 的 AccessExclusiveLock 与
    // 另一 worker 的行锁互等成环，两轮同代码红不同文件的判据 + 锁等待日志逐字
    // 印证），断言钉的还是字面值，只是换了个数字——下一次调优同样会撞红。
    // 改断言性质本身：必须显式设（否则 forks 池按 CPU 数无限开，打爆共享库）
    // 且不超过当初定 4 时论证过的 PostgreSQL 并发预算上界（见本文件 ~68 行注释
    // "keeps the PostgreSQL budget mechanical"）。1–4 之间调优不再惊动这道门；
    // 改上界本身仍然会红——那才是需要重新论证预算的时候。
    const config = readFileSync(resolve(ROOT, "apps/api/vitest.config.ts"), "utf8");
    const m = config.match(/maxWorkers:\s*(\d+)/);
    expect(m, "apps/api/vitest.config.ts 必须显式设 maxWorkers（否则 forks 池按 CPU 数无限开，会打爆共享库）").not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(1);
    expect(Number(m![1])).toBeLessThanOrEqual(4);
    expect(config).not.toMatch(/threads:\s*\{[\s\S]*maxThreads/);
  });

  it("hashes isolation inputs into Turbo's test cache key", () => {
    const config = readFileSync(resolve(ROOT, "turbo.json"), "utf8");
    const testTask = config.match(/"test"\s*:\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? "";

    expect(testTask).toContain('"env"');
    for (const name of [
      "WORKSPACEX_ISOLATION_ID",
      "WORKSPACEX_DB",
      "PGDATABASE",
      "PGPORT",
      "REDIS_PORT",
      "REDIS_PREFIX",
      "COMPOSE_PROJECT_NAME",
    ]) {
      expect(testTask).toContain(`"${name}"`);
    }

    const baseline = deriveTestIsolation({ isolationId: "turbo-cache-a", worktreePath: ROOT });
    const baselineHash = turboApiTestHash(baseline);
    expect(turboApiTestHash(baseline)).toBe(baselineHash);
    for (const name of [
      "WORKSPACEX_DB",
      "PGDATABASE",
      "PGPORT",
      "REDIS_PORT",
      "REDIS_PREFIX",
      "MINIO_PORT",
      "MINIO_CONSOLE_PORT",
      "COMPOSE_PROJECT_NAME",
    ] as const) {
      expect(turboApiTestHash({ ...baseline, [name]: `${baseline[name]}-changed` })).not.toBe(baselineHash);
    }
  });

  it("fails fast when PostgreSQL cannot satisfy the declared connection budget", () => {
    expect(() => assertDatabaseCapacity({
      maxConnections: 100,
      reservedConnections: 3,
      currentConnections: 80,
      requiredConnections: 32,
    })).toThrow(/available=17.*required=32/);

    expect(() => assertDatabaseCapacity({
      maxConnections: 100,
      reservedConnections: 3,
      currentConnections: 5,
      requiredConnections: 32,
    })).not.toThrow();
  });
});

describe("#538 未隔离跑法当场失败", () => {
  const hintNeedle = "with-test-isolation.ts";

  it("没有 WORKSPACEX_DB —— 裸跑 turbo/vitest 的形态 —— 必须抛，且指出正确跑法", () => {
    expect(() => assertIsolatedDatabase({ resolvedDatabase: "workspacex", env: {} }))
      .toThrow(/未在隔离外壳里运行/);
    try {
      assertIsolatedDatabase({ resolvedDatabase: "workspacex", env: {} });
    } catch (e) {
      const message = (e as Error).message;
      // 报错必须**可行动**：既说清连的是哪个库，也给出该怎么跑
      expect(message).toContain("workspacex");
      expect(message).toContain(hintNeedle);
    }
  });

  it("有隔离环境、但实际连的不是它（有人覆盖了 PGDATABASE）—— 也必须抛", () => {
    // 这比完全没隔离更危险：日志看起来是隔离的，落点却不是
    expect(() => assertIsolatedDatabase({
      resolvedDatabase: "workspacex",
      env: { WORKSPACEX_DB: "wsx_abc123" } as NodeJS.ProcessEnv,
    })).toThrow(/隔离环境与实际连接不一致/);
  });

  it("隔离环境一致时安静通过（否则上面两条是空转）", () => {
    expect(() => assertIsolatedDatabase({
      resolvedDatabase: "wsx_abc123",
      env: { WORKSPACEX_DB: "wsx_abc123" } as NodeJS.ProcessEnv,
    })).not.toThrow();
  });

  it("没有任何豁免开关 —— 能被环境变量关掉的隔离检查，第一次撞红就会被关掉", () => {
    const source = readFileSync(resolve(ROOT, ".harness/scripts/lib/test-isolation.ts"), "utf8");
    const fn = source.slice(source.indexOf("export function assertIsolatedDatabase"));
    const body = fn.slice(0, fn.indexOf("\n}\n") + 1);
    // 函数体内除了 WORKSPACEX_DB 之外不得读取任何 env（那就是一个开关）
    const envReads = [...body.matchAll(/env\.([A-Z_]+)/g)].map((m) => m[1]);
    expect([...new Set(envReads)]).toEqual(["WORKSPACEX_DB"]);
    expect(body).not.toMatch(/SKIP|ALLOW|FORCE|BYPASS|DISABLE/i);
  });
});
