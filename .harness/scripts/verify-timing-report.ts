// verify-timing-report.ts — `pnpm harness verify-timings`：读历史耗时记录，按阶段
// 算 p50/p95。没有内置默认预算——见 lib/verify-timing.ts 顶部说明，拍脑袋定的
// 预算比没有预算更容易被当真，先攒够几轮真实数据再定基线，这里只负责把数据摆出来。
import { computeStats, formatDuration, readAllRuns } from "./lib/verify-timing";
import { log } from "./lib/log";
import type { Args } from "./lib/args";

export function verifyTimingReport(_args: Args): void {
  const runs = readAllRuns();
  if (runs.length === 0) {
    log.info("暂无历史耗时记录（跑几次 verify:*/pre-push 后再来看）。");
    return;
  }
  log.step(`历史记录 ${runs.length} 条，按阶段聚合 p50/p95：`);
  const stats = computeStats(runs);
  for (const s of stats) {
    const label = s.name === "__total__" ? "总计" : s.name;
    log.info(`  ${label}：p50=${formatDuration(s.p50Ms)} p95=${formatDuration(s.p95Ms)}（n=${s.count}）`);
  }
  log.info("");
  log.info("预算告警未内置默认阈值——积累到足够真实数据后，用 checkBudget() 自己接一套。");
}
