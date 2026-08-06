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
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { stringify } from "yaml";
import { analyzeRewriteCoverage, staleAllowlistEntries } from "./lib/rewrite-coverage.ts";
import { buildRewriteCoverageEvidence } from "./lib/rewrite-coverage-evidence.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONTROLLERS = join(ROOT, "apps/api/src/interface/controllers");
const NEXT_CONFIG = join(ROOT, "apps/web/next.config.mjs");
const ALLOWLIST = join(ROOT, ".harness/state/rewrite-coverage-allowlist.json");
// E1 验收（非 HMV2-066，见 lib/rewrite-coverage-evidence.ts 头部注释）：本次运行的判定结果同时落一份 TPL-EVD-001 实例，供
// `pnpm harness templates doctor` 扫到、按 E1 的 InstanceMetadata schema 校验。
// 不入库（.gitignore 里有注释解释理由，同 dep-graph.md 那条同一理由：
// 提交一份会过期的快照只会误导，重跑一遍就是最新状态）。
const EVIDENCE_INSTANCE = join(ROOT, ".harness/templates/instances/EVD-rewrite-coverage.yaml");

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
// incomplete 时也算——"扫不全"本身是真实的运行结果，不算过后再决定要不要记。
const stale = report.incomplete ? [] : staleAllowlistEntries(input);

// E1 验收：不管本次判定结果如何（含 incomplete），都落一份 TPL-EVD-001 实例。
// 失败就打印警告继续往下走——写证据失败不该掩盖判定本身的退出码。
try {
  mkdirSync(dirname(EVIDENCE_INSTANCE), { recursive: true });
  let commit = null;
  try {
    commit = execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    // 拿不到就留 null（比如浅克隆/无 git），不因为这个让证据写入整体失败。
  }
  const evidence = buildRewriteCoverageEvidence({
    report,
    staleAllowlistEntries: stale,
    allowlistSize: allowlist.length,
    generatedBy: "lint-rewrite-coverage.mjs",
    generatedAt: new Date().toISOString(),
    commit,
  });
  writeFileSync(EVIDENCE_INSTANCE, stringify(evidence), "utf8");
} catch (e) {
  console.warn(`! [rewrite-coverage] 写 TPL-EVD-001 证据实例失败（不影响本次判定退出码）：${e.message}`);
}

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
