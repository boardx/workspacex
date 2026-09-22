#!/usr/bin/env node
/**
 * lint-nav-reachability.mjs —— 跨屏可达性门控
 *
 * 管的是什么：ADR-023 的**签核材料**（十一束的 v2 屏）必须是**产品里走得到的屏**，
 * 而不是只能敲 URL 进的孤岛。它把「导航树（navigation.ts）↔ 契约束现行路由
 * （nav-reachability.config.json）」这条对应关系变成会红的断言。
 *
 * 为什么必须存在（血的事故）：
 *   十一束的全生命周期屏**全部做好了，却全部孤立**——左栏导航连的是另一套更旧的骨架屏，
 *   `新建项目` 点了弹 alert。三个独立 agent（最终用户 / UIUX / 需求）各自撞上同一根，
 *   得出同一句话：「评审签的和用户用的不是同一个产品」。
 *   而**没有任何门控能发现它**——旧门控（lint-ui-material / verify-ui-states）只验
 *   单屏七态，不验跨屏可达。这道门控补的正是这个盲区。
 *
 * 判定六条：
 *   ① 配置一致：nav-reachability.config[phase].bundleRoutes 的**键集合**必须与
 *      ui-material-map.json[phase] 的束集合**逐个相等**。新增束忘了配路由 ⇒ 红（点名）。
 *   ② 正向可达：每个束的 bundleRoute 必须**直接出现在** navigation.ts 的导航 href 里。
 *      束路由不在导航中 = 那个签核屏走不到 ⇒ 红（点名束 + 路由）。
 *   ③ 反向纯净：navigation.ts 里每个 href 必须**要么**是某束的 bundleRoute，
 *      **要么**在 allowRoutes（故意存在的非束路由）里。都不是 ⇒ 红（点名 href）——
 *      多半是又冒出来的旧骨架屏（如 /studio/interview）。
 *   ④ 无死链：navigation.ts 与 config 里出现的每个路由都必须能解析到 apps/web/app 下
 *      真实存在的 page（支持 [param] / [...catch] / (group)）。指向 404 ⇒ 红。
 *   ⑤ 非空：导航 href 集合、束集合都不得为空——空集会让 ②③ 平凡为真（本仓栽过的形状）。
 *   ⑥ 束内无孤儿页：某束路由**子树下**的每个 page（`/tpl` 束下的 `/tpl/designer` 之类）
 *      必须至少被一条**真实链接**引用（`href=` / `router.push()` / `redirect()`）。
 *      ①～⑤ 只看「导航树 ↔ 束入口」这一层，完全不看束入口**再往里**分叉出的屏：
 *      F318（issue #318）的病根正是这个盲区——`/tpl/designer` 是蓝本设计器的真实挂载点、
 *      路由解析得到、配置里也有，但全仓零 `<Link>`/`router.push` 指向它，导航和 CTA
 *      都还接在 `/tpl?screen=designer` 这个原型态上，五条判定全绿而屏仍然走不到。
 *      不算孤儿的四种情形（**三种机械判定 + 一种显式登记**）：
 *        · 该路由本身是某束的 bundleRoute，或已在导航 href / allowRoutes 里（①～③ 已覆盖）；
 *        · 该 page 是**重定向桩**（模块里只有 `redirect()`/`permanentRedirect()`、不渲染 JSX），
 *          如 `/itv/new`、`/studio/interview`——退役路由本就不该再被链接；
 *        · `next.config.mjs` 的 `redirects()` 把该路由声明成了 source（如 `/chat/copilotkit-v2`），
 *          正常流量根本到不了这棵树；
 *        · config 的 `linkExemptRoutes` 里**带理由**显式登记（故意只能敲 URL 进的独立路由）。
 *          它是**棘轮**：登记了却已经被链接 / 已经不存在的条目会红，只能变短，不能养成
 *          「一堆误报靠人肉豁免」的清单。
 *
 * 断言的是**性质不是数量**（COORDINATOR-LOOP 纪律第 9 条）：不写「导航项必须恰好 N 个」。
 *
 * 用法：node .harness/scripts/lint-nav-reachability.mjs [phase-dir-name …]
 *       不带参数 = 扫 config 里声明的全部 phase。
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const MAP_FILE = join(HERE, "ui-material-map.json");
const CONFIG_FILE = join(HERE, "nav-reachability.config.json");
const WEB_DIR = join(ROOT, "apps", "web");
const NAV_FILE = join(WEB_DIR, "lib", "navigation.ts");
const APP_DIR = join(WEB_DIR, "app");
const NEXT_CONFIG_FILE = join(WEB_DIR, "next.config.mjs");
/** ⑥ 扫「谁链接了谁」的范围。lib/ 也要扫：AdminNav（lib/mock/admin.ts）是真实的二级导航源。 */
const LINK_SCAN_DIRS = [APP_DIR, join(WEB_DIR, "components"), join(WEB_DIR, "lib")];

