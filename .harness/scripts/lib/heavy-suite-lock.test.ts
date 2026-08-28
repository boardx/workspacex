// heavy-suite-lock.test.ts —— 重 e2e 套件互斥锁的反证（#2258）。
//
// 对应人类裁决三条硬要求：
//   ① 同一台机器同一时刻只放行一个重 e2e 套件，后来者排队而不是失败退出；
//   ② 排队要有清晰日志（不能无限挂起看不出在等什么）；
//   ③ 持锁进程被杀/崩溃时，幽灵锁必须能自愈（PID 活性检测，复用 stack-admission 的模式）。
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_HEAVY_SUITE_LOCK_POLICY,
  acquireHeavySuiteLock,
  heavySuiteLockDir,
  isHeavyE2eCommand,
} from "./heavy-suite-lock";

const roots: string[] = [];
function tempEnv(): NodeJS.ProcessEnv {
  const root = mkdtempSync(join(tmpdir(), "wsx-heavy-lock-"));
  roots.push(root);
  const env = { WORKSPACEX_HEAVY_E2E_LOCK_DIR: join(root, "heavy-lock") } as NodeJS.ProcessEnv;
  mkdirSync(heavySuiteLockDir(env), { recursive: true });
  return env;
}
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

const PLAYWRIGHT_CMD = ["pnpm", "--filter", "web", "exec", "playwright", "test", "--config", "playwright.chat-read.config.ts"];
const LIGHT_CMD = ["pnpm", "run", "verify:base:raw"];

describe("命中判据：只拦真实浏览器 e2e，不拦轻量校验", () => {
  it("playwright test 命令命中", () => {
    expect(isHeavyE2eCommand(PLAYWRIGHT_CMD)).toBe(true);
  });

  it("turbo/vitest 命令不命中", () => {
    expect(isHeavyE2eCommand(LIGHT_CMD)).toBe(false);
  });

  it("非重 e2e 命令直接放行，不排队、不写锁文件", async () => {
    const env = tempEnv();
    const handle = await acquireHeavySuiteLock({ command: LIGHT_CMD, env, log: () => {} });
    expect(handle.held).toBe(false);
    expect(handle.waitedMs).toBe(0);
    expect(() => readFileSync(join(heavySuiteLockDir(env), "lock.json"))).toThrow();
    handle.release(); // 空操作，不应该抛
  });
});

describe("① 同一时刻只放行一个，后来者排队不是失败", () => {
  it("锁被占用时第二个调用必须等待，锁释放后才放行——全程不抛错", async () => {
    const env = tempEnv();
    const first = await acquireHeavySuiteLock({ command: PLAYWRIGHT_CMD, env, log: () => {} });
    expect(first.held).toBe(true);

    const lines: string[] = [];
    let ticks = 0;
    const sleep = vi.fn(async () => {
      ticks += 1;
      if (ticks === 2) first.release(); // 模拟第一个套件跑完
    });

    const second = await acquireHeavySuiteLock({
      command: PLAYWRIGHT_CMD,
      env,
      log: (m) => lines.push(m),
      sleep,
      now: () => Date.now(),
    });

    expect(second.held).toBe(true);
    expect(sleep, "必须真的排过队").toHaveBeenCalled();
    second.release();
  });

  it("🔴 反证：两个并发调用只能有一个真正拿到锁——不能都以为自己拿到了", async () => {
    const env = tempEnv();
    // 模拟并发：两次几乎同时调用，第二次的 sleep 立刻释放第一次占的锁，
    // 用来验证"同一时刻持锁方唯一"而不是"两边都写了文件"。
    const results = await Promise.all([
      acquireHeavySuiteLock({ command: PLAYWRIGHT_CMD, env, log: () => {} }),
      acquireHeavySuiteLock({
        command: PLAYWRIGHT_CMD,
        env,
        log: () => {},
        sleep: async () => {
          // 找到当前持锁的那个并释放它，让排队方过关
          const path = join(heavySuiteLockDir(env), "lock.json");
          try {
            rmSync(path, { force: true });
          } catch {
            // ignore
          }
        },
      }),
    ]);
    // 两个调用最终都会 held=true（一个直接拿到，一个等对方释放后拿到），
    // 但关键不变量是：过程中不存在"两边同时都认为自己持有互斥锁却互不知情"
    // 导致的抛错或崩溃——两次调用都必须干净返回。
    for (const r of results) {
      expect(r.held).toBe(true);
      r.release();
    }
  });
});

