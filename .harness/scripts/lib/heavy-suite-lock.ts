/**
 * heavy-suite-lock.ts —— 重 e2e 套件的准入串行（#2258）。
 *
 * ## 事故
 *
 * rev-uiux 为 CLR V-D/V-P 取证，独立隔离栈跑了 3 轮 `verify:chat-read`
 * （64 用例真实浏览器 e2e）。三轮全红、三轮失败交集为空——不是断言不符，是
 * `page.goto`/`waitForResponse` 类超时。取证期间机器上同时有**另一个** playwright
 * 隔离栈在跑（`docker ps` 能看到别的 `wsx-*` compose 项目）。三轮里 load 最低的
 * 那一轮（起跑时 1min load 7.3）恰好是最好的一轮（3 failed）——即失败率随机器
 * 当时有没有第二个重 e2e 套件在跑而剧烈波动，与产品代码无关。
 *
 * `.harness/rubrics/chat-main-fidelity-rubric.md` 的硬门 H3 要求
 * 「`verify:base` 与 `verify:chat-read` 都绿」，且已于 2026-08-08 明确废止
 * 「与 base SHA 对照无新增失败」这条权宜判据。三轮没有一轮绿 ⇒ H3 判 0，
 * 与界面真实质量无关——分数被取证环境的噪声吃掉了。
 *
 * 人类裁决（usamshen，2026-08-28，issue #2258）：**选 A，修取证环境，不放宽 H3**。
 * `stack-admission.ts` 已有的准入只限制"同时起几个隔离栈"（`maxStacks`，按 CPU
 * 负载动态判定）——它在两个重 e2e 套件几乎同时起跑、当时机器还不算过载的窗口里
 * 会一起放行，随后两边同时跑真实浏览器测试才把负载顶上去。本文件加一层更严格的
 * 互斥：**同一台机器同一时刻只允许一个"重 e2e 套件"在跑**，后来者排队，而不是
 * 让 stack-admission 的负载阈值滞后一步才反应过来。
 *
 * ## 为什么是单独一把锁,不是把 `maxStacks` 调成 1
 *
 * `verify:base` 之类的轻量校验（typecheck/lint/vitest）也走 `with-test-isolation.ts`，
 * 它们之间并发跑没有本 issue 描述的资源竞争问题（不起真实浏览器、不共享 GPU/合成器）。
 * 把全局 `maxStacks` 收紧到 1 会连带把这些轻量校验也串行化，牺牲无谓的墙钟时间。
 * 只对"起真实浏览器的 playwright e2e"这一类命令加互斥,精确打到问题本身。
 *
 * ## 复用哪些既有模式
 *
 * - PID 活性探测复用 `stack-admission.ts` 的 `alive()`——不重复实现同一个判断。
 * - 排队而不是拒绝、每次轮询都打日志说清"在等什么"、超时后放行并大声说明——
 *   三条都是 `stack-admission.ts` 已经验证过的教训（见其头注 2026-08-05 事故），
 *   本文件原样沿用，不重新发明。
 *
 * ## 与 `activeStacks()` 的租约目录不同之处
 *
 * `stack-admission.ts` 的租约是"每个持有者一个文件"（计数用）。本文件的锁是
 * "全局唯一一个文件"（互斥用），所以创建必须是**原子的**（`flag: "wx"`，
 * `O_CREAT|O_EXCL`），否则两个进程都读到"文件不存在"再各自写，会同时以为自己
 * 拿到了锁。释放时用 `token` 做比较后删除（compare-and-delete）：超时放行后
 * 强制接管锁的进程与原持有者的 `release()` 不会互相踩踏对方的锁文件。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import os from "node:os";
import { alive } from "./stack-admission";

export interface HeavySuiteLock {
  pid: number;
  token: string;
  command: string;
  startedAt: number;
}

export interface HeavySuiteLockPolicy {
  /** 轮询间隔（毫秒） */
  pollMs: number;
  /**
   * 排队上限（毫秒）。重 e2e 套件本身可能跑到 25 分钟（见 issue #2258 的三轮耗时
   * 13m18s/25m40s/15m21s），所以这个上限必须明显长于单轮套件耗时，否则会在
   * 持锁方仍在正常运行时就误判"锁死了"而强制接管，制造出比不加锁更糟的并发。
   */
  maxWaitMs: number;
}

export const DEFAULT_HEAVY_SUITE_LOCK_POLICY: HeavySuiteLockPolicy = {
  pollMs: 5_000,
  maxWaitMs: 40 * 60_000,
};

/**
 * 命中"重 e2e 套件"的判据：命令行里同时出现 `playwright` 与 `test` 两个 token——
 * 即真的会拉起一个真实浏览器 + `webServer` 的 playwright run。本仓所有走
 * `with-test-isolation.ts` 的 playwright 调用（`verify:chat-read` / `verify:core-loop` /
 * `verify:fullstack-smoke` / `verify:self-service-profile` / `shots:*`……）都是
 * `pnpm --filter web exec playwright test --config ...` 这个形状，用 token 匹配而不是
 * 写死套件名单，新增的 playwright verify 命令不需要再回来改这里。
 *
 * 不匹配 `verify:base`/`verify:harness` 这类 turbo/vitest 命令——它们不含 `playwright`。
 */
export function isHeavyE2eCommand(command: string[]): boolean {
  return command.includes("playwright") && command.includes("test");
}

/**
 * 锁目录 —— 机器全局，同 `stack-admission.leaseDir` 的推理（#1704）：本机可能同时
 * 存在上百个 worktree，锁必须挂在"一台机器一份"的位置，不能挂在 repoRoot 下。
 *
 * `WORKSPACEX_HEAVY_E2E_LOCK_DIR` 只为可测存在（测试要能拿一个干净目录），
 * 不是给撞红了的人调开的旋钮。
 */
