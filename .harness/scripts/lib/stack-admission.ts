/**
 * stack-admission.ts —— 起隔离栈前的准入：**排队，不是拒绝**。
 *
 * ## 事故
 *
 * 2026-08-05：三条线各派 4–6 条并说「满负荷」，没人问过机器的上限。结果
 * load 40.78 / 10 核 = **4.08 倍超额认购**，35 个 vitest + 16 个 turbo 进程，
 * `docker ps` 超时 >2min，coord-main 复核时连 `uptime` 都 300 秒没返回。
 *
 * ⇒ 不是哪条线慢，是**所有人一起在满载的机器上爬**。
 *
 * ## 为什么必须排队而不是拒绝
 *
 * 拒绝会让 agent 以为自己写错了。今天 #514 那个 agent 正是这样：它把饥饿归因成
 * 「pre-push 回退到全量 verify:base」（实测不成立），还把 40 分钟空转记在自己账上。
 * **饥饿看起来像卡死，也看起来像自己写错了。** 所以这里的输出必须让人一眼看出
 * 「我在排队，不是我坏了」。
 *
 * ## 为什么不 shell out 去量
 *
 * `uptime` / `docker ps` 在满载时本身就会挂 —— 一个测负载的动作自己挂住，比不测更糟。
 * 所以：负载用 `os.loadavg()`（进程内，瞬时），在跑的栈数用**本地租约文件**，
 * 都不依赖任何子进程。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

export interface StackLease {
  pid: number;
  isolationId: string;
  startedAt: number;
}

export interface AdmissionPolicy {
  /** 全队同时最多几个隔离栈 */
  maxStacks: number;
  /** 每核 1 分钟负载上限。超过就排队 —— 这是"机器已经在爬"的信号 */
  maxLoadPerCore: number;
  /** 轮询间隔（毫秒） */
  pollMs: number;
  /** 排队上限（毫秒）。到点仍不放行就**放行并大声说明**——见下方注释 */
  maxWaitMs: number;
}

export const DEFAULT_POLICY: AdmissionPolicy = {
  maxStacks: 2,
  maxLoadPerCore: 2.5,
  pollMs: 5_000,
  maxWaitMs: 10 * 60_000,
};

/**
 * 环境变量**只能把限制调得更严，不能放宽**。
 *
 * 这样反证（设成 0 → 任何一次起栈都必须排队）可行，而"撞红了就调大"这条路被堵死。
 * 与 #538 的隔离检查同一条原则：能被环境变量关掉的门，第一次撞红时就会被关掉。
 */
export function resolvePolicy(env: NodeJS.ProcessEnv, base: AdmissionPolicy = DEFAULT_POLICY): AdmissionPolicy {
  const raw = env.WORKSPACEX_MAX_STACKS;
  if (raw === undefined) return base;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return base;
  return { ...base, maxStacks: Math.min(base.maxStacks, parsed) };
}

/**
 * 租约目录 —— **机器全局，不是每个 worktree 一份**。
 *
 * ## #1704 实测：这里原来是 `join(repoRoot, ".harness/state/.cache/stacks")`
 *
 * `repoRoot` 是**当前 worktree 的根**。本机同时存在 **111 个 worktree**，于是
 * `maxStacks: 2` 这条"全队同时最多几个隔离栈"的策略，实际执行成了"**每个 worktree**
 * 最多 2 个"——上限从 2 变成 222。实测那一刻：
 *
 * ```
 * 全机租约文件总数 = 2        （111 个 worktree 的租约目录加起来）
 * docker compose ls  = 18 个栈 / 33 个容器
 * load average       = 48（10 核 → 4.8 倍超额，比 2026-08-05 那次事故的 4.08 还高）
 * 已被 SIGKILL 的 postgres 容器 = 2 个（Exited 137，OOMKilled=false → down 超时被杀）
 * ```
 *
 * 我这一轮的日志逐字写着 `running=0/2`——它诚实地报告了**它自己那个 worktree** 的
 * 租约数，而机器上真有 18 个栈在跑。它没说谎，它问错了对象。
 *
 * ⇒ 这正是 AGENTS.md「静态痕迹 ≠ 动态事实」那条：**租约文件是痕迹，`docker compose ls`
 *   才是事实**。痕迹写得越诚实具体（`running=0/2` 精确到分母），读起来越像权威。
 *
 * ## 为什么修成 tmpdir 而不是改成去问 docker
 *
 * 本文件顶部那条约束仍然成立且必须保留：**不 shell out 去量**——`docker ps` 在满载时
 * 自己会挂，一个测负载的动作把自己挂住比不测更糟（那正是 2026-08-05 事故里
 * `docker ps` 超时 >2min 的现场）。所以判据仍是进程内可读的租约文件，只是把它挪到
 * **所有 worktree 共用的一个位置**。`os.tmpdir()` 在 macOS 上是 per-user 的，本机所有
 * agent 同一个用户，正好是"一台机器一份预算"这个语义。
 *
 * 环境变量 `WORKSPACEX_STACK_LEASE_DIR` 只为**可测**存在（测试要能拿一个干净目录），
 * 不是给撞红了的人调开的旋钮——它改的是位置，不是上限；上限那个旋钮
 * (`WORKSPACEX_MAX_STACKS`) 依旧只能调严。
 */
export function leaseDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.WORKSPACEX_STACK_LEASE_DIR;
  if (override !== undefined && override !== "") return override;
  return join(os.tmpdir(), "workspacex-stack-leases");
}

/**
 * PID 活性探测 —— `heavy-suite-lock.ts`（#2258）复用同一份实现，不再抄一份。
 * 「同一事实不得声明在两处」（AGENTS.md）：判定"这个 PID 还活着"只应该有一处权威。
 */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * 当前在跑的栈。**顺带清理进程已死的陈旧租约** —— 否则一次崩溃会永久占住名额，
 * 而那种"名额被幽灵占着"的现象，排查起来跟饥饿一模一样。
 */
