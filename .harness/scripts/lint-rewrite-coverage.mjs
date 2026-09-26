#!/usr/bin/env node
// lint-rewrite-coverage.mjs —— #539（正方向）与 #610（反方向）的仓库侧入口。
//
// 判定逻辑全在 lib/rewrite-coverage.ts 与 lib/rewrite-shadow.ts（纯函数、喂 fixture
// 单测）。这里只做三件事：读真实文件 → 调它们 → 按结果决定退出码。
//
// 两个方向，同一道门（#610）：
//   正向 `rewrite-coverage`：每条 API 路由，前端够得到吗？（漏一条 rewrite ⇒ 打到 Next 404 HTML）
//   反向 `rewrite-shadow`  ：每条 rewrite，会不会把一条前端页面路由代理走？
//                            （写宽一格 ⇒ 整片页面变成 API 的 JSON，看起来像前端解析 bug）
// 两边都会让失败伪装成别人的 bug，所以两边都要有门。
//
// 退出码语义：
//   0  没有新缺口、没有新遮蔽（或输入不足以判定，此时降级为 WARN）
//   1  有新缺口 / 有新遮蔽 / 任一 allowlist 有陈旧条目
//
// ⚠ 「输入不足以判定」为什么不红：今天 doctor 用 `--limit 300` 硬截断，仓库长到
// 302 个 issue 那天最老的两条掉出窗口 ⇒ 误判审计链断裂，main 连红四次。
// 任何固定上限都会再次触顶，所以这里的做法是**把截断变成会被看见的事件**——
// 扫不全就大声说扫不全，不用不完整的数据做否定性判断。
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execSync } from "node:child_process";
import { stringify } from "yaml";
import { analyzeRewriteCoverage, staleAllowlistEntries } from "./lib/rewrite-coverage.ts";
import { analyzeRewriteShadow, staleShadowAllowlistEntries } from "./lib/rewrite-shadow.ts";
import { buildRewriteCoverageEvidence } from "./lib/rewrite-coverage-evidence.ts";

// #2490：两个 CLI 旗标。
//   --strict  扫不全（incomplete）也退出非 0。PR 门控必须带它：一道 required check 在
//             「没做判断」时给绿，就是 fail-open——controller 目录挪走、next.config 读不到、
//             扫描器退化，PR 照样绿，门等于没装。本地/只读审计不带它，保留 WARN 降级。
//   --root D  以 D 为仓库根读输入（controllers/、next.config.mjs、allowlist）。只给行为测试
//             制造「扫不全」用；CI 的命令行里没有它，不构成绕过面（它是显式参数，不是环境变量）。
const argv = process.argv.slice(2);
const STRICT = argv.includes("--strict");
const rootArgIdx = argv.indexOf("--root");
const ROOT = rootArgIdx >= 0 && argv[rootArgIdx + 1]
  ? argv[rootArgIdx + 1]
  : join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONTROLLERS = join(ROOT, "apps/api/src/interface/controllers");
const NEXT_CONFIG = join(ROOT, "apps/web/next.config.mjs");
const ALLOWLIST = join(ROOT, ".harness/state/rewrite-coverage-allowlist.json");
const APP_DIR = join(ROOT, "apps/web/app");
const SHADOW_ALLOWLIST = join(ROOT, ".harness/state/rewrite-shadow-allowlist.json");
// 反向判定时喂给 next.config.mjs 的 apiOrigin。只用来认出「这条 destination 是往外代理的」，
// 不会真的去连它——具体是哪个地址不影响判定（判据是 destination 带不带 protocol）。
const SHADOW_API_ORIGIN = "http://127.0.0.1:65535";
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

/**
 * `apps/web/app` 下全部 `page.tsx` 的相对路径。目录遍历，不做 glob 依赖。
 * `node_modules` / `.next*` 不可能出现在 app 目录里，但跳过点开头的目录省得踩到
 * 编辑器/工具留下的临时目录。
 */
function readPageFiles(dir = APP_DIR, prefix = "") {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...readPageFiles(join(dir, entry.name), rel));
    else if (entry.name === "page.tsx") out.push(rel);
  }
  return out;
}

