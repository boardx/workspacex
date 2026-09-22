#!/usr/bin/env node
/**
 * lint-ui-wiring.mjs —— #397 的仓库侧入口：把真实仓库扫成快照，交给
 * `lib/ui-wiring.ts` 判定（判定逻辑全在那边，喂 fixture 单测；这里只做 IO）。
 *
 * 用法：
 *   pnpm exec tsx .harness/scripts/lint-ui-wiring.mjs            # 判定，红了退出 1
 *   pnpm exec tsx .harness/scripts/lint-ui-wiring.mjs --update   # 用当前代码重生成清单
 *   pnpm exec tsx .harness/scripts/lint-ui-wiring.mjs --root D   # 以 D 为仓库根（行为测试用）
 *   pnpm exec tsx .harness/scripts/lint-ui-wiring.mjs --manifest F  # 指定清单文件
 *
 * ⚠ `--update` 只搬**客观事实**（哪条路由够得到哪些适配器/契约/controller），
 *   人类字段（note / reason / ratchet 上限 / previewPrefixes / nonApiAdapters）原样保留。
 *   它是"改完代码后把清单同步回真相"的工具，**不是**"把红改绿"的工具——
 *   棘轮上限不会被它抬高，产品路由回退 mock 也不会被它洗白（重生成后照样红）。
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeUiWiring, isPreviewRoute } from "./lib/ui-wiring.ts";

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
};
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(flag("--root") ?? join(HERE, "..", ".."));
const MANIFEST = resolve(flag("--manifest") ?? join(ROOT, ".harness", "scripts", "ui-wiring-manifest.json"));
const UPDATE = argv.includes("--update");

const WEB = join(ROOT, "apps", "web");
const APP_DIR = join(WEB, "app");
const LIB_DIR = join(WEB, "lib");
const API_CLIENT = join(LIB_DIR, "api-client.ts");
const CONTROLLER_DIR = join(ROOT, "apps", "api", "src", "interface", "controllers");
const KERNEL = join(ROOT, "apps", "api", "src", "kernel.module.ts");
const CONTRACTS_DIR = join(ROOT, "packages", "contracts", "src");
const APPLICATION_DIR = join(ROOT, "apps", "api", "src", "application");

const rel = (p) => relative(ROOT, p).split("\\").join("/");
const read = (p) => readFileSync(p, "utf8");

/* ── 模块解析：`@/x` → apps/web/x，相对路径 → 同目录 ─────────────────── */
const EXTS = ["", ".ts", ".tsx", ".js", ".jsx", ".json"];
function resolveModule(spec, fromFile) {
  let base;
  if (spec.startsWith("@/")) base = join(WEB, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null; // 包依赖（@repo/contracts、react……）不进闭包
  for (const e of EXTS) {
    const p = base + e;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  for (const e of [".ts", ".tsx", ".js", ".jsx"]) {
    const p = join(base, `index${e}`);
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * 抽出一个源文件里的全部 import/require 说明符（含 `import type`、动态 `import()`、
 * `export … from`）。刻意抽**全部**：`import type` 也算够得到——本门判的是"这条屏
 * 声明了哪一层的东西"，而类型从 mock 文件里来同样说明它在拿 mock 当事实源。
 */
const SPEC_RE =
  /(?:^|[\s;}])(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g;
/**
 * 先剥注释再抽 import。
 *
 * ⚠ 这一步不是洁癖：`apps/web/lib/agent-interrupts-types.ts` 的文件头注里**逐字写着**
 *   一行 `import type {...} from "@/lib/mock/agent-interrupts"`（讲的正是"为什么不再
 *   这样写"）。不剥注释的扫描器会把那句人话当成一条真实 import 边，于是 `/chat` 整条
 *   线被判成"够得到 mock"——一个纯粹由注释造出来的假红。本仓在 `lint-ui-material` 上
 *   栽过同型的正则错（对每个束返回 0 处命中，看起来"全绿"），所以这里写明白。
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1"); // `://`（URL）不当行注释
}

function importSpecs(source) {
  const out = [];
  for (const m of stripComments(source).matchAll(SPEC_RE)) {
    const s = m[1] ?? m[2] ?? m[3];
    if (s) out.push(s);
  }
  return out;
}

const sourceCache = new Map();
function sourceOf(file) {
  if (!sourceCache.has(file)) sourceCache.set(file, existsSync(file) ? read(file) : "");
  return sourceCache.get(file);
}

/** 从一组入口文件出发的 import 闭包（仅 apps/web 内部）。 */
function closureOf(entries) {
  const seen = new Set();
  const stack = [...entries];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f) || !existsSync(f)) continue;
    seen.add(f);
    for (const spec of importSpecs(sourceOf(f))) {
      const r = resolveModule(spec, f);
      if (r && !seen.has(r)) stack.push(r);
    }
  }
  return seen;
}

const isLiveAdapter = (p) => /\/lib\/live-[^/]+\.tsx?$/.test(p.split("\\").join("/"));
const isMockModule = (p) => {
  const u = p.split("\\").join("/");
  return u.includes("/lib/mock/") || /\.mock\.tsx?$/.test(u);
};

/* ── ① 路由发现：apps/web/app 下的每个 page ───────────────────────────── */
function walkPages(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkPages(p, out);
    else if (/^page\.(tsx|ts|jsx|js|mdx)$/.test(name)) out.push(p);
  }
  return out;
}

