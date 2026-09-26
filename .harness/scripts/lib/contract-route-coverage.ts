/**
 * 契约 ↔ 路由覆盖判定（issue #1177）—— 「契约里声明了 `path` 的 operation，
 * 如果它落在一个**已经交付完**的契约束里，`apps/api/src/interface/` 里必须有对应路由」。
 *
 * ## 它要挡的失效：**feature 状态本身就是一个静态痕迹**
 *
 * 同一天撞到两次，形态完全一样（issue #1177 的表）：
 *
 *   · **F68**（消息级评价）`passing`：`rateMessage` 已签核、`RatingRepositoryPort` 有声明，
 *     infrastructure 无实现、HTTP 无路由，四条 verification 没有一条 import PgDatabase。
 *   · **F60**（Agent 行为审计 / 异常检测）`passing`：`listAnomalies` / `markAnomalyNormal` /
 *     `queryOrgAudit` 已签核、判定函数完整，无表、无路由、只有它自己的纯内存测试。
 *
 * ⚠ **这两个都不是假 passing。** feature 边界确实画在 application / domain 层，
 *   验证也如实覆盖了那一层——「F60 passing」是真的，它验的那层真的成立。
 *   问题在于**读的人推不出这件事**：`readiness` 队列、`doctor`、以及任何看 feature 状态
 *   做判断的地方，都会把它读成「这条能力可用了」。这正是根 `AGENTS.md`
 *   「静态痕迹 ≠ 动态事实」的一个新变种。
 *
 * ## 判据**不是**「每个契约 operation 都必须有路由」
 *
 * 那条判据是错的，实测数字说明为什么：SHA `ec074433` 上契约 operation 共 483 条，
 * interface 里找不到对应路由的有 **225** 条。绝大多数是**合法的未实现**——契约先行的
 * 项目里，`not_started` 的 feature 当然只有契约没有路由，那是设计而不是缺陷。
 * 一上来就把 225 条全报出来，只会逼人去关掉这道门。
 *
 * 所以判据按**契约束**取交集（issue #1177「已知的难点」第 1 条给的近似）：
 *
 *   一个束进入判定范围 ⟺ 它 `design-signoff.md` 的 `status: confirmed`
 *                        ∧ `covers:` 里至少有一个 feature 是 `passing`
 *                        ∧ `covers:` 里**没有**任何 feature 是 `not_started`
 *
 * 第三条是判据的重心：**`not_started` 是唯一能合法解释「契约有、路由没有」的状态**。
 * 一个还没开工的 feature 只有契约是设计，不是缺口。反过来，一个束里所有 feature 都
 * 已经开工、且至少一个已经 `passing`，那么「这个束的能力可用了」就是它正在对外
 * 发出的信号——此时契约里声明了 path 却没有路由的 operation，是读者推不出来的缺口。
 *
 * ⚠ **束级粒度是近似，且是往「少报」方向偏的近似。** operation ↔ feature 的映射今天
 *   不存在（`feature_list.json` 有 `spec_ref` 指向 UC，`design-signoff.md` 有 `covers:`
 *   指向 feature，但没有「这条 operation 属于哪个 feature」），所以只能按束。
 *   后果：一个束里哪怕只剩一个 `not_started`，整束都不判——`agent-runtime` 若有一天
 *   新进一个 `not_started` feature，`/anomalies` 那两条就会从清单上消失。
 *   这是**已知的假阴性**，不是 bug；把它写在这里，是为了下一个读它的人不会以为
 *   这道门比实际更强。收紧它需要先有 operation ↔ feature 的映射，那是另一件事。
 *
 * ## 路径匹配按**段**比，不按字符串 include
 *
 * issue #1177「已知的难点」第 2 条：NestJS 的 `@Controller("prefix")` + `@Get("sub")`
 * 会把一条 path 拆成两处，纯字符串比对会误报；而那个一次性勘探脚本用的
 * 「路径静态片段全部出现过」够估数量级，**做门控太松**（任何一个碰巧含有同名片段的
 * 别的路由都会把缺口判成已实现）。这里做三件事：
 *
 *   1. `@Controller(...)` 的前缀与方法装饰器的子路径**拼起来**再比。
 *   2. 比较按**段**做：`:param` / `*` 归一成通配符，通配符只与通配符匹配
 *      （`/threads/:id` **不**算实现了 `/threads/active`——那是两条不同的路由）。
 *   3. 本仓已有一批路由直接写 `@Get(C.operations.listAgents.path)`，这种**符号引用**
 *      是最强的证据：按 operation 名 + method 直接判定已实现，不经过字符串。
 *
 * 静态解析不了的路由表达式（模板字面量、变量前缀）逐条登记在
 * `unresolvedRoutes` 里并计入报告——**不当作「没有路由」，也不当作「有路由」**。
 * 一份说不清自己扫到了多少的清单，和没有清单一样。
 */

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "ALL"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** feature 状态里唯一能合法解释「契约有、路由没有」的那一个 */
export const LEGITIMATELY_UNIMPLEMENTED_STATUS = "not_started" as const;