/**
 * 反向判定要的是**求值后**的 afterFiles 规则表，不是 next.config.mjs 的源码文本。
 *
 * ⚠ 为什么不像正方向那样用正则扫源码：这份 config 里的规则有相当一部分是**算出来的**
 *   （`/chat/${ns}` 那张命名空间表、#3492 那批 `.map(screen => …)` 的放行规则）。
 *   正则读不到它们 ⇒ 反向门会把**已经修好的**屏重新判成被遮蔽 ⇒ 门被放宽到能过为止。
 *   反向门最危险的不是漏报而是误报，所以这里直接 import 并调用 `rewrites()`。
 *
 * ⚠ 取**空前缀**那一套（`CHAT_READ_E2E_API_ORIGIN`）：`FULLSTACK_E2E_API_ORIGIN`
 *   那套的 prefix 是 `/__fullstack_api`，source 根本撞不上真实页面路径，用它判等于不判。
 *   空前缀同源代理正是 #3492 实测复现的那套，也是 deploy/ 里「同源 /api 域名」的形态。
 *
 * ⚠ 副作用告知：import 这份 config 会跑到它顶层那段 monaco 静态资源复制
 *   （约 24MB，复制到已 gitignore 的 `apps/web/public/monaco-editor/`，第二次起跳过）。
 *   那是 `next dev`/`next build` 本来每次都会跑的同一段，不是本门新引入的行为。
 */
async function readAfterFiles() {
  if (!existsSync(NEXT_CONFIG)) return { rules: [], reason: "读不到 apps/web/next.config.mjs" };
  const savedFullstack = process.env.FULLSTACK_E2E_API_ORIGIN;
  const savedChatRead = process.env.CHAT_READ_E2E_API_ORIGIN;
  try {
    delete process.env.FULLSTACK_E2E_API_ORIGIN;
    process.env.CHAT_READ_E2E_API_ORIGIN = SHADOW_API_ORIGIN;
    const mod = await import(pathToFileURL(NEXT_CONFIG).href);
    const rewrites = await mod.default?.rewrites?.();
    const afterFiles = rewrites?.afterFiles;
    if (!Array.isArray(afterFiles)) {
      return { rules: [], reason: "next.config.mjs 的 rewrites() 没有给出 afterFiles 数组——结构可能变了" };
    }
    return {
      rules: afterFiles.map((r) => ({
        source: String(r.source),
        destination: String(r.destination),
        conditional: Boolean(r.has || r.missing),
      })),
      reason: null,
    };
  } catch (e) {
    return { rules: [], reason: `求值 next.config.mjs 的 rewrites() 失败：${e.message}` };
  } finally {
    if (savedFullstack === undefined) delete process.env.FULLSTACK_E2E_API_ORIGIN;
    else process.env.FULLSTACK_E2E_API_ORIGIN = savedFullstack;
    if (savedChatRead === undefined) delete process.env.CHAT_READ_E2E_API_ORIGIN;
    else process.env.CHAT_READ_E2E_API_ORIGIN = savedChatRead;
  }
}

const allowlistDoc = existsSync(ALLOWLIST)
  ? JSON.parse(readFileSync(ALLOWLIST, "utf8"))
  : { prefixes: [] };
const allowlist = allowlistDoc.prefixes ?? [];

const shadowAllowlistDoc = existsSync(SHADOW_ALLOWLIST)
  ? JSON.parse(readFileSync(SHADOW_ALLOWLIST, "utf8"))
  : { shadows: [] };
// 没有 reason 的条目不算登记——棘轮条目的价值全在「为什么它今天是安全的」那句话上。
const shadowAllowlist = (shadowAllowlistDoc.shadows ?? [])
  .filter((e) => e && e.route && e.rewrite && typeof e.reason === "string" && e.reason.trim() !== "");

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

let failed = false;