/** 从 navigation.ts 抽出所有导航 href（只认 `href: "..."` 键，注释里的裸路径不算）。 */
export function extractNavHrefs(navSource) {
  const out = [];
  const RE = /\bhref:\s*["'`]([^"'`]+)["'`]/g;
  for (const m of navSource.matchAll(RE)) out.push(m[1]);
  return out;
}

/**
 * 把一个 URL 路径解析到 apps/web/app 下的真实 page 文件。
 * 支持：静态段、[param] 动态段、[...slug] catch-all、(group) 路由组（透明，不吃段）。
 * 返回 boolean（能否解析到 page.{tsx,jsx,ts,js,mdx}）。
 */
export function appRouteExists(urlPath, appDir = APP_DIR) {
  const clean = urlPath.split("?")[0].split("#")[0];
  const segs = clean.split("/").filter(Boolean);
  const PAGE = ["page.tsx", "page.jsx", "page.ts", "page.js", "page.mdx"];
  const dirsIn = (dir) => {
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((n) => {
      try { return statSync(join(dir, n)).isDirectory(); } catch { return false; }
    });
  };
  const hasPage = (dir) => PAGE.some((p) => existsSync(join(dir, p)));

  const walk = (dir, rest) => {
    if (rest.length === 0) {
      if (hasPage(dir)) return true;
      // 末段也可能落在一个 (group) 里
      for (const g of dirsIn(dir)) if (/^\(.+\)$/.test(g) && walk(join(dir, g), rest)) return true;
      return false;
    }
    const [head, ...tail] = rest;
    const kids = dirsIn(dir);
    // 1) 精确静态段
    if (kids.includes(head) && walk(join(dir, head), tail)) return true;
    // 2) 动态段
    for (const d of kids) {
      if (/^\[\.\.\..+\]$/.test(d)) { if (hasPage(join(dir, d))) return true; }   // catch-all 吞掉剩余
      else if (/^\[[^.].*\]$/.test(d)) { if (walk(join(dir, d), tail)) return true; } // 单段动态
    }
    // 3) 路由组 (group)：透明，不消费段
    for (const g of kids) if (/^\(.+\)$/.test(g) && walk(join(dir, g), rest)) return true;
    return false;
  };
  return walk(appDir, segs);
}

/* ══════════════════════════════════════════════════════════════════════
   判定⑥ 的纯函数们 —— 「束内页面必须至少被一条真实链接引用」
   ══════════════════════════════════════════════════════════════════════ */

/**
 * 去掉注释，只留会真的执行到的代码。
 *
 * ⚠ 不能用 `/\*[\s\S]*?\*\//` 这种全文正则：本仓的行注释里大量出现 `/admin/*`、
 * `/platform-admin/*` 这类**路由通配写法**，它会被当成块注释起点，一路吞掉后面
 * 几十行真代码（实测：`lib/mock/admin.ts` 的 `href: "/tpl/list"` 就是这么被吞掉的，
 * 结果 `/tpl/list` 被误判成孤儿页）。这种漏掉链接的方向恰恰是**误报变红**的方向，
 * 正是 issue #319 点名要避免的「一堆误报靠人肉豁免」。
 *
 * 所以改成逐行处理，只把**行首**的 `/*` 当块注释起点（本仓 JSDoc 的写法），
 * 行内的 `//`、`/*` 则先判断是否落在引号里再决定截断。
 */
export function stripCommentsForLinkScan(source) {
  const out = [];
  let inBlock = false;
  let inBacktick = false;
  for (const raw of source.split("\n")) {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf("*/");
      if (end === -1) { out.push(""); continue; }
      line = line.slice(end + 2);
      inBlock = false;
    }
    // 行首就是块注释 / JSDoc 续行 ⇒ 整行丢弃（本仓的注释一律这个形状）
    const trimmed = line.trim();
    if (!inBacktick && trimmed.startsWith("/*")) {
      if (!trimmed.includes("*/")) inBlock = true;
      out.push("");
      continue;
    }
    if (!inBacktick && trimmed.startsWith("*")) { out.push(""); continue; }

    // 行内扫描：跟踪引号状态，只在引号外才认 `//`
    let quote = inBacktick ? "`" : null;
    let cut = line.length;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === "\\") { i++; continue; }
      if (quote) { if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
      if (c === "/" && line[i + 1] === "/") { cut = i; break; }
    }
    inBacktick = quote === "`";
    out.push(line.slice(0, cut));
  }
  return out.join("\n");
}