export function heavySuiteLockDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.WORKSPACEX_HEAVY_E2E_LOCK_DIR;
  if (override !== undefined && override !== "") return override;
  return join(os.tmpdir(), "workspacex-heavy-e2e-lock");
}

function lockFile(dir: string): string {
  return join(dir, "lock.json");
}

function readLock(path: string): HeavySuiteLock | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as HeavySuiteLock;
  } catch {
    // 坏掉的锁文件按"没有锁"处理——同 stack-admission 对损坏租约文件的处理方式。
    return null;
  }
}

/** 尝试原子创建锁文件。成功返回 true；已存在返回 false（不覆盖，不判断存活）。 */
function tryCreate(path: string, lock: HeavySuiteLock): boolean {
  try {
    writeFileSync(path, JSON.stringify(lock), { flag: "wx" });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

export interface AcquireHeavySuiteLockOptions {
  /** 完整命令行，用于判定是否命中"重 e2e 套件"，也写进锁文件方便诊断。 */
  command: string[];
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  policy?: HeavySuiteLockPolicy;
}

export interface HeavySuiteLockHandle {
  /** 本次调用是否真的持有了互斥锁——不是重 e2e 套件时为 false，`release` 是空操作。 */
  held: boolean;
  waitedMs: number;
  release: () => void;
}

/**
 * 取重 e2e 套件的互斥锁。不是重 e2e 套件（`isHeavyE2eCommand` 为 false）时直接
 * 放行，不排队、不写锁文件——轻量校验之间不该被这道门拖慢。
 *
 * 排队超过 `maxWaitMs` 仍未轮到：**放行并大声说明**，同 `stack-admission` 的既有
 * 原则——一道能把整条 CI 卡死的门，第一次卡住就会被整条摘掉。强制接管旧锁而不是
 * 直接跳过写锁，是为了让后来者依然能看到"现在是谁在跑"（诊断信息），也让原持有者
 * 迟到的 `release()` 不会误删新持有者的锁（token 比较后才删）。
 */
export async function acquireHeavySuiteLock(
  options: AcquireHeavySuiteLockOptions,
): Promise<HeavySuiteLockHandle> {
  if (!isHeavyE2eCommand(options.command)) {
    return { held: false, waitedMs: 0, release: () => {} };
  }

  const env = options.env ?? process.env;
  const log = options.log ?? ((m: string) => console.log(m));
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = options.now ?? (() => Date.now());
  const policy = options.policy ?? DEFAULT_HEAVY_SUITE_LOCK_POLICY;
  const dir = heavySuiteLockDir(env);
  mkdirSync(dir, { recursive: true });
  const path = lockFile(dir);
  const commandLine = options.command.join(" ");
  const token = randomUUID();

  const startedAt = now();
  let announced = false;

  for (;;) {
    const existing = readLock(path);

    if (existing !== null) {
      if (!alive(existing.pid)) {
        // 持锁进程已死——幽灵锁,当场清掉,不等它自然过期。
        rmSync(path, { force: true });
        log(`[heavy-e2e-lock] 清掉了幽灵锁（pid=${existing.pid} 已不在，命令：${existing.command}）`);
        continue;
      }
    } else {
      const lock: HeavySuiteLock = { pid: process.pid, token, command: commandLine, startedAt: now() };
      if (tryCreate(path, lock)) {
        const waitedMs = now() - startedAt;
        if (waitedMs > 0) log(`[heavy-e2e-lock] 排到了，等了 ${Math.round(waitedMs / 1000)}s`);
        return {
          held: true,
          waitedMs,
          release: () => {
            const current = readLock(path);
            // compare-and-delete：只删自己写的那把锁，不删别人（超时放行后被接管，
            // 或另一个进程已经拿到新锁）的锁——否则迟到的 release 会误删新持有者。
            if (current !== null && current.token === token) rmSync(path, { force: true });
          },
        };
      }
      // tryCreate 输了一次竞态（EEXIST）——回到循环顶部重新读锁，走排队分支。
      continue;
    }

    if (!announced) {
      log(`[heavy-e2e-lock] 排队中：机器上已有重 e2e 套件在跑（pid=${existing.pid}，命令：${existing.command}）。` +
        `本命令：${commandLine}`);
      announced = true;
    }

    const waited = now() - startedAt;
    if (waited >= policy.maxWaitMs) {
      const forced: HeavySuiteLock = { pid: process.pid, token, command: commandLine, startedAt: now() };
      writeFileSync(path, JSON.stringify(forced));
      log(
        `! [heavy-e2e-lock] 已排队 ${Math.round(waited / 60000)} 分钟仍未轮到（原持有者 pid=${existing.pid} ` +
          `仍存活）。强制接管锁并放行，以免把 CI 卡死，但机器上确实还有另一个重 e2e 套件在跑 —— ` +
          "结果可能仍受资源竞争影响，不要把这条当默认路径。",
      );
      return {
        held: true,
        waitedMs: waited,
        release: () => {
          const current = readLock(path);
          if (current !== null && current.token === token) rmSync(path, { force: true });
        },
      };
    }

    log(
      `[heavy-e2e-lock] 排队中：已等 ${Math.round(waited / 1000)}s，${policy.pollMs / 1000}s 后重试。` +
        "（这不是卡死，也不是你的代码有问题——机器上有另一个重 e2e 套件正占着互斥锁）",
    );
    await sleep(policy.pollMs);
  }
}
