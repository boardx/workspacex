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
 * 判定五条：
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
 *
 * 断言的是**性质不是数量**（COORDINATOR-LOOP 纪律第 9 条）：不写「导航项必须恰好 N 个」。
 *
 * 用法：node .harness/scripts/lint-nav-reachability.mjs [phase-dir-name …]
 *       不带参数 = 扫 config 里声明的全部 phase。
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const MAP_FILE = join(HERE, "ui-material-map.json");
const CONFIG_FILE = join(HERE, "nav-reachability.config.json");
const NAV_FILE = join(ROOT, "apps", "web", "lib", "navigation.ts");
const APP_DIR = join(ROOT, "apps", "web", "app");

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

export function lintNavReachability({
  mapFile = MAP_FILE, configFile = CONFIG_FILE, navFile = NAV_FILE, appDir = APP_DIR, only = [],
} = {}) {
  const errors = [];
  const rows = [];
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

    rows.push({
      label,
      bundles: declaredBundles.length,
      navHrefs: navHrefs.length,
      reachable: Object.values(bundleRoutes).filter((r) => navHrefs.includes(r)).length,
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
      ` · 导航项 ${r.navHrefs}`,
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
    `且导航里没有指向非束/旧骨架屏的入口，无死链。`,
  );
}