/**
 * 从一份源码里抽出所有**真实链接目标**。
 * 认的形状：`href="…"` / `href: "…"` / `href={"…"}`、`router.push/replace/prefetch("…")`、
 * `redirect("…")` / `permanentRedirect("…")`。模板字面量原样留着（带 `${}`），
 * 由 `routeMatchesTarget` 当通配处理。
 */
export function extractLinkTargets(source) {
  const code = stripCommentsForLinkScan(source);
  const RES = [
    /\bhref\s*[:=]\s*\{?\s*["'`]([^"'`]+)["'`]/g,
    /\b(?:router|navigation)\s*\.\s*(?:push|replace|prefetch)\s*\(\s*["'`]([^"'`]+)["'`]/g,
    /\b(?:redirect|permanentRedirect)\s*\(\s*["'`]([^"'`]+)["'`]/g,
  ];
  const out = [];
  for (const re of RES) for (const m of code.matchAll(re)) out.push(m[1]);
  return out;
}

/**
 * 枚举 apps/web/app 下所有 page，算出各自的 URL 路由。
 * `(group)` 透明不吃段；`[param]` / `[...slug]` 原样保留，由 `routeMatchesTarget` 做通配匹配。
 */
export function listAppPageRoutes(appDir = APP_DIR) {
  const PAGE_RE = /^page\.(tsx|jsx|ts|js|mdx)$/;
  const out = [];
  const walk = (dir, segs) => {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      const abs = join(dir, name);
      let st;
      try { st = statSync(abs); } catch { continue; }
      if (st.isDirectory()) walk(abs, /^\(.+\)$/.test(name) ? segs : [...segs, name]);
      else if (PAGE_RE.test(name)) out.push({ route: "/" + segs.join("/"), file: abs });
    }
  };
  walk(appDir, []);
  // 同一路由可能由多个 (group) 各挂一份 page —— 去重，取第一份做「自身文件」
  const seen = new Map();
  for (const p of out) {
    const route = p.route.length > 1 ? p.route.replace(/\/+$/, "") : "/";
    if (!seen.has(route)) seen.set(route, { route, file: p.file });
  }
  return [...seen.values()].sort((a, b) => a.route.localeCompare(b.route));
}

/**
 * 一条链接目标能否落到某个 page 路由上。
 *
 * 两头都可能带未知量，所以是**双向宽松**匹配（宁可算命中，不可算孤儿——
 * 漏判只是少拦一次，误判会逼人加豁免）：
 *   · 路由侧 `[param]` 吃任意一段，`[...slug]` 吃剩下全部；
 *   · 目标侧含 `${…}`（运行时拼出来的）的那一段视为通配。
 */
export function routeMatchesTarget(route, target) {
  const clean = String(target).split("?")[0].split("#")[0];
  if (!clean.startsWith("/")) return false;          // 相对路径 / 外链 / 锚点：解析不了，不算
  const rs = route.split("/").filter(Boolean);
  const ts = clean.split("/").filter(Boolean);
  for (let i = 0; i < rs.length; i++) {
    const seg = rs[i];
    if (/^\[\.\.\..+\]$/.test(seg)) return ts.length >= i + 1;   // catch-all 吞掉剩余
    if (i >= ts.length) return false;
    if (/^\[.+\]$/.test(seg)) continue;                          // 单段动态：吃任意一段
    if (ts[i] === seg) continue;
    if (ts[i].includes("${")) continue;                          // 运行时拼的段：当通配
    return false;
  }
  return ts.length === rs.length;
}

/**
 * 这个 page 是不是**重定向桩**（退役路由的兼容落点）。
 * 判据：去注释后调了 `redirect()`/`permanentRedirect()`，且整份文件不渲染任何 JSX。
 * 例：`app/itv/new/page.tsx`、`app/project/page.tsx`、`app/studio/interview/page.tsx`。
 */
export function isRedirectStubPage(source) {
  const code = stripCommentsForLinkScan(source);
  if (!/\b(?:redirect|permanentRedirect)\s*\(/.test(code)) return false;
  return !/<[A-Za-z]/.test(code);
}

/**
 * 从 next.config.mjs 的 `redirects()` 里抽出所有 `source`。
 * 这些路由正常流量根本到不了（构建期就被跳走），不该要求仓内还有链接指向它。
 * ⚠ 只扫 `redirects()` 这一个函数体，不扫 `rewrites()`（那是反代到 API 的，不是页面路由）。
 */
export function extractNextConfigRedirectSources(source) {
  const at = source.search(/\bredirects\s*\(\s*\)\s*\{/);
  if (at === -1) return [];
  const open = source.indexOf("{", source.indexOf("(", at));
  let depth = 0;
  let end = source.length;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  const body = stripCommentsForLinkScan(source.slice(open, end));
  return [...body.matchAll(/\bsource\s*:\s*["'`]([^"'`]+)["'`]/g)]
    // Next 的 `:threadId` / `:path*` 动态段换成本文件统一的 `[param]` 记法
    .map((m) => m[1].replace(/:([A-Za-z0-9_]+)\*/g, "[...$1]").replace(/:([A-Za-z0-9_]+)/g, "[$1]"));
}

/** 递归收集可扫描的源码文件（.ts/.tsx/.js/.jsx/.mjs）。 */
function collectSourceFiles(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (name === "node_modules" || name === ".next") continue;
    const abs = join(dir, name);
    let st;
    try { st = statSync(abs); } catch { continue; }
    if (st.isDirectory()) collectSourceFiles(abs, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) out.push(abs);
  }
  return out;
}

/** 建「文件 → 该文件里的链接目标」索引（一次调用内跨 phase 复用，只在真有候选页时才建）。 */
export function buildLinkIndex(dirs) {
  const index = new Map();
  for (const dir of dirs) {
    for (const file of collectSourceFiles(dir)) {
      if (index.has(file)) continue;
      let src;
      try { src = readFileSync(file, "utf8"); } catch { continue; }
      index.set(file, extractLinkTargets(src));
    }
  }
  return index;
}

export function lintNavReachability({
  mapFile = MAP_FILE, configFile = CONFIG_FILE, navFile = NAV_FILE, appDir = APP_DIR, only = [],
  linkScanDirs = null, nextConfigFile = NEXT_CONFIG_FILE,
} = {}) {
  const errors = [];
  const rows = [];
  // ⑥ 的扫描范围：默认 app + components + lib。测试传合成 appDir 时跟着换，别扫真仓库。
  const scanDirs = linkScanDirs ?? (appDir === APP_DIR ? LINK_SCAN_DIRS : [appDir]);
  let linkIndex = null;            // 懒建：没有候选页的调用一份文件都不读
  const linkTargetsOf = () => (linkIndex ??= buildLinkIndex(scanDirs));
  const map = JSON.parse(readFileSync(mapFile, "utf8"));
  const config = JSON.parse(readFileSync(configFile, "utf8"));

  if (!existsSync(navFile)) {
    errors.push(`[缺导航文件] 找不到 ${navFile} —— 无法验证可达性，视为失败。`);
    return { errors, rows };
  }
  const navSource = readFileSync(navFile, "utf8");
  const navHrefs = [...new Set(extractNavHrefs(navSource))];

  /* ── ⑤ 空集防线 ─────────────────────────────────────────────────────── */
  if (navHrefs.length === 0) {
    errors.push(`[导航为空] ${navFile} 里没抽到任何 href —— 空集会让正/反向判定平凡为真，视为失败。`);
    return { errors, rows };
  }

  let phases = Object.keys(config).filter((k) => !k.startsWith("//"));
  if (only.length) phases = phases.filter((p) => only.includes(p));
  if (phases.length === 0) {
    errors.push(`[无对象] config 里没有可检查的 phase（或 --only 过滤后为空），视为失败。`);
    return { errors, rows };
  }

  for (const phase of phases) {
    const label = phase;
    const { bundleRoutes, allowRoutes = [] } = config[phase] ?? {};
    if (!bundleRoutes || Object.keys(bundleRoutes).length === 0) {
      errors.push(`[配置缺失] ${label}: nav-reachability.config 里 bundleRoutes 为空，视为失败（空集不许平凡为真）。`);
      continue;
    }

    /* ── ① 配置键集合 == material-map 束集合 ───────────────────────────── */
    const declaredBundles = Object.keys(map[phase] ?? {}).filter((k) => !k.startsWith("//"));
    if (declaredBundles.length === 0) {
      errors.push(`[无束] ${label}: ui-material-map.json 里没有声明任何束，无法核对可达性。`);
      continue;
    }
    const cfgBundles = Object.keys(bundleRoutes);
    const missingInCfg = declaredBundles.filter((b) => !cfgBundles.includes(b));
    const extraInCfg = cfgBundles.filter((b) => !declaredBundles.includes(b));
    for (const b of missingInCfg) {
      errors.push(
        `[配置漏束] ${label}: 束「${b}」在 ui-material-map.json 里有签核材料，` +
        `但 nav-reachability.config 的 bundleRoutes 没给它配现行路由。\n` +
        `    这正是「签核屏走不到」会溜过去的口子——补一行 "${b}": "/<它的现行路由>"。`,
      );
    }
    for (const b of extraInCfg) {
      errors.push(
        `[配置多束] ${label}: bundleRoutes 里的「${b}」不在 ui-material-map.json 的束集合里。\n` +
        `    要么束改名/退役了（删这行），要么 material-map 漏声明（去那边补）。`,
      );
    }

    /* ── ④ 死链：束路由必须解析到真实 page ─────────────────────────────── */
    for (const [b, route] of Object.entries(bundleRoutes)) {
      if (!appRouteExists(route, appDir)) {
        errors.push(
          `[死链·束] ${label}: 束「${b}」配的现行路由 ${route} 在 apps/web/app 下解析不到 page。\n` +
          `    要么路由写错了，要么那个屏根本没建——签核材料指向 404 屏是最坏的一种。`,
        );
      }
    }

    /* ── ② 正向：每个束路由必须直接出现在导航里 ───────────────────────── */
    for (const [b, route] of Object.entries(bundleRoutes)) {
      if (!navHrefs.includes(route)) {
        errors.push(
          `[不可达] ${label}: 束「${b}」的现行屏 ${route} **不在** navigation.ts 的任何导航项里。\n` +
          `    用户从左栏一路点，永远到不了这个签核屏（这正是本轮病根）。\n` +
          `    修：往 apps/web/lib/navigation.ts 的某个语义段补一个 href 为 ${route} 的导航项。`,
        );
      }
    }

    /* ── ③ 反向：导航 href 必须属某束或在白名单 ─────────────────────────── */
    const bundleRouteSet = new Set(Object.values(bundleRoutes));
    const allowSet = new Set(allowRoutes);
    for (const href of navHrefs) {
      if (bundleRouteSet.has(href) || allowSet.has(href)) continue;
      errors.push(
        `[导航指向非法屏] ${label}: navigation.ts 有一个导航项指向 ${href}，` +
        `它既不是任何契约束的现行路由，也不在 allowRoutes 白名单里。\n` +
        `    这多半是又冒出来的旧骨架屏（本轮退役了 /studio/interview、/studio/prototype）。\n` +
        `    修二选一：(a) 若它其实是某束的现行屏，去 bundleRoutes 改对；\n` +
        `             (b) 若它是别的能力域/阶段的正当入口，去 allowRoutes 显式登记一行。`,
      );
    }

    /* ── ④ 死链：导航里出现但白名单/束都指到的路由也要能解析（含 allowRoutes）── */
    for (const href of navHrefs) {
      if (!appRouteExists(href, appDir)) {
        errors.push(
          `[死链·导航] ${label}: navigation.ts 的导航项 ${href} 在 apps/web/app 下解析不到 page（死导航）。`,
        );
      }
    }

    /* ── ⑥ 束内孤儿页：束路由子树下的每个 page 必须被真实链接引用过 ─────────── */
    // `//`-前缀键是本仓 JSON 配置统一的注释写法（见 config 顶部），不是路由。
    const linkExemptRoutes = Object.fromEntries(
      Object.entries(config[phase]?.linkExemptRoutes ?? {}).filter(([k]) => !k.startsWith("//")),
    );
    const bundleRouteValues = [...new Set(Object.values(bundleRoutes))];
    const coveredByEarlierRules = new Set([...bundleRouteValues, ...allowRoutes, ...navHrefs]);
    const pages = listAppPageRoutes(appDir);

    // 「同束内页面」= 某个 bundleRoute 的**严格后代**路由（/tpl 束下的 /tpl/designer）。
    // 束入口本身由 ② 管，顶层无关路由不是本束的事——把范围收在子树里，才不会把
    // 「本来就只由导航可达的叶子页」整片拖进来（issue #319 点名的误报风险）。
    const candidates = pages.filter(
      (pg) => bundleRouteValues.some((br) => br !== "/" && pg.route.startsWith(br + "/")),
    );

    const usedExemptions = new Set();
    let redirectSources = null;
    for (const pg of candidates) {
      if (coveredByEarlierRules.has(pg.route)) continue;

      // 机械豁免 a：重定向桩（退役路由的兼容落点，本就不该再被链接）
      let pageSource = "";
      try { pageSource = readFileSync(pg.file, "utf8"); } catch { /* 读不到就按非桩处理 */ }
      if (isRedirectStubPage(pageSource)) continue;

      // 机械豁免 b：next.config 的 redirects() 把它声明成了 source，正常流量到不了
      redirectSources ??= existsSync(nextConfigFile)
        ? extractNextConfigRedirectSources(readFileSync(nextConfigFile, "utf8"))
        : [];
      if (redirectSources.some((src) => src === pg.route || routeMatchesTarget(pg.route, src))) continue;

      // 真找链接（**先查再豁免**：已经有入边的路由，它的豁免就是过期的，
      // 不能因为登记过就算「用上了」——否则清单只会越养越长，棘轮就废了）
      const hit = [...linkTargetsOf()].some(
        ([file, targets]) => file !== pg.file && targets.some((t) => routeMatchesTarget(pg.route, t)),
      );
      if (hit) continue;

      // 显式豁免：config 里带理由登记过
      if (Object.prototype.hasOwnProperty.call(linkExemptRoutes, pg.route)) {
        usedExemptions.add(pg.route);
        if (!String(linkExemptRoutes[pg.route] ?? "").trim()) {
          errors.push(
            `[豁免无理由] ${label}: linkExemptRoutes 里的 ${pg.route} 理由是空的。\n` +
            `    「故意只能敲 URL 进」是个结论，得写清楚为什么——空理由的豁免就是静默漏检。`,
          );
        }
        continue;
      }

      const owner = bundleRouteValues.filter((br) => br !== "/" && pg.route.startsWith(br + "/"));
      errors.push(
        `[束内孤儿页] ${label}: ${pg.route}（${relative(ROOT, pg.file)}）挂在束路由 ${owner.join(" / ")} 底下，` +
        `但全仓没有任何真实链接指向它。\n` +
        `    它路由解析得到、配置里也齐全，所以①～⑤ 全绿——F318 的病根就是这个形状：\n` +
        `    屏做好了、挂对了，入口却还接在别的原型态上，用户一路点永远走不到。\n` +
        `    修三选一：(a) 在导航/CTA 里补一条指向它的 href 或 router.push；\n` +
        `             (b) 若它已退役，改成 redirect() 桩或在 next.config 的 redirects() 里登记；\n` +
        `             (c) 若它**故意**只能敲 URL 进，去 nav-reachability.config 的 linkExemptRoutes\n` +
        `                 登记 "${pg.route}": "<为什么>"——理由不许空。`,
      );
    }

    // 棘轮：登记了却已经不需要的豁免必须清掉，否则清单只会越养越长
    for (const route of Object.keys(linkExemptRoutes)) {
      if (usedExemptions.has(route)) continue;
      errors.push(
        `[豁免已过期] ${label}: linkExemptRoutes 登记了 ${route}，但它现在不是待判的束内孤儿页` +
        `（已经被链接上了 / 已经是重定向桩 / 页面没了 / 不在任何束子树下）。\n` +
        `    删掉这一行——豁免清单只许变短。留着它，下次这个路由真的漂了也不会有人发现。`,
      );
    }

    rows.push({
      label,
      bundles: declaredBundles.length,
      navHrefs: navHrefs.length,
      reachable: Object.values(bundleRoutes).filter((r) => navHrefs.includes(r)).length,
      subPages: candidates.length,
    });
  }

  return { errors, rows };
}

/* ── CLI ──────────────────────────────────────────────────────────────── */
if (process.argv[1] && process.argv[1].endsWith("lint-nav-reachability.mjs")) {
  const { errors, rows } = lintNavReachability({ only: process.argv.slice(2) });
  for (const r of rows) {
    const ok = r.reachable === r.bundles;
    console.log(
      `  ${ok ? "✓" : "✗"} ${r.label.padEnd(30)} 束可达 ${String(r.reachable).padStart(2)}/${String(r.bundles).padEnd(2)}` +
      ` · 导航项 ${r.navHrefs} · 束内子页 ${r.subPages}`,
    );
  }
  if (errors.length) {
    console.error("");
    for (const e of errors) console.error(`✗ ${e}`);
    console.error(
      `\n❌ lint-nav-reachability: ${errors.length} 处可达性问题。` +
      `\n   ADR-023 的签核屏必须是产品里走得到的屏——导航树 ↔ 契约束现行路由，双向都要对得上。`,
    );
    process.exit(1);
  }
  console.log(
    `✅ lint-nav-reachability: 每个契约束的现行屏都能从 navigation.ts 直接走到，` +
    `且导航里没有指向非束/旧骨架屏的入口，无死链，束内也没有零引用的孤儿页。`,
  );
}