export interface ContractOperation {
  readonly bundle: string;
  readonly contractFile: string;
  readonly name: string;
  readonly method: HttpMethod;
  readonly path: string;
}

/** 一条静态可解析的路由：controller 前缀已拼好 */
export interface RouteDecl {
  readonly file: string;
  readonly method: HttpMethod;
  /** 完整路径（前缀 + 子路径），已归一到以 `/` 开头、无尾斜杠 */
  readonly path: string | null;
  /** `@Get(C.operations.xxx.path)` 这类符号引用里的 operation 名 */
  readonly operationRef: string | null;
  readonly raw: string;
}

/** 静态解析不了的路由表达式（模板字面量 / 变量前缀）——报告里如实登记 */
export interface UnresolvedRoute {
  readonly file: string;
  readonly method: HttpMethod;
  readonly raw: string;
}

export interface BundleInput {
  readonly bundle: string;
  readonly phase: string;
  /** `packages/contracts/src/<bundle>.ts`；找不到同名契约文件时为 null */
  readonly contractFile: string | null;
  readonly contractSource: string | null;
  readonly signoffStatus: "confirmed" | "pending" | "missing";
  /** `design-signoff.md` frontmatter 的 `covers:`（ADR-023 决策三，束↔feature 映射的权威） */
  readonly covers: readonly string[];
  /** feature id → status。`covers:` 里点名但清单里查无此 feature 的，不出现在这里 */
  readonly featureStatus: Readonly<Record<string, string>>;
}

export interface BundleVerdict {
  readonly bundle: string;
  readonly phase: string;
  readonly contractFile: string | null;
  readonly inScope: boolean;
  /** 不判时的原因，原样进报告——「跳过了但不说为什么」是这道门最容易腐烂的地方 */
  readonly reason: string;
  readonly operationsWithPath: number;
}

export interface CoverageGap {
  readonly bundle: string;
  readonly phase: string;
  readonly operation: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly contractFile: string;
}

export interface CoverageReport {
  readonly bundles: readonly BundleVerdict[];
  readonly gaps: readonly CoverageGap[];
  readonly unresolvedRoutes: readonly UnresolvedRoute[];
  readonly operationsInScope: number;
  readonly routesParsed: number;
}

/* ───────────────────────── 契约侧解析 ───────────────────────── */

const METHOD_SET = new Set<string>(HTTP_METHODS);

/** 从 `openIndex` 处的开括号起做配平，返回配对括号内的完整子串（含首尾）。不平衡则 null。 */
function extractBalanced(source: string, openIndex: number, open: string, close: string): string | null {
  let depth = 0;
  let quote: string | null = null;
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i]!;
    if (quote) {
      if (ch === quote && source[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return source.slice(openIndex, i + 1);
    }
  }
  return null;
}

/**
 * 只在对象字面量的**自身顶层**找 `field: "literal"`。
 *
 * ⚠ 「自身顶层」这个限定是必须的：`export const operations = { a: { method: "GET", … } }`
 *   如果按「正文里出现过 method:」判，整个 `operations` 会被当成一条 operation。
 */
function topLevelStringField(objectLiteral: string, field: string): string | null {
  const body = objectLiteral.slice(1, -1);
  const re = new RegExp(`(^|[,{\\s])${field}\\s*:\\s*("([^"\\\\]*)"|'([^'\\\\]*)')`, "g");
  let depth = 0;
  let quote: string | null = null;
  // 先记录每个下标的嵌套深度，再只取深度 0 的匹配
  const depthAt = new Int32Array(body.length);
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    depthAt[i] = depth;
    if (quote) {
      if (ch === quote && body[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "{" || ch === "[" || ch === "(") depth++;
    else if (ch === "}" || ch === "]" || ch === ")") depth--;
  }
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const at = m.index + m[1]!.length;
    if (depthAt[at] !== 0) continue;
    return m[3] ?? m[4] ?? null;
  }
  return null;
}