export function activeStacks(dir: string): StackLease[] {
  if (!existsSync(dir)) return [];
  const out: StackLease[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const path = join(dir, file);
    try {
      const lease = JSON.parse(readFileSync(path, "utf8")) as StackLease;
      if (alive(lease.pid)) out.push(lease);
      else rmSync(path, { force: true });
    } catch {
      rmSync(path, { force: true });
    }
  }
  return out;
}

export function loadPerCore(): { load1: number; cores: number; perCore: number } {
  // os.loadavg() 是进程内读取，满载时也瞬时返回。
  // 刻意不 shell out：`uptime` 在这台机器上曾 300 秒没返回。
  const load1 = os.loadavg()[0] ?? 0;
  const cores = Math.max(1, os.cpus().length);
  return { load1, cores, perCore: load1 / cores };
}

export interface AdmissionDecision {
  admit: boolean;
  reason: string;
}

/** 纯判定：给定当前栈数与负载，现在能不能起。可单测，不碰文件系统。 */
export function decide(
  policy: AdmissionPolicy,
  running: number,
  perCore: number,
): AdmissionDecision {
  if (running >= policy.maxStacks) {
    return { admit: false, reason: `已有 ${running} 个隔离栈在跑（上限 ${policy.maxStacks}）` };
  }
  if (perCore > policy.maxLoadPerCore) {
    return {
      admit: false,
      reason: `机器每核负载 ${perCore.toFixed(2)}（上限 ${policy.maxLoadPerCore}）—— 现在起栈只会让所有人一起变慢`,
    };
  }
  return { admit: true, reason: "" };
}

export interface AcquireOptions {
  /**
   * #1704：**租约不再挂在 repoRoot 下**（见 `leaseDir` 的头注：111 个 worktree 各算
   * 各的，把 maxStacks=2 执行成了 222）。这个字段留着是因为调用方本来就有它、
   * 且诊断信息里指出"是哪个 worktree 在起栈"仍然有用；它**不再决定租约位置**。
   */
  repoRoot?: string;
  isolationId: string;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /**
   * 读负载。可注入**只为可测**：第一版没有它，于是测试耦合了真实机器负载——
   * 那次用例确实绿了，但走的是「排队超时放行」那条路，不是我要验的
   * 「名额释放后放行」，而且在一台已经满载的机器上烧了 7 分钟。
   * 绿得不对，跟红得不对一样危险。
   */
  readLoad?: () => { load1: number; cores: number; perCore: number };
}

export interface StackSlot {
  release: () => void;
  waitedMs: number;
}

/**
 * 取一个起栈名额。排不到就等，**并且每次轮询都说清自己在等什么**。
 *
 * 排队超过 `maxWaitMs` 时**放行并大声说明**，而不是失败：一个能把 CI 卡死的准入门，
 * 第一次卡住就会被整条摘掉。宁可超额一次并留下刺眼的记录，也不要制造一个
 * "看起来像挂死"的新故障 —— 那正是本文件要消灭的东西。
 */
export async function acquireStackSlot(options: AcquireOptions): Promise<StackSlot> {
  const env = options.env ?? process.env;
  const log = options.log ?? ((m: string) => console.log(m));
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = options.now ?? (() => Date.now());
  const readLoad = options.readLoad ?? loadPerCore;
  const policy = resolvePolicy(env);
  const dir = leaseDir(env);
  mkdirSync(dir, { recursive: true });

  const startedAt = now();
  let announced = false;

  for (;;) {
    const running = activeStacks(dir);
    const { load1, cores, perCore } = readLoad();

    // 硬要求 3：起栈前必须打印 load 与已存在栈数 —— 饥饿时它至少要说得出来自己在饥饿
    if (!announced) {
      log(
        `[stack-admission] load1=${load1.toFixed(2)} cores=${cores} perCore=${perCore.toFixed(2)} ` +
          `running=${running.length}/${policy.maxStacks}`,
      );
      announced = true;
    }

    const decision = decide(policy, running.length, perCore);
    if (decision.admit) {
      const file = join(dir, `${process.pid}-${options.isolationId}.json`);
      writeFileSync(file, JSON.stringify({ pid: process.pid, isolationId: options.isolationId, startedAt: now() }));
      const waitedMs = now() - startedAt;
      if (waitedMs > 0) log(`[stack-admission] 排到了，等了 ${Math.round(waitedMs / 1000)}s`);
      return { waitedMs, release: () => rmSync(file, { force: true }) };
    }

    const waited = now() - startedAt;
    if (waited >= policy.maxWaitMs) {
      log(
        `! [stack-admission] 已排队 ${Math.round(waited / 60000)} 分钟仍未轮到（${decision.reason}）。` +
          "放行以免把 CI 卡死，但机器确实在超额运行 —— 请减少并行度，别把这条当默认路径。",
      );
      const file = join(dir, `${process.pid}-${options.isolationId}.json`);
      writeFileSync(file, JSON.stringify({ pid: process.pid, isolationId: options.isolationId, startedAt: now() }));
      return { waitedMs: waited, release: () => rmSync(file, { force: true }) };
    }

    // 说清"我在排队，不是我坏了"——今天有 agent 把饥饿归因成自己写错了代码
    log(
      `[stack-admission] 排队中：${decision.reason}。已等 ${Math.round(waited / 1000)}s，` +
        `${policy.pollMs / 1000}s 后重试。（这不是卡死，也不是你的代码有问题）`,
    );
    await sleep(policy.pollMs);
  }
}
