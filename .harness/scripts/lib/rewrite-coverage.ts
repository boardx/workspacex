/**
 * rewrite-coverage.ts —— controller 路由与 `next.config.mjs` rewrites 的**成对关系**（#539）。
 *
 * ## 这道门防的是什么
 *
 * 漏一条 rewrite，请求**不会失败在网络层**：它被 Next 自己接住，返回一页 404 HTML，
 * 前端拿到 `Unexpected token '<'`。表现成「后端没实现」，而真相是「路由没接」。
 * 2026-08-05 一天之内同型四次：`/capabilities`、`/canvas/templates`、`/skills`、
 * `/agent-runs`。第五次（`/recording`）是我动手前主动查出来的——**靠人记得，就是这个结果**。
 *
 * ## 两个必须覆盖的形态（少一个门就是空转）
 *
 * 1. **空前缀 controller**：本仓 34 个 controller 里 **33 个是 `@Controller()`**，
 *    完整路径写在方法装饰器上。只读 `@Controller("x")` 的扫描器会漏掉 97% 的路由
 *    ——第四次事故（`AgentRunController`）栽的正是这里。
 * 2. **裸路径与 `:path*` 成对**：`/skills` 既是 GET 列表也是 POST 新建，
 *    而 `:path*` **匹配不到没有后缀的那一条**。前三次事故全是这个形态。
 *
 * ## 扫不全就不判（fail-closed，但方向是"不下结论"）
 *
 * 今天另一条事故的教训：`doctor` 用 `--limit 300` 硬截断，仓库长到 302 个 issue 那天
 * 最老的两条掉出窗口 ⇒ 误判审计链断裂，main 连红四次。修法不是换个更大的数字
 * （任何固定上限都会再次触顶），而是**把截断变成会被看见的事件**。
 *
 * 所以这里：扫到 0 个 controller、或 0 条 rewrite 规则 ⇒ **拒绝做否定性判断**，
 * 报 `incomplete` 让调用方降级为 WARN。**宁可不判，也不要用不完整的数据说"有缺口"。**
 */

export interface RouteFact {
  /** 完整路径，如 `/recording/sessions/:sessionId/segments` */
  path: string;
  /** 一级前缀，如 `recording` */
  head: string;
  /** 该路径是否就是裸前缀本身（`/skills`），而不是更深的路径 */
  bare: boolean;
  source: string;
}

export interface CoverageGap {
  head: string;
  /** `bare` = 缺裸路径那一条；`deep` = 缺 `:path*` 那一条 */
  kind: "bare" | "deep";
  /** 举一个会打到 Next 404 的真实路径，让人一眼看出后果 */
  example: string;
}

export interface CoverageReport {
  /** true = 输入不足以做判断，调用方必须降级为 WARN 而不是报缺口 */
  incomplete: boolean;
  incompleteReason: string | null;
  routes: RouteFact[];
  coveredBare: Set<string>;
  coveredDeep: Set<string>;
  gaps: CoverageGap[];
}

const METHOD_DECORATOR = /@(?:Get|Post|Put|Patch|Delete)\(\s*"([^"]*)"\s*\)/g;
const CONTROLLER_PREFIX = /@Controller\(\s*(?:"([^"]*)")?\s*\)/;

function joinPath(prefix: string, tail: string): string {
  const a = prefix.replace(/\/+$/, "");
  const b = tail.startsWith("/") ? tail : `/${tail}`;
  return `${a}${b}` || "/";
}

/** 从一份 controller 源码里抽出它挂的全部路由。空前缀与带前缀两种形态都覆盖。 */
export function extractRoutes(source: string, fileName: string): RouteFact[] {
  const prefixMatch = CONTROLLER_PREFIX.exec(source);
  // `@Controller()` → 空前缀，完整路径在方法装饰器上（本仓 33/34 是这种）
  const prefix = prefixMatch?.[1] ?? "";
  const out: RouteFact[] = [];
  for (const m of source.matchAll(METHOD_DECORATOR)) {
    const full = joinPath(prefix, m[1] ?? "");
    const segments = full.split("/").filter(Boolean);
    const head = segments[0];
    if (!head) continue;
    out.push({ path: full, head, bare: segments.length === 1, source: fileName });
  }
  return out;
}

const REWRITE_SOURCE = /source:\s*`\$\{prefix\}(\/[^`]*)`/g;

/** 从 `next.config.mjs` 抽出被覆盖的前缀，区分「裸路径」与「`:path*` 深路径」。 */
export function extractRewrites(config: string): { bare: Set<string>; deep: Set<string>; total: number } {
  const bare = new Set<string>();
  const deep = new Set<string>();
  let total = 0;
  for (const m of config.matchAll(REWRITE_SOURCE)) {
    total += 1;
    const src = m[1]!;
    const segments = src.split("/").filter(Boolean);
    const head = segments[0];
    if (!head || head.startsWith(":")) continue;
    if (segments.length === 1) bare.add(head);
    // `/x/:path*` 或任何更深的具体路径都算覆盖了该前缀的深路径
    else deep.add(head);
  }
  return { bare, deep, total };
}

export interface CoverageInput {
  controllers: Array<{ file: string; source: string }>;
  nextConfig: string;
  /** 棘轮：当前已知缺口。只能变短，不能变长。 */
  allowlist: readonly string[];
}

export function analyzeRewriteCoverage(input: CoverageInput): CoverageReport {
  const routes = input.controllers.flatMap((c) => extractRoutes(c.source, c.file));
  const { bare, deep, total } = extractRewrites(input.nextConfig);

  // 扫不全就不判。空结果最可能的成因是"扫描器坏了/文件挪了"，
  // 而不是"这个仓库真的一条 controller 都没有"。
  if (routes.length === 0) {
    return empty("扫到 0 条 controller 路由——扫描器或路径失效，拒绝据此判定缺口");
  }
  if (total === 0) {
    return empty("扫到 0 条 rewrite 规则——next.config.mjs 结构可能变了，拒绝据此判定缺口");
  }

  const allow = new Set(input.allowlist);
  const gaps: CoverageGap[] = [];
  const seen = new Set<string>();
  for (const route of routes) {
    const key = `${route.head}:${route.bare ? "bare" : "deep"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (allow.has(route.head)) continue;
    if (route.bare && !bare.has(route.head)) {
      gaps.push({ head: route.head, kind: "bare", example: route.path });
    }
    if (!route.bare && !deep.has(route.head)) {
      gaps.push({ head: route.head, kind: "deep", example: route.path });
    }
  }

  return { incomplete: false, incompleteReason: null, routes, coveredBare: bare, coveredDeep: deep, gaps };

  function empty(reason: string): CoverageReport {
    return {
      incomplete: true,
      incompleteReason: reason,
      routes,
      coveredBare: bare,
      coveredDeep: deep,
      gaps: [],
    };
  }
}

/** 棘轮体检：allowlist 里已经不再缺失的条目应当被删掉，否则它会一直遮住回归。 */
export function staleAllowlistEntries(input: CoverageInput): string[] {
  const withoutAllow = analyzeRewriteCoverage({ ...input, allowlist: [] });
  if (withoutAllow.incomplete) return [];
  const stillMissing = new Set(withoutAllow.gaps.map((g) => g.head));
  return input.allowlist.filter((head) => !stillMissing.has(head));
}
