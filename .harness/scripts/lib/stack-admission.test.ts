// stack-admission.test.ts —— 并行度准入的反证。
//
// 三条硬要求逐条对应（coord-main 2026-08-05）：
//   ① 必须排队而不是拒绝 —— 拒绝会让 agent 以为自己写错了
//   ② 阈值能被反证 —— 设成 0，任何一次起栈必须当场排队并打印原因
//   ③ 起栈前打印 load 与已存在栈数 —— 饥饿时它至少要说得出来自己在饥饿
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_POLICY,
  acquireStackSlot,
  activeStacks,
  decide,
  leaseDir,
  resolvePolicy,
} from "./stack-admission";

const roots: string[] = [];
/**
 * 一个本用例独占的租约目录。#1704 之后租约位置由 `WORKSPACEX_STACK_LEASE_DIR` 决定
 * （默认机器全局），所以测试要显式注入一个干净目录，而不是靠"每个 repoRoot 一份"
 * 那个已经被证伪的隐含假设。
 */
function tempEnv(): NodeJS.ProcessEnv {
  const root = mkdtempSync(join(tmpdir(), "wsx-admission-"));
  roots.push(root);
  const env = { WORKSPACEX_STACK_LEASE_DIR: join(root, "stacks") } as NodeJS.ProcessEnv;
  mkdirSync(leaseDir(env), { recursive: true });
  return env;
}
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

describe("准入判定", () => {
  it("名额没满且负载正常 → 放行", () => {
    expect(decide(DEFAULT_POLICY, 0, 0.5).admit).toBe(true);
  });

  it("名额满 → 不放行，理由说清是几比几", () => {
    const d = decide(DEFAULT_POLICY, 2, 0.5);
    expect(d.admit).toBe(false);
    expect(d.reason).toContain("已有 2 个隔离栈在跑（上限 2）");
  });

  it("🔴 负载超阈值 → 不放行。事故当天是 4.08/核，这条正是那时该拦住的", () => {
    const d = decide(DEFAULT_POLICY, 0, 4.08);
    expect(d.admit).toBe(false);
    expect(d.reason).toContain("4.08");
    expect(d.reason, "理由必须说清后果，不是只说超标").toContain("所有人一起变慢");
  });
});

describe("② 阈值能被反证：环境变量只能调严，不能放宽", () => {
  it("设成 0 → 任何一次起栈都不放行", () => {
    const policy = resolvePolicy({ WORKSPACEX_MAX_STACKS: "0" } as NodeJS.ProcessEnv);
    expect(policy.maxStacks).toBe(0);
    expect(decide(policy, 0, 0).admit, "0 个名额时连第一个都不该放行").toBe(false);
  });

  it("🔴 试图放宽（设成 99）必须无效 —— 撞红了就调大这条路要堵死", () => {
    const policy = resolvePolicy({ WORKSPACEX_MAX_STACKS: "99" } as NodeJS.ProcessEnv);
    expect(policy.maxStacks).toBe(DEFAULT_POLICY.maxStacks);
  });

  it("垃圾值不改变策略，不静默变成 0 或 NaN", () => {
    expect(resolvePolicy({ WORKSPACEX_MAX_STACKS: "abc" } as NodeJS.ProcessEnv).maxStacks)
      .toBe(DEFAULT_POLICY.maxStacks);
    expect(resolvePolicy({ WORKSPACEX_MAX_STACKS: "-3" } as NodeJS.ProcessEnv).maxStacks)
      .toBe(DEFAULT_POLICY.maxStacks);
  });
});

describe("租约：幽灵名额必须自愈", () => {
  it("进程已死的租约被当场清掉 —— 否则一次崩溃会永久占住名额", () => {
    const env = tempEnv();
    const dir = leaseDir(env);
    // 一个几乎不可能存在的 pid
    writeFileSync(join(dir, "999999-ghost.json"), JSON.stringify({ pid: 999999, isolationId: "ghost", startedAt: 0 }));
    writeFileSync(join(dir, `${process.pid}-live.json`), JSON.stringify({ pid: process.pid, isolationId: "live", startedAt: 0 }));

    const active = activeStacks(dir);
    expect(active.map((l) => l.isolationId)).toEqual(["live"]);
    expect(readdirSync(dir), "死租约的文件要被删掉，不是只在内存里忽略").toEqual([`${process.pid}-live.json`]);
  });

  it("坏掉的租约文件不会让整个准入炸掉", () => {
    const env = tempEnv();
    writeFileSync(join(leaseDir(env), "broken.json"), "{ not json");
    expect(() => activeStacks(leaseDir(env))).not.toThrow();
  });
});

