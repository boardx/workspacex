/**
 * 契约路由 ↔ 同源代理规则 覆盖判定（2026-09-29，workflow-runtime 代理缺口）。
 *
 * 为什么需要这一半：`rewrite-coverage.ts` 只扫 controller 源码里的**字面量**装饰器
 * （`@Get("/x")`）。路径来自契约常量（`@Get(C.operations.x.path)`）的 controller 它看不见——
 * `/platform`（2026-09-20）与 workflow-runtime 整族（`/workflow-instances`、
 * `/workflow-approvals`、`/workflows/:key/instances`）都是这样漏过门、在真栈上 404 的。
 * 这里直接以 `packages/contracts` 的 `path:` 定义为事实源，逐条拿**求值后**的
 * afterFiles 规则去匹配（不是按首段粗比：`/admin/*`、`/workflows/*` 只能逐条写，
 * 按首段比会把缺口判成已覆盖）。
 *
 * 纯函数、喂 fixture 单测；读文件与退出码在 `lint-rewrite-coverage.mjs`。
 */

export interface ContractRoute {
  path: string;
  file: string;
}

export interface ContractCoverageGap extends ContractRoute {
  head: string;
}

export interface ContractCoverageReport {
  incomplete: boolean;
  incompleteReason: string | null;
  routes: ContractRoute[];
  gaps: ContractCoverageGap[];
}

const CONTRACT_PATH = /\bpath:\s*["'`](\/[^"'`$]*)["'`]/g;

/** 从一份契约源码里抽出全部 HTTP 路径（`path: "/x/:id"`）。模板串插值的跳过。 */
export function extractContractRoutes(source: string, file: string): ContractRoute[] {
  const out: ContractRoute[] = [];
  for (const m of source.matchAll(CONTRACT_PATH)) {
    const path = m[1]!.split("?")[0]!;
    if (path.split("/").filter(Boolean).length === 0) continue;
    out.push({ path, file });
  }
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Next rewrite `source` → 正则。只支持本仓用到的形状：字面段、`:param`、末尾 `:path*` / `:path+`。 */
export function rewriteSourceToRegExp(source: string): RegExp {
  const body = source
    .split("/")
    .filter(Boolean)
    .map((seg) => {
      if (/^:\w+\*$/.test(seg)) return "(?:/[^/]+)*";
      if (/^:\w+\+$/.test(seg)) return "(?:/[^/]+)+";
      if (seg.startsWith(":")) return "/[^/]+";
      return `/${escapeRe(seg)}`;
    })
    .join("");
  return new RegExp(`^${body || "/"}$`);
}

export interface ContractCoverageInput {
  contracts: Array<{ file: string; source: string }>;
  /** 求值后的 afterFiles 规则（空前缀那一套）。 */
  rewrites: Array<{ source: string; destination: string; conditional?: boolean }>;
  /** 与 rewrite-coverage 共用的首段棘轮名单。 */
  allowlist: readonly string[];
}

export function analyzeContractRewriteCoverage(input: ContractCoverageInput): ContractCoverageReport {
  const routes = input.contracts.flatMap((c) => extractContractRoutes(c.source, c.file));
  // 只算往外代理的无条件规则：destination 指回内部页面的是放行规则，不是代理。
  const proxies = input.rewrites
    .filter((r) => !r.conditional && /^https?:\/\//.test(r.destination))
    .map((r) => rewriteSourceToRegExp(r.source));

  if (routes.length === 0) {
    return { incomplete: true, incompleteReason: "扫到 0 条契约路由——扫描器或路径失效，拒绝据此判定缺口", routes, gaps: [] };
  }
  if (proxies.length === 0) {
    return { incomplete: true, incompleteReason: "求值到 0 条代理 rewrite——next.config.mjs 结构可能变了", routes, gaps: [] };
  }

  const allow = new Set(input.allowlist);
  const gaps: ContractCoverageGap[] = [];
  const seen = new Set<string>();
  for (const route of routes) {
    if (seen.has(route.path)) continue;
    seen.add(route.path);
    const head = route.path.split("/").filter(Boolean)[0]!;
    if (allow.has(head)) continue;
    const concrete = route.path.replace(/:[^/]+/g, "x");
    if (!proxies.some((re) => re.test(concrete))) gaps.push({ ...route, head });
  }
  return { incomplete: false, incompleteReason: null, routes, gaps };
}
