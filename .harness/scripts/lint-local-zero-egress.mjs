#!/usr/bin/env node
/**
 * lint-local-zero-egress.mjs —— 本地版代码路径里不许硬编码外部主机（backlog C8 的静态半边）。
 *
 * ## 为什么要有这一道
 *
 * 方案承诺「本地零出网」（docs/research/open-source-business-model.md 承诺对照表）。动态那半边是
 * `apps/api/tests/local-desktop/zero-egress-unplugged.test.ts`：拔网跑代表性流程、断言非回环连接 0 次。
 * 但动态测试只覆盖它跑到的路径；桌面壳、本地运行时编排、本地 ASR 网关里一个没被测试跑到的
 * `fetch("https://…")`，照样能在用户机器上出网。这道门把「写死的外部地址」挡在源码层。
 *
 * ## 查什么
 *
 * 扫 `LOCAL_ROOTS` 里的源码（非注释行）：出现 `http(s)://<主机>` 且主机不是回环
 * （localhost / 127.x / ::1 / 0.0.0.0）⇒ 红。
 *
 * 确需外连的一行（例如首次安装时下载模型——那是用户点的「下载」，不属于运行期）写明理由：
 *   `// egress-allowed: <为什么这里可以出网>`
 * 理由为空同样判红：一个不写理由的豁免只是一个关掉的开关。
 *
 * ## 这道门对自己断言的一件事
 *
 * 扫到的源码文件为 0 ⇒ 判失败：空集不是全绿（目录改名后这道门会静默失效）。
 *
 * 用法：
 *   node .harness/scripts/lint-local-zero-egress.mjs
 *   node .harness/scripts/lint-local-zero-egress.mjs --root <仓库根>   # 测试用
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const argRoot = process.argv.indexOf("--root");
const ROOT = argRoot > -1
  ? resolve(process.argv[argRoot + 1])
  : join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** 只在本地版里运行的代码。API 进程由运行期守卫 + 拔网 e2e 覆盖，不在这里。 */
export const LOCAL_ROOTS = ["packages/local-runtime/src", "apps/desktop/src", "apps/local-asr-gateway/src"];

const SKIP = new Set(["node_modules", "dist", "build", ".next", ".turbo", "coverage"]);
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(e) && !/\.test\./.test(e)) out.push(p);
  }
  return out;
}

const URL_RE = /\bhttps?:\/\/(\[[^\]]+\]|[A-Za-z0-9.\-]+)/g;
const LOOPBACK = (h) => {
  const x = h.replace(/^\[|\]$/g, "").toLowerCase();
  // `*.localhost` 按 RFC 6761 恒解析到回环（本地版的隔离下载源 `downloads.localhost` 就靠它）
  return x === "localhost" || x.endsWith(".localhost") || x === "::1" || x === "0.0.0.0" || /^127\./.test(x);
};
const isComment = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);

const findings = [];
let fileCount = 0;
for (const r of LOCAL_ROOTS) {
  const abs = join(ROOT, r);
  if (!existsSync(abs)) continue;
  for (const f of walk(abs)) {
    fileCount++;
    const lines = readFileSync(f, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (isComment(line)) return;
      const allow = /egress-allowed:\s*(.*)$/.exec(line);
      for (const m of line.matchAll(URL_RE)) {
        if (LOOPBACK(m[1])) continue;
        if (allow && allow[1].trim().length > 0) continue;
        findings.push({
          where: `${relative(ROOT, f)}:${i + 1}`,
          what: allow ? `豁免没写理由：${m[0]}` : `硬编码外部地址 ${m[0]}`,
        });
      }
    });
  }
}

console.log(`本地零出网静态检查：扫描 ${LOCAL_ROOTS.length} 个本地版目录、源码文件 ${fileCount} 个，违规 ${findings.length} 处`);
if (fileCount === 0) {
  console.error("扫到 0 个本地版源码文件——空集不是全绿，判失败。检查 LOCAL_ROOTS 是否随目录改名更新。");
  process.exit(1);
}
if (findings.length) {
  for (const f of findings) console.error(`  ${f.where}\n    ${f.what}`);
  console.error("\n本地版承诺零出网：外部地址不许写死在本地代码路径里。确需外连的一行写 `// egress-allowed: <理由>`。");
  process.exit(1);
}
console.log("✅ 本地版代码路径没有硬编码外部主机");
