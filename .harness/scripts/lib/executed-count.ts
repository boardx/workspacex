/**
 * 「零收集不得算通过」（acceptance-test-plan.md §11）在证据链上的**单一事实源**：
 * 从 runner 日志正文里读出真实执行条数，而不是相信退出码。
 *
 * 背景（#3008 反证）：`record-readiness-evidence.ts` 过去只要求日志「存在且非空」、
 * `exit_code` 字面量硬编码 0，于是一份正文逐字是 `Tests  no tests` 的日志也能产出
 * 一份命令真实、SHA 真实、退出码 0 的合规 manifest，足以把一个 phase 推到 `ready`。
 *
 * 判据放在这里（而不是各调用方各写一遍）：记录器与 `parseEvidenceManifest` 都走这条路径。
 * **解析不到就报错，不是记 0 放行**——认不出的日志格式必须让人来加 matcher，
 * 而不是静默降级成「零条也算过」。
 */

export interface ExecutedCountMatch {
  /** 识别出该行的 runner 名字，报错信息里回显，便于定位是哪条 lane 零收集 */
  runner: string;
  /** 原始行（已 trim），作为证据回显 */
  line: string;
  /** 该行贡献的执行条数（passed + failed；skipped / todo 不算执行过） */
  executed: number;
}

export type ExecutedCountResult =
  | { ok: true; executed: number; matches: ExecutedCountMatch[] }
  | { ok: false; reason: string };

/** `12 passed`、`2 failed`、`1 flaky` 里真正跑过的条数之和 */
function sumExecuted(text: string): number {
  let total = 0;
  for (const match of text.matchAll(/(\d+)\s+(?:passed|failed|flaky|error|errors|xpassed|xfailed)\b/gi)) {
    const count = match[1];
    if (count !== undefined) total += Number(count);
  }
  return total;
}

interface Matcher {
  runner: string;
  /** 认不出该行返回 null；认出则返回执行条数（可以是 0 —— 那正是零收集） */
  match(line: string): number | null;
}

const MATCHERS: readonly Matcher[] = [
  {
    // vitest：`      Tests  12 passed | 2 skipped (14)` / `      Tests  no tests`
    // 只认 `Tests`，不认 `Test Files`——后者是文件数，不是用例数。
    runner: "vitest",
    match(line) {
      const body = /^Tests\s+(\S.*)$/.exec(line)?.[1];
      if (body === undefined) return null;
      if (/\bno tests\b/i.test(body)) return 0;
      return sumExecuted(body);
    },
  },
  {
    // pytest：`===== 5 passed, 1 skipped in 0.42s =====` / `===== no tests ran in 0.01s =====`
    runner: "pytest",
    match(line) {
      const body = /^=+\s(.+?)\s=+$/.exec(line)?.[1];
      if (body === undefined || !/\bin\s[\d.]+s\b/.test(body)) return null;
      if (/\bno tests ran\b/i.test(body)) return 0;
      return sumExecuted(body);
    },
  },
  {
    // playwright：`  12 passed (3.4s)` / `  1 failed` / `  2 flaky`
    runner: "playwright",
    match(line) {
      if (!/^\d+\s+(?:passed|failed|flaky)\b/.test(line)) return null;
      return sumExecuted(line);
    },
  },
  {
    // playwright 的零收集形态：`Nothing to run.` / `Error: No tests found`
    runner: "playwright",
    match(line) {
      return /^(?:Nothing to run\b|(?:Error:\s*)?No tests found\b)/i.test(line) ? 0 : null;
    },
  },
];

/**
 * 扫描整份日志，把所有能识别的 runner 汇总行相加。
 *
 * 多 lane 日志（`verify:full`）里每条 lane 各有一行汇总，逐行取**第一个**认出它的
 * matcher，避免同一行被两个 matcher 重复计数。
 */
export function parseExecutedCount(log: string): ExecutedCountResult {
  const matches: ExecutedCountMatch[] = [];
  for (const raw of log.split(/\r?\n/)) {
    // vitest / playwright 的汇总行带 ANSI 颜色与缩进，先剥掉再匹配。
    const line = raw.replace(/\u001B\[[0-9;]*m/g, "").trim();
    if (line.length === 0) continue;
    for (const matcher of MATCHERS) {
      const executed = matcher.match(line);
      if (executed === null) continue;
      matches.push({ runner: matcher.runner, line, executed });
      break;
    }
  }
  if (matches.length === 0) {
    return {
      ok: false,
      reason: "no vitest/playwright/pytest test-count summary line found in the log",
    };
  }
  return { ok: true, executed: matches.reduce((sum, m) => sum + m.executed, 0), matches };
}