// ───────────────────────── 正方向：每条 API 路由，前端够得到吗？（#539）
if (report.incomplete) {
  console.warn(`! [rewrite-coverage] 扫不全，本次不判定：${report.incompleteReason}`);
  console.warn("  这不是「通过」，是「没做判断」——请修扫描器或路径，别让它一直静默。");
  if (STRICT) {
    console.error("✗ [rewrite-coverage] --strict：门控模式下「没做判断」不能当绿，退出非 0（#2490）。");
    failed = true;
  }
} else {
  let forwardFailed = false;

  if (report.gaps.length > 0) {
    forwardFailed = true;
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
    forwardFailed = true;
    console.error(`✗ [rewrite-coverage] allowlist 有 ${stale.length} 条已经不缺了，请删掉：${stale.join(", ")}`);
    console.error("   棘轮只减不增。留着已补好的豁免，等于给未来的回归留一扇没人看守的门。");
  }

  if (!forwardFailed) {
    console.log(
      `✓ [rewrite-coverage] ${report.routes.length} 条路由、${report.coveredBare.size + report.coveredDeep.size} 条 rewrite 覆盖一致` +
        (allowlist.length > 0 ? `（${allowlist.length} 条历史缺口在棘轮名单里，只能变短）` : ""),
    );
  }
  failed ||= forwardFailed;
}

// ───────────────────────── 反方向：每条 rewrite，会不会把前端页面代理走？（#610）
//
// 正方向扫不全不影响这一半：两边读的是不同的输入（controller 源码 vs 页面路由 +
// 求值后的 rewrites），一边坏了不该让另一边跟着闭嘴。
const { rules: shadowRules, reason: shadowReadReason } = await readAfterFiles();
const shadowInput = {
  pageFiles: readPageFiles(),
  rewrites: shadowRules,
  allowlist: shadowAllowlist,
};
const shadowReport = analyzeRewriteShadow(shadowInput);
const shadowStale = shadowReport.incomplete ? [] : staleShadowAllowlistEntries(shadowInput);

if (shadowReport.incomplete) {
  console.warn(`! [rewrite-shadow] 扫不全，本次不判定：${shadowReadReason ?? shadowReport.incompleteReason}`);
  console.warn("  同上：这不是「通过」，是「没做判断」。");
  if (STRICT) {
    console.error("✗ [rewrite-shadow] --strict：门控模式下「没做判断」不能当绿，退出非 0（#2490 同一条理由）。");
    failed = true;
  }
} else {
  let shadowFailed = false;

  if (shadowReport.findings.length > 0) {
    shadowFailed = true;
    console.error(`✗ [rewrite-shadow] ${shadowReport.findings.length} 条前端页面路由被 rewrite 整条代理走：`);
    for (const f of shadowReport.findings) {
      console.error(`   · ${f.route}（apps/web/app/${f.file}）被 \`${f.rewrite}\` → ${f.destination} 吃掉`);
      console.error(`     例如 ${f.example} 会拿到 API 的 JSON/404，而不是这一页——看起来像前端解析 bug。`);
    }
    console.error("   修法（照 #3492 / PR #3806）：在通配**之前**补一条 destination 指向内部路径的放行规则，");
    console.error("   放行清单从该束自己的事实源取；别把通配收窄成 API 命名空间枚举（#2090 就是枚举漏项栽的）。");
    console.error(`   确认某条今天是安全的，就带上理由登记进 ${"rewrite-shadow-allowlist.json"}——棘轮只减不增。`);
  }

  if (shadowStale.length > 0) {
    shadowFailed = true;
    const names = shadowStale.map((e) => `${e.route} ← ${e.rewrite}`).join("; ");
    console.error(`✗ [rewrite-shadow] 棘轮名单有 ${shadowStale.length} 条已经不遮了，请删掉：${names}`);
    console.error("   棘轮只减不增。留着一条已修好的豁免，等于给未来的回归留一扇没人看守的门。");
  }

  if (!shadowFailed) {
    console.log(
      `✓ [rewrite-shadow] ${shadowReport.dynamicCount} 条动态页面路由（共 ${shadowReport.pages.length} 个 page.tsx）、` +
        `${shadowRules.length} 条 afterFiles 规则，没有新的遮蔽` +
        (shadowAllowlist.length > 0 ? `（${shadowAllowlist.length} 条既有遮蔽在棘轮名单里，只能变短）` : ""),
    );
  }
  failed ||= shadowFailed;
}

process.exit(failed ? 1 : 0);
