#!/usr/bin/env node
/**
 * lint-no-backend-badge.mjs —— 「零后端模块必须标注」门控（#621）
 *
 * 管的是什么：`apps/web/app/admin/**` 下每一个后台模块页，如果它的数据**完全来自**
 * `lib/mock/*`、且从未调用过 `apiRequest` 或 `lib/live-*`（= 没有任何真实后端接线），
 * 就必须渲染 `<NoBackendNotice />`（`apps/web/components/admin/no-backend-notice.tsx`）。
 *
 * 为什么必须存在：MCP 后台页（组织"远洋咨询"、6 台服务器、token 配额条）全仓零后端——
 * 没有 controller，前端也没接 `apiRequest`/`live-*`，但页头只挂了 `SampleConfigNotice`
 * （语义是"后端真实、这是组织自行配置的示例"）。同一条提示把"没做"读成了"设计决定"，
 * 人类因此困惑地问"这些是不是 mockup 的数据"——这正是 #621 的起因。
 *
 * 判定的是**关系**，不是写死的模块名单：
 *   1. 从 `apps/web/app/admin/page.tsx` 与 `apps/web/app/admin/[module]/page.tsx` 的
 *      import 语句里，动态抽出全部「模块 → 屏组件文件」的映射（新增/删除模块不用改本脚本）。
 *   2. 对每个屏组件文件的源码：
 *        usesMock        = 是否 import 了 `@/lib/mock/*` 下的任何模块
 *        usesRealBackend = 是否出现 `apiRequest`，或 import 了 `@/lib/live-*`
 *        rendersNotice   = 是否 import 了 `NoBackendNotice` 且在 JSX 里用了 `<NoBackendNotice`
 *   3. usesMock && !usesRealBackend && !rendersNotice ⇒ 报错，点名该屏文件。
 *
 * 用法：node apps/web/scripts/lint-no-backend-badge.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(HERE, "..");
const OVERVIEW_PAGE = join(WEB_ROOT, "app", "admin", "page.tsx");
const MODULE_PAGE = join(WEB_ROOT, "app", "admin", "[module]", "page.tsx");
const COMPONENTS_DIR = join(WEB_ROOT, "components", "admin");

/**
 * 从一段源码里抽出「本地 Screen 组件的 import」：
 *   import { XyzScreen } from "@/components/admin/xyz-screen";
 * 只认 `@/components/admin/...` 前缀，且导入名以 `Screen` 结尾——这两条都是「关系」，
 * 不是钉死的模块名单：新增一个 `FooScreen` 会被自动纳入，不用改这个脚本。
 */
export function extractScreenImports(source) {
  const out = [];
  const RE = /import\s*\{\s*([A-Za-z0-9_]+Screen)\s*\}\s*from\s*["']@\/components\/admin\/([^"']+)["']/g;
  for (const m of source.matchAll(RE)) out.push({ name: m[1], relPath: m[2] });
  return out;
}

