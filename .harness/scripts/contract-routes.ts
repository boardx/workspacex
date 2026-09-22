// contract-routes.ts — `pnpm harness contract-routes [--phase NN] [--json]`
//
// issue #1177 的「一份可见缺口清单」。判定逻辑全在 lib/contract-route-coverage.ts
// （纯函数 + fixture 单测），读盘在 lib/contract-route-coverage-fs.ts，这里只负责打印。
//
// ⚠ **这个命令永远退出 0。** issue #1177「已知的难点」第 3 条逐字：别把它做成阻断门——
//   一上来就 FAIL 会逼人去关掉它。清单收敛之后再谈升级，而升级是人的决定，不是
//   某个 agent 顺手改一行默认值。doctor 那边同理，只出 WARN。
import { log } from "./lib/log";
import type { Args } from "./lib/args";
import { contractRouteCoverage } from "./lib/contract-route-coverage-fs";

export function contractRoutes(args: Args): void {
  const only = args.opts["phase"] ?? null;
  const report = contractRouteCoverage(only ? [only] : undefined);

  if (args.flags["json"] === true) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const inScope = report.bundles.filter((b) => b.inScope);
  log.step(
    `契约 ↔ 路由覆盖：${inScope.length}/${report.bundles.length} 个契约束进入判定范围，` +
      `共 ${report.operationsInScope} 条声明了 path 的 operation；` +
      `interface 侧解析出 ${report.routesParsed} 条路由`,
  );

  if (report.gaps.length === 0) {
    log.ok("判定范围内每条 operation 都有对应路由。");
  } else {
    log.info("");
    log.info(`缺口 ${report.gaps.length} 条（契约声明了 path，apps/api/src/interface/ 里没有对应路由）：`);
    let current = "";
    for (const g of report.gaps) {
      if (g.bundle !== current) {
        current = g.bundle;
        const b = inScope.find((x) => x.bundle === g.bundle);
        const n = report.gaps.filter((x) => x.bundle === g.bundle).length;
        log.info(`\n  [${g.phase}] ${g.bundle} —— ${n}/${b?.operationsWithPath ?? "?"} 条无路由（${b?.reason ?? ""}）`);
      }
      log.info(`    ${g.method.padEnd(6)} ${g.path.padEnd(58)} ${g.operation}`);
    }
  }

  log.info("");
  log.info("不判的束（逐条写明理由；「跳过了但不说为什么」是这类清单腐烂的起点）：");
  for (const b of report.bundles.filter((x) => !x.inScope)) {
    log.info(`  [${b.phase}] ${b.bundle.padEnd(32)} ${b.reason}`);
  }

  if (report.unresolvedRoutes.length > 0) {
    log.info("");
    log.info(
      `静态解析不了的路由表达式 ${report.unresolvedRoutes.length} 条 —— ` +
        "既不算「有路由」也不算「没有路由」，它们是这份清单的精度上限：",
    );
    for (const u of report.unresolvedRoutes) log.info(`  ${u.file}  ${u.raw}`);
  }

  log.info("");
  log.info(
    "⚠ 束级粒度是往「少报」方向偏的近似：一个束里只要还有一个 not_started，整束都不判。" +
      "收紧它需要先有 operation ↔ feature 的映射（issue #1177 已知的难点第 1 条）。",
  );
}