describe("① 排队而不是拒绝 + ③ 起栈前打印 load 与栈数", () => {
  it("名额满时**排队**，等到释放后放行 —— 全程没有抛错", async () => {
    const env = tempEnv();
    const dir = leaseDir(env);
    // 先占满两个名额（用本进程 pid，保证 alive）
    for (const id of ["a", "b"]) {
      writeFileSync(join(dir, `${process.pid}-${id}.json`), JSON.stringify({ pid: process.pid, isolationId: id, startedAt: 0 }));
    }
    const lines: string[] = [];
    let ticks = 0;
    const sleep = vi.fn(async () => {
      ticks += 1;
      // 第二次轮询前腾出一个名额，模拟别人跑完了
      if (ticks === 2) rmSync(join(dir, `${process.pid}-a.json`), { force: true });
    });

    const slot = await acquireStackSlot({
      env, isolationId: "mine", log: (m) => lines.push(m), sleep, now: () => Date.now(),
      // 注入负载：否则本用例会耦合真实机器负载。第一版没注入，结果它走的是
      // 「排队超时放行」那条路而不是「名额释放后放行」——绿了，但绿得不对，
      // 而且在满载机器上跑了 423 秒。
      readLoad: () => ({ load1: 1, cores: 10, perCore: 0.1 }),
    });

    expect(slot.release, "排到之后必须给出可释放的句柄").toBeTypeOf("function");
    expect(sleep, "名额满时必须真的等过").toHaveBeenCalled();
    expect(lines.join("\n"), "必须走「名额释放后放行」，不是「排队超时放行」")
      .not.toContain("机器确实在超额运行");
    // ③ 第一行就是 load 与栈数
    expect(lines[0]).toMatch(/^\[stack-admission\] load1=[\d.]+ cores=\d+ perCore=[\d.]+ running=\d+\/\d+$/);
    // ① 排队时说清"不是你的代码有问题"——今天有 agent 把饥饿归因成自己写错了
    expect(lines.join("\n")).toContain("排队中");
    expect(lines.join("\n")).toContain("这不是卡死，也不是你的代码有问题");
    slot.release();
  });

  it("🔴 反证：上限设为 0 时，起栈必须当场排队并打印原因（而不是直接放行）", async () => {
    const lines: string[] = [];
    let ticks = 0;
    const sleep = vi.fn(async () => { ticks += 1; });
    // 排队上限设短，避免测试真的等十分钟；到点后它会"放行并大声说明"
    const slot = await acquireStackSlot({
      isolationId: "zero",
      env: { ...tempEnv(), WORKSPACEX_MAX_STACKS: "0" } as NodeJS.ProcessEnv,
      log: (m) => lines.push(m),
      sleep,
      now: (() => { let t = 0; return () => (t += 60_000); })(),
      readLoad: () => ({ load1: 1, cores: 10, perCore: 0.1 }),
    });
    expect(ticks, "必须真的排过队，不是直接放行").toBeGreaterThan(0);
    expect(lines.join("\n")).toContain("排队中");
    expect(lines.join("\n")).toContain("上限 0");
    // 到点放行时必须留下刺眼的记录，而不是静默通过
    expect(lines.join("\n")).toContain("机器确实在超额运行");
    slot.release();
  });

  it("超时放行也要留下租约，否则名额会被少算", async () => {
    const env = { ...tempEnv(), WORKSPACEX_MAX_STACKS: "0" } as NodeJS.ProcessEnv;
    const slot = await acquireStackSlot({
      isolationId: "overflow",
      env,
      log: () => {},
      sleep: async () => {},
      now: (() => { let t = 0; return () => (t += 60_000); })(),
      readLoad: () => ({ load1: 1, cores: 10, perCore: 0.1 }),
    });
    expect(activeStacks(leaseDir(env)).map((l) => l.isolationId)).toEqual(["overflow"]);
    slot.release();
    expect(activeStacks(leaseDir(env))).toEqual([]);
  });
});

describe("#1704 反证：预算是**一台机器**一份，不是每个 worktree 一份", () => {
  /**
   * 这条是本 issue 的反证。改回 `join(repoRoot, ".harness/state/.cache/stacks")` 它必红。
   *
   * 现场：本机 111 个 worktree，租约按 repoRoot 分家，于是 `maxStacks: 2` 实际是
   * "每个 worktree 2 个"。实测那一刻全机租约文件共 2 个、`docker compose ls` 却有
   * 18 个栈、load 48/10 核，两个 postgres 容器被 SIGKILL（Exited 137）。
   * 准入门日志逐字写着 `running=0/2`——诚实地数了错的那个池子。
   */
  it("🔴 两个不同 worktree 的调用共用同一份名额：第二个必须排队，不能各算各的", async () => {
    // 一台机器 = 一个租约目录。两个 repoRoot 只是两个调用方，不该带来两份预算。
    const machine = { WORKSPACEX_STACK_LEASE_DIR: join(mkdtempSync(join(tmpdir(), "wsx-machine-")), "stacks") } as NodeJS.ProcessEnv;
    const idle = () => ({ load1: 1, cores: 10, perCore: 0.1 });

    // worktree A 起满 maxStacks（=2）个栈
    const held = [];
    for (const id of ["a1", "a2"]) {
      held.push(await acquireStackSlot({
        repoRoot: "/fake/worktrees/A", isolationId: id, env: machine,
        log: () => {}, sleep: async () => {}, readLoad: idle,
      }));
    }

    // worktree B 现在来起第三个。机器已经满了——它必须**排队**，
    // 而不是因为"我自己的 worktree 里一个栈都没有"就放行。
    const lines: string[] = [];
    let ticks = 0;
    const slot = await acquireStackSlot({
      repoRoot: "/fake/worktrees/B", isolationId: "b1", env: machine,
      log: (m) => lines.push(m),
      sleep: async () => {
        ticks += 1;
        if (ticks === 1) held.pop()!.release(); // A 跑完一个，腾出名额
      },
      readLoad: idle,
    });

    expect(ticks, "B 必须真的排过队；各算各的预算会让它直接放行").toBeGreaterThan(0);
    expect(lines.join("\n"), "分母必须是机器上的真实栈数").toContain("running=2/2");
    expect(lines.join("\n")).toContain("已有 2 个隔离栈在跑");
    slot.release();
    for (const h of held) h.release();
  });
});

describe("量负载的动作本身不能挂住", () => {
  it("不 shell out —— `uptime` / `docker ps` 在满载时会挂，那正是要诊断的场景", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("./stack-admission.ts", import.meta.url), "utf8");
    const code = source.split("\n").filter((l) => {
      const t = l.trim();
      return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
    }).join("\n");
    expect(code).not.toMatch(/execSync|spawnSync|exec\(|spawn\(/);
    expect(code).not.toMatch(/uptime|docker ps/);
    expect(code).toContain("os.loadavg()");
  });
});