/** 判定单个屏组件文件的后端接线状态。 */
export function classifyScreenFile(filePath) {
  if (!existsSync(filePath)) {
    return { exists: false, usesMock: false, usesRealBackend: false, rendersNotice: false };
  }
  const src = readFileSync(filePath, "utf8");
  const usesMock = /from\s*["']@\/lib\/mock\//.test(src);
  /*
   * #1165 —— 一个**带理由、且被验证**的例外：屏把真实请求拆进了同目录子组件。
   *
   * 背景：F160~F163 之后 `members-screen.tsx` 把三个 tab 与边界区拆成四个子组件，
   * 真实请求全在子组件里，屏文件自己只剩布局 + 几个仍是 mock 的引用 ⇒ 被判「零后端·未标注」。
   * 而那个判定的唯一修法是在一块**已经读真库**的屏上挂「尚未接入真实后端」——
   * 门控逼出一句假话，正是这道门存在的反面。
   *
   * ⚠ 我先试过「自动跟进所有 `./` 子组件」，**当场把门弄坏了**：每块零后端屏都 import
   *   `./no-backend-notice`，而那个文件的**文档注释里**逐字写着 `apiRequest` 与 `lib/live-*`
   *   （它在解释这条判定规则本身），于是全仓 8 块屏一起变成「非纯 mock」，零后端行数归零。
   *   是这个脚本自己的测试（`expect(zeroBackendRows.length).toBeGreaterThan(0)` 那条反空转
   *   断言）把它抓住的。⇒ 不做自动跟进。
   *
   * 现在的形态：屏文件必须显式写一行标记 + 理由，脚本再去**验证**那句理由是真的
   * （至少一个同目录子组件确实有后端调用，且判定前先剥掉注释，不让文档里的字算数）。
   * 没写标记的屏，判定逻辑与从前逐字节相同。
   */
  const stripComments = (text) =>
    text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
  const hasBackend = (text) => {
    const code = stripComments(text);
    return /\bapiRequest\b/.test(code) || /from\s*["']@\/lib\/live-[^"']+["']/.test(code);
  };

  const backedByChildren = /lint-no-backend-badge:backed-by-children\s*[—-]{1,2}\s*\S{10,}/.test(src);
  let childHasBackend = false;
  if (backedByChildren) {
    for (const m of src.matchAll(/from\s*["']\.\/([\w.-]+)["']/g)) {
      const childPath = resolve(dirname(filePath), `${m[1]}.tsx`);
      if (existsSync(childPath) && hasBackend(readFileSync(childPath, "utf8"))) {
        childHasBackend = true;
        break;
      }
    }
  }

  const usesRealBackend = hasBackend(src) || childHasBackend;
  const importsNotice = /import\s*\{[^}]*\bNoBackendNotice\b[^}]*\}\s*from\s*["'][^"']*no-backend-notice["']/.test(src);
  const rendersNotice = importsNotice && /<NoBackendNotice\b/.test(src);
  return { exists: true, usesMock, usesRealBackend, rendersNotice };
}

/** 主检查：从两个路由文件里抽出全部模块屏，逐个判定。 */
export function lintNoBackendBadge({
  overviewPage = OVERVIEW_PAGE, modulePage = MODULE_PAGE, componentsDir = COMPONENTS_DIR,
} = {}) {
  const errors = [];
  const rows = [];

  const sources = [];
  if (existsSync(overviewPage)) sources.push(readFileSync(overviewPage, "utf8"));
  if (existsSync(modulePage)) sources.push(readFileSync(modulePage, "utf8"));

  if (sources.length === 0) {
    errors.push(`[缺路由文件] 找不到 ${overviewPage} 或 ${modulePage} —— 无法枚举后台模块屏，视为失败。`);
    return { errors, rows };
  }

  const screens = new Map(); // name -> relPath
  for (const src of sources) {
    for (const { name, relPath } of extractScreenImports(src)) {
      screens.set(name, relPath);
    }
  }

  if (screens.size === 0) {
    errors.push(`[无屏] 路由文件里一个 \`XxxScreen\` 都没抽到——空集会让检查平凡通过，视为失败。`);
    return { errors, rows };
  }

  for (const [name, relPath] of screens) {
    const filePath = resolve(componentsDir, `${relPath}.tsx`);
    const { exists, usesMock, usesRealBackend, rendersNotice } = classifyScreenFile(filePath);
    if (!exists) {
      errors.push(`[死链] 屏 ${name} 在路由文件里 import 自 ${relPath}，但 ${filePath} 不存在。`);
      continue;
    }
    const zeroBackend = usesMock && !usesRealBackend;
    rows.push({ name, relPath, zeroBackend, rendersNotice });
    if (zeroBackend && !rendersNotice) {
      errors.push(
        `[未标注] 屏 ${name}（${relPath}.tsx）的数据完全来自 lib/mock/*，且从未调用 apiRequest ` +
        `或 lib/live-*（= 零后端），但没有渲染 <NoBackendNotice />。\n` +
        `    修：在该屏的 <AdminScreen ...> 上传 noticeOverride={<NoBackendNotice />}` +
        `（或直接在 JSX 里渲染 <NoBackendNotice />），并 import { NoBackendNotice } from "./no-backend-notice"。`,
      );
    }
  }

  return { errors, rows };
}

/* ── CLI ──────────────────────────────────────────────────────────────── */
if (process.argv[1] && process.argv[1].endsWith("lint-no-backend-badge.mjs")) {
  const { errors, rows } = lintNoBackendBadge();
  for (const r of rows) {
    const mark = r.zeroBackend ? (r.rendersNotice ? "✓ 零后端·已标注" : "✗ 零后端·未标注") : "· 非纯 mock";
    console.log(`  ${mark.padEnd(16)} ${r.name.padEnd(24)} ${r.relPath}.tsx`);
  }
  if (errors.length) {
    console.error("");
    for (const e of errors) console.error(`✗ ${e}`);
    console.error(`\n❌ lint-no-backend-badge: ${errors.length} 个零后端模块没有渲染 <NoBackendNotice />。`);
    process.exit(1);
  }
  console.log(`\n✅ lint-no-backend-badge: 每个零后端模块屏都渲染了 <NoBackendNotice />。`);
}
