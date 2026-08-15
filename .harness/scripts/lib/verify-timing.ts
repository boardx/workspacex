// verify-timing.ts — 每验证阶段耗时统计（ADR-106 batch-1/6，issue #1278）。
//
// 覆盖范围（诚实标注，不是全覆盖）：目前只测得到 with-test-isolation.ts 能直接
// 观察的两段——"等待资源"（stack-admission 排队）和"命令执行"（内层命令整体墙钟）。
// 内层命令自己的子阶段（比如 verify:base:raw 链条里 19 个 lint doctor 各自多久、
// turbo typecheck 多久、turbo test 多久）目前是一个黑盒，没有拆——那需要改造
// package.json 里的 `&&` 链式命令本身，是比"加个计时器"更大的改动，本 issue 不做，
// 如实记录成已知缺口，不是"看起来测了其实没测全"。
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CACHE_DIR = join(ROOT, ".harness", "state", ".cache");
const TIMINGS_PATH = join(CACHE_DIR, "verify-timings.jsonl");

export interface PhaseTiming {
  name: string;
  ms: number;
}

export interface TimingRun {
  runId: string;
  command: string;
  startedAt: string;
  phases: PhaseTiming[];
  totalMs: number;
}

/** 累计一次运行里的多个阶段耗时。start/stop 配对，忘记 stop 会在下一次 start 或
 * finish 时自动收尾——不静默丢失数据，但也不假装知道确切边界。 */
export class Stopwatch {
  private phases: PhaseTiming[] = [];
  private currentName: string | null = null;
  private currentStart: number | null = null;
  private readonly runStart: number;
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
    this.runStart = now();
  }

  start(name: string): void {
    if (this.currentName !== null) this.stop();
    this.currentName = name;
    this.currentStart = this.now();
  }

  stop(): void {
    if (this.currentName === null || this.currentStart === null) return;
    this.phases.push({ name: this.currentName, ms: this.now() - this.currentStart });
    this.currentName = null;
    this.currentStart = null;
  }

  finish(command: string, runId: string): TimingRun {
    this.stop();
    return {
      runId,
      command,
      startedAt: new Date(this.runStart).toISOString(),
      phases: this.phases,
      totalMs: this.now() - this.runStart,
    };
  }
}

export function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m${s}s` : `${s}s`;
}

export function printReport(run: TimingRun, log: (line: string) => void = console.log): void {
  log(`[timing] ${run.command}`);
  for (const p of run.phases) log(`  ${p.name}：${formatDuration(p.ms)}`);
  log(`  总计：${formatDuration(run.totalMs)}`);
}

function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

export function recordRun(run: TimingRun): void {
  ensureCacheDir();
  appendFileSync(TIMINGS_PATH, `${JSON.stringify(run)}\n`);
}

export function readAllRuns(): TimingRun[] {
  if (!existsSync(TIMINGS_PATH)) return [];
  return readFileSync(TIMINGS_PATH, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as TimingRun);
}

export function timingsPath(): string {
  return TIMINGS_PATH;
}

const TOTAL_PHASE_KEY = "__total__";

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1));
  return sortedAsc[idx]!;
}

export interface PhaseStats {
  name: string;
  count: number;
  p50Ms: number;
  p95Ms: number;
}

/** 按阶段名聚合历史数据算 p50/p95；`__total__` 是每次运行的总耗时，不是某个阶段。 */
export function computeStats(runs: TimingRun[]): PhaseStats[] {
  const byPhase = new Map<string, number[]>();
  const push = (name: string, ms: number) => {
    if (!byPhase.has(name)) byPhase.set(name, []);
    byPhase.get(name)!.push(ms);
  };
  for (const run of runs) {
    for (const p of run.phases) push(p.name, p.ms);
    push(TOTAL_PHASE_KEY, run.totalMs);
  }
  const stats: PhaseStats[] = [];
  for (const [name, values] of byPhase) {
    const sorted = [...values].sort((a, b) => a - b);
    stats.push({ name, count: sorted.length, p50Ms: percentile(sorted, 50), p95Ms: percentile(sorted, 95) });
  }
  return stats;
}

export interface PhaseBudget {
  phaseName: string;
  maxMs: number;
}

/** 某一次运行是否有阶段超预算。预算目前没有内置默认值——见 verify-timing-report.ts
 * 顶部说明：拍脑袋定的预算比没有预算更容易被当真，先攒够几轮真实数据再定基线。 */
export function checkBudget(run: TimingRun, budgets: PhaseBudget[]): string[] {
  const warnings: string[] = [];
  for (const budget of budgets) {
    const ms = budget.phaseName === TOTAL_PHASE_KEY
      ? run.totalMs
      : run.phases.find((p) => p.name === budget.phaseName)?.ms;
    if (ms !== undefined && ms > budget.maxMs) {
      warnings.push(
        `⚠ [timing] ${budget.phaseName} 耗时 ${formatDuration(ms)} 超过预算 ${formatDuration(budget.maxMs)}`,
      );
    }
  }
  return warnings;
}