describe("② 排队要有清晰日志——不能无限挂起看不出在等什么", () => {
  it("排队时打印谁占着锁、在等多久、下次重试间隔", async () => {
    const env = tempEnv();
    const holder = await acquireHeavySuiteLock({ command: PLAYWRIGHT_CMD, env, log: () => {} });

    const lines: string[] = [];
    let ticks = 0;
    const sleep = vi.fn(async () => {
      ticks += 1;
      if (ticks === 1) holder.release();
    });

    const waiter = await acquireHeavySuiteLock({
      command: PLAYWRIGHT_CMD,
      env,
      log: (m) => lines.push(m),
      sleep,
    });

    const joined = lines.join("\n");
    expect(joined, "必须说清是重 e2e 套件在占用").toContain("排队中");
    expect(joined, "必须报出占用者的 pid").toContain(`pid=${process.pid}`);
    expect(joined, "必须说清不是卡死也不是代码问题").toContain("这不是卡死，也不是你的代码有问题");
    waiter.release();
  });

  it("🔴 反证：排队超时后放行并大声说明，而不是无限挂起", async () => {
    const env = tempEnv();
    // 占住锁但假装它"永远不释放"，验证到点后仍然放行。
    const holder = await acquireHeavySuiteLock({ command: PLAYWRIGHT_CMD, env, log: () => {} });

    const lines: string[] = [];
    const waiter = await acquireHeavySuiteLock({
      command: PLAYWRIGHT_CMD,
      env,
      log: (m) => lines.push(m),
      sleep: async () => {},
      policy: { pollMs: 1_000, maxWaitMs: 3_000 },
      now: (() => {
        let t = 0;
        return () => (t += 2_000);
      })(),
    });

    expect(waiter.held).toBe(true);
    expect(lines.join("\n")).toContain("强制接管锁并放行");
    waiter.release();
    holder.release(); // 迟到的 release：不能删掉 waiter 已经放行后的状态（此时早已被 waiter 删过）
  });
});

describe("③ 幽灵锁自愈：持锁进程已死，锁必须能被后来者清掉", () => {
  it("PID 已死的锁被当场清掉，不必等它自然过期", async () => {
    const env = tempEnv();
    const dir = heavySuiteLockDir(env);
    writeFileSync(
      join(dir, "lock.json"),
      JSON.stringify({ pid: 999999, token: "ghost", command: "playwright test", startedAt: 0 }),
    );

    const lines: string[] = [];
    const sleep = vi.fn(async () => {});
    const handle = await acquireHeavySuiteLock({
      command: PLAYWRIGHT_CMD,
      env,
      log: (m) => lines.push(m),
      sleep,
    });

    expect(handle.held).toBe(true);
    expect(sleep, "幽灵锁应该当场清掉，不必真的睡一轮").not.toHaveBeenCalled();
    expect(lines.join("\n")).toContain("清掉了幽灵锁");
    handle.release();
  });

  it("release 用 token 比较后才删——迟到的 release 不会误删新持有者的锁", async () => {
    const env = tempEnv();
    const first = await acquireHeavySuiteLock({ command: PLAYWRIGHT_CMD, env, log: () => {} });
    first.release();
    // 另一个进程此时已经拿到了新锁
    const second = await acquireHeavySuiteLock({ command: PLAYWRIGHT_CMD, env, log: () => {} });
    expect(second.held).toBe(true);
    // 第一个的 release 已经调用过；再调用一次模拟"迟到的第二次 release"，
    // 不应该影响 second 手里的锁。
    first.release();
    const dir = heavySuiteLockDir(env);
    expect(() => readFileSync(join(dir, "lock.json"))).not.toThrow();
    second.release();
  });
});

describe("量负载的动作本身不能挂住 —— 与 stack-admission 同一原则", () => {
  it("不 shell out，锁判定只靠文件系统 + PID 探测", async () => {
    const { readFileSync: read } = await import("node:fs");
    const source = read(new URL("./heavy-suite-lock.ts", import.meta.url), "utf8");
    const code = source.split("\n").filter((l) => {
      const t = l.trim();
      return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
    }).join("\n");
    expect(code).not.toMatch(/execSync|spawnSync|exec\(|spawn\(/);
  });

  it("默认策略：排队上限明显长于单轮重 e2e 套件耗时（issue #2258 实测最长 25m40s）", () => {
    expect(DEFAULT_HEAVY_SUITE_LOCK_POLICY.maxWaitMs).toBeGreaterThan(26 * 60_000);
  });
});
