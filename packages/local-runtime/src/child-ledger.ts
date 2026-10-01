/**
 * 子进程台账：上一次没收尾就死掉时，下一次启动替它收尸（#3872 R21）。
 *
 * 实测 2026-09-27：对应用主进程发一个 SIGTERM（注销/重启/`kill` 都是这条路），
 * api / web / deep-agent / ollama 全部变成孤儿（ppid 1）继续占着 3100/3200/2024，
 * 下一次打开直接「端口被占用」——而且占着 3100 的是**旧版**界面，离线更新装上了
 * 却永远换不上去，探针 404 看着像更新机制坏了。
 *
 * 主进程的信号处理（desktop 那边）只能盖住 SIGTERM；SIGKILL、崩溃、断电盖不住，
 * 所以要一份落盘的名单：启动子进程就记一笔，干净停完就清空；下次启动先读名单，
 * 还活着且**启动时刻仍是我们记下的那一刻**才杀——PID 会被系统复用，只凭数字杀人会误伤。
 *
 * ⚠ 核对身份用启动时刻，不用命令行：next 起来后会把自己的进程名改成 `next-server (v14…)`，
 *   按命令行比对恰好放过这次占着 3100 的那一个。
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface LedgerEntry {
  readonly name: string;
  readonly pid: number;
  /** `ps -o lstart=` 给的启动时刻；收尸前用它核对 PID 没被别的程序复用。 */
  readonly started: string;
}

export interface ReapDeps {
  /** 这个 PID 的启动时刻（`ps -o lstart=`）；进程不在了返回 null。 */
  startedOf(pid: number): string | null;
  /** 给整个进程组发信号（子进程是 detached 起的，pgid = pid）。 */
  signalGroup(pid: number, signal: NodeJS.Signals): void;
  sleep(ms: number): Promise<void>;
}

export function readLedger(file: string): LedgerEntry[] {
  if (!existsSync(file)) return [];
  try {
    const v: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(v)) return [];
    return v.filter((e): e is LedgerEntry =>
      typeof e === "object" && e !== null &&
      typeof (e as LedgerEntry).name === "string" &&
      Number.isInteger((e as LedgerEntry).pid) && (e as LedgerEntry).pid > 1 &&
      typeof (e as LedgerEntry).started === "string" && (e as LedgerEntry).started !== "");
  } catch { return []; }   // 半截写坏的台账不该挡住启动
}

export function recordChild(file: string, entry: LedgerEntry): void {
  const next = [...readLedger(file).filter((e) => e.pid !== entry.pid), entry];
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(next, null, 2));
}

export function clearLedger(file: string): void {
  rmSync(file, { force: true });
}

/**
 * 收掉台账里还活着的上一轮子进程。返回实际收掉的名字。
 * 启动时刻对不上的 PID 一律不碰（已被复用），并从台账里去掉。
 */
export async function reapLedger(file: string, deps: ReapDeps = realDeps, graceMs = 8_000): Promise<string[]> {
  const alive = readLedger(file).filter((e) => {
    const started = deps.startedOf(e.pid);
    return started !== null && started === e.started;
  });
  for (const e of alive) deps.signalGroup(e.pid, "SIGTERM");
  const deadline = Date.now() + graceMs;
  let left = alive;
  while (left.length > 0 && Date.now() < deadline) {
    await deps.sleep(200);
    left = left.filter((e) => deps.startedOf(e.pid) === e.started);
  }
  for (const e of left) deps.signalGroup(e.pid, "SIGKILL");
  clearLedger(file);
  return alive.map((e) => e.name);
}

/** 进程的启动时刻；不在了（或不是 POSIX，没有 ps）返回 null。 */
export function startedAt(pid: number): string | null {
  try {
    const out = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return out === "" ? null : out;
  } catch { return null; }
}

const realDeps: ReapDeps = {
  startedOf: startedAt,
  signalGroup(pid, signal) {
    try { process.kill(-pid, signal); return; } catch { /* 组已经没了 */ }
    try { process.kill(pid, signal); } catch { /* 进程已经没了 */ }
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};