const OBJECT_ENTRY_RE = /(?:^|[\s,{])(?:export\s+const\s+)?([A-Za-z_$][\w$]*)\s*[:=]\s*\{/g;

/**
 * 抓一份契约文件里所有「带 `method` + `path` 的对象字面量」。
 *
 * 本仓的契约有三种写法，都要抓到：`export const operations = { … }`（53 份）、
 * `export const planControl = { … }`、以及顶层单条 `export const getAgentSkillPins = { … }`。
 * 按「对象自身顶层有没有 method + path」判，三种写法自然统一，不必维护一张导出名清单。
 */
export function parseContractOperations(bundle: string, contractFile: string, source: string): ContractOperation[] {
  const ops: ContractOperation[] = [];
  const seen = new Set<string>();
  const re = new RegExp(OBJECT_ENTRY_RE);
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const name = m[1]!;
    const braceIndex = source.indexOf("{", m.index + m[0]!.length - 1);
    const literal = extractBalanced(source, braceIndex, "{", "}");
    if (!literal) continue;
    const method = topLevelStringField(literal, "method");
    const path = topLevelStringField(literal, "path");
    if (!method || !path || !METHOD_SET.has(method) || !path.startsWith("/")) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    ops.push({ bundle, contractFile, name, method: method as HttpMethod, path });
  }
  return ops;
}

/* ───────────────────────── 路由侧解析 ───────────────────────── */

const CONTROLLER_RE = /@Controller\s*\(/g;
const ROUTE_RE = /@(Get|Post|Put|Patch|Delete|Head|Options|All)\s*\(/g;
/** `C.operations.listAgents.path` / `PersonalC.deleteX.path` —— `.path` 前面那个标识符即 operation 名 */
const OPERATION_REF_RE = /\.([A-Za-z_$][\w$]*)\.path\b/;
const STRING_LITERAL_RE = /^\s*(?:"([^"\\]*)"|'([^'\\]*)')\s*$/;

/** 归一：确保以 `/` 开头、去掉尾斜杠、压掉重复斜杠。空串 → `/` */
export function normalizeRoutePath(raw: string): string {
  const joined = `/${raw}`.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  return joined === "" ? "/" : joined;
}

function joinRoutePath(prefix: string, sub: string): string {
  return normalizeRoutePath(`${prefix}/${sub}`);
}

export interface ParsedRoutes {
  readonly routes: readonly RouteDecl[];
  readonly unresolved: readonly UnresolvedRoute[];
}

/**
 * 解析一个 controller 文件里的全部路由。
 *
 * 一个文件里可能有多个 `@Controller`（本仓有），所以按 `@Controller(` 的出现位置把
 * 文件切成若干段，每段里的方法装饰器归属该段的前缀。
 */
export function parseNestRoutes(file: string, source: string): ParsedRoutes {
  const routes: RouteDecl[] = [];
  const unresolved: UnresolvedRoute[] = [];

  /** [段起点, 段前缀 | null（解析不出来）] */
  const segments: Array<{ start: number; end: number; prefix: string | null }> = [];
  const controllerHits: Array<{ index: number; prefix: string | null }> = [];
  const cre = new RegExp(CONTROLLER_RE);
  let cm: RegExpExecArray | null;
  while ((cm = cre.exec(source)) !== null) {
    const parenIndex = source.indexOf("(", cm.index);
    const args = extractBalanced(source, parenIndex, "(", ")");
    if (args === null) continue;
    const inner = args.slice(1, -1).trim();
    if (inner === "") controllerHits.push({ index: cm.index, prefix: "" });
    else {
      const lit = STRING_LITERAL_RE.exec(inner);
      controllerHits.push({ index: cm.index, prefix: lit ? (lit[1] ?? lit[2] ?? "") : null });
    }
  }
  if (controllerHits.length === 0) return { routes, unresolved };
  for (let i = 0; i < controllerHits.length; i++) {
    segments.push({
      start: controllerHits[i]!.index,
      end: i + 1 < controllerHits.length ? controllerHits[i + 1]!.index : source.length,
      prefix: controllerHits[i]!.prefix,
    });
  }

  const rre = new RegExp(ROUTE_RE);
  let rm: RegExpExecArray | null;
  while ((rm = rre.exec(source)) !== null) {
    const method = rm[1]!.toUpperCase() as HttpMethod;
    const seg = segments.find((s) => rm!.index >= s.start && rm!.index < s.end);
    if (!seg) continue; // 出现在第一个 @Controller 之前：不是路由（多半是注释/示例）
    const parenIndex = source.indexOf("(", rm.index);
    const args = extractBalanced(source, parenIndex, "(", ")");
    if (args === null) continue;
    const inner = args.slice(1, -1).trim();
    const raw = `@${rm[1]}(${inner})`;

    const opRef = OPERATION_REF_RE.exec(inner);
    if (opRef) {
      routes.push({ file, method, path: null, operationRef: opRef[1]!, raw });
      continue;
    }
    if (seg.prefix === null) {
      unresolved.push({ file, method, raw: `${raw}（controller 前缀非字面量）` });
      continue;
    }
    if (inner === "") {
      routes.push({ file, method, path: normalizeRoutePath(seg.prefix), operationRef: null, raw });
      continue;
    }
    const lit = STRING_LITERAL_RE.exec(inner);
    if (!lit) {
      unresolved.push({ file, method, raw });
      continue;
    }
    routes.push({
      file,
      method,
      path: joinRoutePath(seg.prefix, lit[1] ?? lit[2] ?? ""),
      operationRef: null,
      raw,
    });
  }
  return { routes, unresolved };
}

/* ───────────────────────── 匹配 ───────────────────────── */

const WILDCARD = "\u0000param";

/** 切段并把 `:param` / `*` 归一成通配符。通配符只与通配符匹配——见文件头注第 2 条。 */
export function pathSegments(path: string): string[] {
  return normalizeRoutePath(path)
    .split("/")
    .filter((s) => s !== "")
    .map((s) => (s.startsWith(":") || s === "*" ? WILDCARD : s));
}

export function pathShapeEquals(a: string, b: string): boolean {
  const sa = pathSegments(a);
  const sb = pathSegments(b);
  if (sa.length !== sb.length) return false;
  return sa.every((seg, i) => seg === sb[i]);
}

export function isOperationRouted(op: ContractOperation, routes: readonly RouteDecl[]): boolean {
  for (const r of routes) {
    if (r.method !== op.method) continue;
    if (r.operationRef !== null) {
      if (r.operationRef === op.name) return true;
      continue;
    }
    if (r.path !== null && pathShapeEquals(r.path, op.path)) return true;
  }
  return false;
}

/* ───────────────────────── 判定 ───────────────────────── */

export interface ScopeDecision {
  readonly inScope: boolean;
  readonly reason: string;
}

/** 束是否进入判定范围。判据与理由见文件头注「判据不是每个契约 operation 都必须有路由」。 */
export function bundleScope(b: BundleInput): ScopeDecision {
  if (b.contractFile === null || b.contractSource === null) {
    return { inScope: false, reason: `没有同名契约文件 packages/contracts/src/${b.bundle}.ts —— 本束不判` };
  }
  if (b.signoffStatus !== "confirmed") {
    return { inScope: false, reason: `签核 status=${b.signoffStatus} —— 未签核的束不对外声称任何东西可用` };
  }
  if (b.covers.length === 0) {
    return { inScope: false, reason: "covers: 为空 —— 束↔feature 映射缺失，无法判断本束声称了什么" };
  }
  const unknown = b.covers.filter((id) => b.featureStatus[id] === undefined);
  if (unknown.length > 0) {
    return {
      inScope: false,
      reason: `covers: 里 ${unknown.join(" / ")} 在 feature 清单里查无此条 —— 映射自身先修好再判覆盖`,
    };
  }
  const notStarted = b.covers.filter((id) => b.featureStatus[id] === LEGITIMATELY_UNIMPLEMENTED_STATUS);
  if (notStarted.length > 0) {
    return {
      inScope: false,
      reason: `还有 ${notStarted.length} 个 not_started（${notStarted.slice(0, 5).join(" / ")}）—— 契约有、路由没有是设计，不是缺口`,
    };
  }
  const passing = b.covers.filter((id) => b.featureStatus[id] === "passing");
  if (passing.length === 0) {
    return { inScope: false, reason: "covers: 里一个 passing 都没有 —— 本束还没对外声称任何能力可用" };
  }
  return { inScope: true, reason: `${passing.length}/${b.covers.length} 个 feature passing，无 not_started` };
}

export function judgeContractRouteCoverage(input: {
  readonly bundles: readonly BundleInput[];
  readonly routes: readonly RouteDecl[];
  readonly unresolvedRoutes: readonly UnresolvedRoute[];
}): CoverageReport {
  const bundles: BundleVerdict[] = [];
  const gaps: CoverageGap[] = [];
  let operationsInScope = 0;

  for (const b of input.bundles) {
    const decision = bundleScope(b);
    const ops =
      b.contractFile !== null && b.contractSource !== null
        ? parseContractOperations(b.bundle, b.contractFile, b.contractSource)
        : [];
    bundles.push({
      bundle: b.bundle,
      phase: b.phase,
      contractFile: b.contractFile,
      inScope: decision.inScope,
      reason: decision.reason,
      operationsWithPath: ops.length,
    });
    if (!decision.inScope) continue;
    operationsInScope += ops.length;
    for (const op of ops) {
      if (isOperationRouted(op, input.routes)) continue;
      gaps.push({
        bundle: b.bundle,
        phase: b.phase,
        operation: op.name,
        method: op.method,
        path: op.path,
        contractFile: op.contractFile,
      });
    }
  }

  gaps.sort((a, b) => a.bundle.localeCompare(b.bundle) || a.operation.localeCompare(b.operation));
  return {
    bundles,
    gaps,
    unresolvedRoutes: input.unresolvedRoutes,
    operationsInScope,
    routesParsed: input.routes.length,
  };
}