function routeOf(pageFile) {
  const r = relative(APP_DIR, pageFile).split("\\").join("/").replace(/\/?page\.(tsx|ts|jsx|js|mdx)$/, "");
  const segs = r.split("/").filter((s) => s && !/^\(.+\)$/.test(s)); // (group) 段不进 URL
  return `/${segs.join("/")}`;
}

function routeFacts() {
  return walkPages(APP_DIR)
    .map((page) => {
      const entries = [page];
      let d = dirname(page);
      while (d.startsWith(APP_DIR)) {
        for (const l of ["layout.tsx", "layout.ts", "layout.jsx", "layout.js"]) {
          const p = join(d, l);
          if (existsSync(p)) entries.push(p);
        }
        if (d === APP_DIR) break;
        d = dirname(d);
      }
      const c = [...closureOf(entries)];
      return {
        route: routeOf(page),
        screen: rel(page),
        liveAdapters: c.filter(isLiveAdapter).map(rel).sort(),
        mockModules: c.filter(isMockModule).map(rel).sort(),
      };
    })
    .sort((a, b) => a.route.localeCompare(b.route));
}

/* ── ② 契约模块 id：`@repo/contracts` 的命名导出 ↔ 源文件基名 ──────────── */
function contractIndex() {
  const byExport = new Map();
  const idx = join(CONTRACTS_DIR, "index.ts");
  if (existsSync(idx)) {
    for (const m of read(idx).matchAll(/export\s+\*\s+as\s+(\w+)\s+from\s+["']\.\/([\w.-]+)["']/g)) {
      byExport.set(m[1], m[2]);
    }
  }
  const files = existsSync(CONTRACTS_DIR)
    ? readdirSync(CONTRACTS_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "index.ts")
    : [];
  const modules = files.map((f) => basename(f, ".ts")).sort();
  // 有没有 HTTP 面：契约里是否声明了 `path: "/…"`（操作定义的形状，见 packages/contracts/src/*.ts）。
  // 从源码推，不从清单声明——见 lib/ui-wiring.ts 里 httpContracts 的头注。
  const httpContracts = files
    .filter((f) => /\bpath:\s*["'`]\//.test(read(join(CONTRACTS_DIR, f))))
    .map((f) => basename(f, ".ts"))
    .sort();
  return { byExport, modules, httpContracts };
}

/** 一个源文件 import 到的契约模块 id 集合（两种写法：索引命名导出 / 子路径）。 */
function contractsUsedBy(source, byExport) {
  const ids = new Set();
  for (const m of source.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']@repo\/contracts["']/g)) {
    for (const piece of m[1].split(",")) {
      const name = piece.trim().split(/\s+as\s+/)[0].trim();
      const id = byExport.get(name);
      if (id) ids.add(id);
    }
  }
  for (const m of source.matchAll(/from\s*["']@repo\/contracts\/([\w.-]+)["']/g)) ids.add(m[1]);
  return [...ids].sort();
}

/* ── ③ 适配器事实 ───────────────────────────────────────────────────── */
function adapterFacts(byExport) {
  const out = {};
  if (!existsSync(LIB_DIR)) return out;
  for (const f of readdirSync(LIB_DIR)) {
    const p = join(LIB_DIR, f);
    if (!isLiveAdapter(p) || !statSync(p).isFile()) continue;
    const c = closureOf([p]);
    out[rel(p)] = {
      exists: true,
      reachesApiClient: c.has(API_CLIENT),
      contracts: contractsUsedBy(sourceOf(p), byExport),
    };
  }
  return out;
}

/* ── ④ controller 事实（含"有没有真的挂进 kernel"） ───────────────────── */
function registeredControllers() {
  if (!existsSync(KERNEL)) return new Set();
  const src = read(KERNEL);
  const at = src.indexOf("controllers: [");
  if (at < 0) return new Set();
  // 从 `controllers: [` 起按方括号配平取整个数组字面量，不用行号猜边界。
  let depth = 0, end = -1;
  for (let i = src.indexOf("[", at); i < src.length; i++) {
    if (src[i] === "[") depth++;
    else if (src[i] === "]") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return new Set();
  const body = src.slice(src.indexOf("[", at) + 1, end).replace(/\/\/[^\n]*/g, "");
  return new Set(body.split(/[,\s]+/).map((s) => s.trim()).filter((s) => /^[A-Z]\w+$/.test(s)));
}

const ROUTE_DECORATOR_RE = /@(?:Get|Post|Put|Patch|Delete|Head|Options|All|Sse)\s*\(/g;

function controllerFacts(byExport) {
  const out = {};
  if (!existsSync(CONTROLLER_DIR)) return out;
  const registered = registeredControllers();
  for (const f of readdirSync(CONTROLLER_DIR)) {
    if (!f.endsWith(".controller.ts") || f.endsWith(".test.ts")) continue;
    const p = join(CONTROLLER_DIR, f);
    const src = read(p);
    const contracts = contractsUsedBy(src, byExport);
    const applicationModules = [
      ...new Set(
        [...src.matchAll(/from\s*["'](?:\.\.\/)+application\/([\w./-]+)["']/g)].map((m) =>
          m[1].replace(/\.(ts|js)$/, ""),
        ),
      ),
    ].sort();
    // 类边界：按 `class X` 出现位置切片，每个 @Controller 类只数自己名下的路由装饰器。
    const classes = [...src.matchAll(/(?:export\s+)?class\s+(\w+)/g)];
    for (let i = 0; i < classes.length; i++) {
      const name = classes[i][1];
      const start = classes[i].index ?? 0;
      const end = i + 1 < classes.length ? classes[i + 1].index ?? src.length : src.length;
      const head = src.slice(Math.max(0, start - 400), start);
      if (!/@Controller\s*\([^)]*\)\s*$/.test(head.trimEnd())) continue; // 不是 controller 类
      out[name] = {
        file: rel(p),
        registered: registered.has(name),
        httpRoutes: (src.slice(start, end).match(ROUTE_DECORATOR_RE) ?? []).length,
        contracts,
        applicationModules,
      };
    }
  }
  return out;
}

/* ── ⑤ application 模块清单 ─────────────────────────────────────────── */
function applicationModules(dir = APPLICATION_DIR, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) applicationModules(p, out);
    else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) {
      out.push(relative(APPLICATION_DIR, p).split("\\").join("/").replace(/\.ts$/, ""));
    }
  }
  return out.sort();
}

/* ── 快照 ───────────────────────────────────────────────────────────── */
const { byExport, modules: contractModules, httpContracts } = contractIndex();
const snapshot = {
  routes: routeFacts(),
  adapters: adapterFacts(byExport),
  controllers: controllerFacts(byExport),
  contractModules,
  httpContracts,
  applicationModules: applicationModules(),
};

if (!existsSync(MANIFEST)) {
  console.error(`[缺清单] 找不到 ${rel(MANIFEST)} —— 没有清单就没有判据，视为失败。`);
  process.exit(1);
}
const manifest = JSON.parse(read(MANIFEST));

/* ── --update：用当前代码重生成清单的**事实**部分 ─────────────────────── */
if (UPDATE) {
  const nonApi = new Set((manifest.nonApiAdapters ?? []).map((a) => a.module));
  const routes = {};
  const usedControllers = new Set();
  const PORTS_RE = /(^|\/)[\w-]*ports?$|\.port$|(^|\/)[\w-]*-types?$/;
  for (const f of snapshot.routes) {
    const prev = manifest.routes?.[f.route] ?? {};
    const entry = { kind: "shell", screen: f.screen };
    if (isPreviewRoute(f.route, manifest)) entry.kind = "preview";
    else if (f.mockModules.length) { entry.kind = "mock"; entry.mocks = f.mockModules; }
    else if (f.liveAdapters.length) {
      entry.kind = "wired";
      entry.adapters = f.liveAdapters;
      const contracts = [...new Set(f.liveAdapters.flatMap((m) => snapshot.adapters[m]?.contracts ?? []))].sort();
      entry.contracts = contracts;
      entry.controllers = Object.entries(snapshot.controllers)
        .filter(([, c]) => c.registered && c.httpRoutes > 0 && c.contracts.some((x) => contracts.includes(x)))
        .map(([cls]) => cls)
        .sort();
      for (const cls of entry.controllers) usedControllers.add(cls);
      for (const m of f.liveAdapters) {
        if (!snapshot.adapters[m]?.reachesApiClient && !nonApi.has(m)) {
          console.warn(`[提醒] ${f.route} 的 ${m} 够不到 api-client —— 需要在 nonApiAdapters 里写明理由。`);
        }
      }
    }
    if (prev.note) entry.note = prev.note;
    routes[f.route] = entry;
  }
  const controllers = {};
  for (const cls of [...usedControllers].sort()) {
    const prev = manifest.controllers?.[cls] ?? {};
    controllers[cls] = {
      useCases: (snapshot.controllers[cls]?.applicationModules ?? []).filter((m) => !PORTS_RE.test(m)),
    };
    if (prev.note) controllers[cls].note = prev.note;
  }
  const next = { ...manifest, controllers, routes };
  writeFileSync(MANIFEST, `${JSON.stringify(next, null, 2)}\n`);
  const mockCount = Object.values(routes).filter((r) => r.kind === "mock").length;
  console.log(`[已重生成] ${rel(MANIFEST)}：${Object.keys(routes).length} 条路由，mock 豁免 ${mockCount} 条。`);
  console.log(`[提醒] 棘轮上限仍是 ${manifest.ratchet?.maxMockRoutes}——重生成不会替你抬高它。`);
}

/* ── 判定 ───────────────────────────────────────────────────────────── */
const verdict = analyzeUiWiring(JSON.parse(read(MANIFEST)), snapshot);
const { wired, mock, shell, preview } = verdict.counts;
console.log(
  `[ui-wiring] 路由 ${snapshot.routes.length} 条：已接线 ${wired} / mock 豁免 ${mock}` +
    `（上限 ${manifest.ratchet?.maxMockRoutes}）/ 无数据面 ${shell} / 原型 ${preview}；` +
    `controller ${Object.keys(snapshot.controllers).length} 个。`,
);
if (verdict.errors.length) {
  console.error(`\n跨层接线门控发现 ${verdict.errors.length} 处问题：`);
  for (const e of verdict.errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log("[ui-wiring] 清单与代码一致：每条产品路由都解析到已挂载的 controller 与 application 用例。");
