#!/usr/bin/env node
// lint-rewrite-coverage.mjs —— #539 的仓库侧入口。
//
// 判定逻辑全在 lib/rewrite-coverage.ts（纯函数、喂 fixture 单测）。这里只做三件事：
// 读真实文件 → 调它 → 按结果决定退出码。
//
// 退出码语义：
//   0  没有新缺口（或输入不足以判定，此时降级为 WARN）
//   1  有新缺口 / allowlist 有陈旧条目
//
// ⚠ 「输入不足以判定」为什么不红：今天 doctor 用 `--limit 300` 硬截断，仓库长到
// 302 个 issue 那天最老的两条掉出窗口 ⇒ 误判审计链断裂，main 连红四次。
// 任何固定上限都会再次触顶，所以这里的做法是**把截断变成会被看见的事件**——
// 扫不全就大声说扫不全，不用不完整的数据做否定性判断。
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeRewriteCoverage, staleAllowlistEntries } from "./lib/rewrite-coverage.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONTROLLERS = join(ROOT, "apps/api/src/interface/controllers");
const NEXT_CONFIG = join(ROOT, "apps/web/next.config.mjs");
const ALLOWLIST = join(ROOT, ".harness/state/rewrite-coverage-allowlist.json");

function readControllers() {
  if (!existsSync(CONTROLLERS)) return [];
  return readdirSync(CONTROLLERS)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => ({ file: f, source: readFileSync(join(CONTROLLERS, f), "utf8") }));
}

const allowlistDoc = existsSync(ALLOWLIST)
  ? JSON.parse(readFileSync(ALLOWLIST, "utf8"))
  : { prefixes: [] };
const allowlist = allowlistDoc.prefixes ?? [];

const input = {
  controllers: readControllers(),
  nextConfig: existsSync(NEXT_CONFIG) ? readFileSync(NEXT_CONFIG, "utf8") : "",
  allowlist,
};

const report = analyzeRewriteCoverage(input);

if (report.incomplete) {
  console.warn(`! [rewrite-coverage] 扫不全，本次不判定：${report.incompleteReason}`);
  console.warn("  这不是「通过」，是「没做判断」——请修扫描器或路径，别让它一直静默。");
  process.exit(0);
}

let failed = false;

if (report.gaps.length > 0) {
  failed = true;
  console.error(`✗ [rewrite-coverage] ${report.gaps.length} 条路由前端够不到：`);
  for (const gap of report.gaps) {
    const need = gap.kind === "bare"
      ? `{ source: \`\${prefix}/${gap.head}\`, destination: \`\${apiOrigin}/${gap.head}\` }`
      : `{ source: \`\${prefix}/${gap.head}/:path*\`, destination: \`\${apiOrigin}/${gap.head}/:path*\` }`;
    console.error(`   · ${gap.example}  —— 会被 Next 接住返回 404 HTML（前端拿到 Unexpected token '<'）`);
    console.error(`     在 apps/web/next.config.mjs 补：${need}`);
  }
}

const stale = staleAllowlistEntries(input);
if (stale.length > 0) {
  failed = true;
  console.error(`✗ [rewrite-coverage] allowlist 有 ${stale.length} 条已经不缺了，请删掉：${stale.join(", ")}`);
  console.error("   棘轮只减不增。留着已补好的豁免，等于给未来的回归留一扇没人看守的门。");
}

if (!failed) {
  console.log(
    `✓ [rewrite-coverage] ${report.routes.length} 条路由、${report.coveredBare.size + report.coveredDeep.size} 条 rewrite 覆盖一致` +
      (allowlist.length > 0 ? `（${allowlist.length} 条历史缺口在棘轮名单里，只能变短）` : ""),
  );
}

process.exit(failed ? 1 : 0);
