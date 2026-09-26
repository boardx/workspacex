/**
 * rewrite-shadow.ts —— `lint-rewrite-coverage` 的**反方向**（#610）。
 *
 * ## 这道门防的是什么
 *
 * `rewrite-coverage.ts` 问的是「每条 API 路由，前端够得到吗？」。它**不问反方向**：
 * 「每条 rewrite，会不会把一个**前端页面**代理走？」
 *
 * 写宽一格就会：`${prefix}/admin/:path*` 把整片 `app/admin/[module]/page.tsx`
 * 代理去 API（#610 原始现场，#595 段 3 实测撞到）。同型第二次是 #2021
 * （`/chat/:path*` 吃掉 `/chat/copilotkit-v2/[threadId]`），第三次是 #3492
 * （`/canvas/:path*` 吃掉 `/canvas/[screen]`）。症状是浏览器整页刷新拿到 API 的
 * JSON（`{"error":"not_found"}`）或 404 HTML 而不是页面——**看起来像前端解析 bug**。
 *
 * ## 为什么只判「动态路由」
 *
 * Next 的路由顺序是：headers → redirects → beforeFiles → **文件系统（public/
 * 静态文件/静态页面路由）** → afterFiles → **动态路由** → fallback。
 * 静态页面路由在 afterFiles **之前**就解析掉了，rewrite 再宽也抢不走它
 * （`/chat/live`、`/projects`、`/research` 这些都是这一类）——这正是 #610 评论里
 * 那版天真实现会红在「12 处既有重叠」上的原因：它把静态页面也算成被遮蔽了。
 * 只有**动态**页面路由（`[x]` / `[...x]`）排在 afterFiles 之后，会被真的抢走。
 * 同一条顺序 `apps/web/tests/canvas-screen-rewrite.test.ts`（#3492）逐字记过。
 *
 * ## 判据：整条动态路由被吃干净才算遮蔽
 *
 * 一条动态路由**部分**落在通配 rewrite 下是正常的：`app/canvas/[screen]/page.tsx`
 * 认不出的 `screen` 本来就 `notFound()`，那些路径被代理走与渲染 404 无差别。
 * 真正的事故形态是**整条路由无路可走**——它能服务的每一个具体路径，第一条命中的
 * rewrite 都指向 API。所以本文件判的是「**有没有逃生路径**」：
 *
 *   逃生路径 = 该动态路由能匹配的某个具体 path，其**第一条命中**的 rewrite 不存在、
 *              或 destination 是内部路径（afterFiles rewrite 自带 `check: true`，
 *              命中内部 destination 会继续解析到动态路由）。
 *
 * 一条逃生路径都找不到 ⇒ 这个页面在同源代理部署下**彻底打不开** ⇒ 红。
 * 「哪几个具体值必须放行」不归本门管——那是各自束的事实源（如 `CANVAS_SCREENS`
 * 之于 `canvas-screen-rewrite.test.ts`）的事，本门不复述、不第二次声明。
 *
 * ## 棘轮，不是全绿门
 *
 * #610 评论里作者自己撤掉过一版反向门，理由值得逐字保留：
 * 「**写一个必然被放宽到能过为止的门，就是再造一个空转**。」
 * 所以同 #539：既有的遮蔽逐条登记进棘轮并写明理由，**名单只能变短**；
 * 已经不遮了却还留在名单里的条目报陈旧并变红。
 *
 * ## 扫不全就不判
 *
 * 同 `rewrite-coverage.ts`：0 个页面、0 条 rewrite、或出现本文件不认识的 source
 * 语法 ⇒ `incomplete`，拒绝做否定性判断。⚠ 方向很重要：反向门读不懂一条规则时，
 * **最危险的不是漏报而是误报**——读不出 #3492 那批「放行前端屏」的内部 destination
 * 规则，就会把已经修好的 canvas 屏重新判成遮蔽，于是门又被放宽到能过为止。
 */

/** 填充动态段用的探针值。取一个没人会拿来当真实路径段的字符串。 */
export const SHADOW_PROBE = "__rewrite_shadow_probe__";

type Seg =
  | { kind: "lit"; value: string }
  /** 恰好一段 */
  | { kind: "one" }
  /** 零段或多段 */
  | { kind: "star" }
  /** 零段或一段 */
  | { kind: "opt" };

export interface PageRouteFact {
  /** 路由模式，如 `/projects/[projectId]`（路由组 `(v2)` 已剥掉） */
  route: string;
  /** `apps/web/app` 下的相对文件路径，报错时指得到人 */
  file: string;
  /** 含动态段 ⇒ 排在 afterFiles 之后 ⇒ 可能被遮蔽 */
  dynamic: boolean;
}

export interface RewriteRuleFact {
  source: string;
  destination: string;
  /** 带 `has` / `missing` 条件：静态判不出它到底命不命中 */
  conditional: boolean;
}

export interface ShadowFinding {
  route: string;
  file: string;
  /** 遮蔽它的那条 rewrite 的 source */
  rewrite: string;
  destination: string;
  /** 一条真实会被代理走的具体路径，让人一眼看出后果 */
  example: string;
}

export interface ShadowAllowEntry {
  route: string;
  rewrite: string;
  /** 为什么这一条今天是安全的。棘轮条目没有理由 = 没有登记。 */
  reason: string;
}

export interface ShadowReport {
  /** true = 输入不足以做判断，调用方必须降级为 WARN 而不是报遮蔽 */
  incomplete: boolean;
  incompleteReason: string | null;
  pages: PageRouteFact[];
  /** 参与判定的动态页面路由数（静态路由在 afterFiles 之前就解析掉了，不参与） */
  dynamicCount: number;
  findings: ShadowFinding[];
}

export interface ShadowInput {
  /** `apps/web/app` 下所有 `page.tsx` 的相对路径，如 `chat/(v2)/[threadId]/page.tsx` */
  pageFiles: readonly string[];
  /** afterFiles 规则，**按声明顺序**；必须是 prefix 为空串的那一套（同源代理部署） */
  rewrites: readonly RewriteRuleFact[];
  /** 棘轮：当前已知的遮蔽。只能变短，不能变长。 */
  allowlist: readonly ShadowAllowEntry[];
}

/**
 * 把 `app/` 下的 `page.tsx` 相对路径翻成路由模式。
 *
 * 剥掉路由组 `(v2)` 与并行路由槽 `@slot`（它们不出现在 URL 里），
 * `[x]` / `[...x]` / `[[...x]]` 原样保留——是不是动态看的就是这个。
 */
export function parsePageRoute(relFile: string): string {
  const segs = relFile.split("/").filter(Boolean);
  const dirs = segs.slice(0, -1).filter((s) =>
    !(s.startsWith("(") && s.endsWith(")")) && !s.startsWith("@"));
  return `/${dirs.join("/")}`.replace(/\/$/, "") || "/";
}

export function toPageRouteFacts(pageFiles: readonly string[]): PageRouteFact[] {
  return pageFiles.map((file) => {
    const route = parsePageRoute(file);
    return { route, file, dynamic: route.includes("[") };
  });
}

/** `[x]` → one；`[...x]` → 一段 + 零或多段；`[[...x]]` → 零或多段。 */
function pageSegments(route: string): Seg[] {
  const out: Seg[] = [];
  for (const raw of route.split("/").filter(Boolean)) {
    if (raw.startsWith("[[...") && raw.endsWith("]]")) out.push({ kind: "star" });
    else if (raw.startsWith("[...") && raw.endsWith("]")) out.push({ kind: "one" }, { kind: "star" });
    else if (raw.startsWith("[") && raw.endsWith("]")) out.push({ kind: "one" });
    else out.push({ kind: "lit", value: raw });
  }
  return out;
}

/** 本文件认识的 rewrite `source` 语法：字面量段、`:name`、`:name*`、`:name+`、`:name?`。 */
const RULE_PARAM = /^:([A-Za-z0-9_]+)([*+?])?$/;
/** 字面量段里不该出现的东西（正则组、可选标记……）——读不懂就别猜。 */
const LITERAL_OK = /^[A-Za-z0-9._~%-]*$/;

/** 解析失败返回 null——调用方据此把整次判定降级为 incomplete，而不是当成"没有遮蔽"。 */
function ruleSegments(source: string): Seg[] | null {
  const out: Seg[] = [];
  for (const raw of source.split("/").filter(Boolean)) {
    const param = RULE_PARAM.exec(raw);
    if (param) {
      const modifier = param[2];
      if (modifier === "*") out.push({ kind: "star" });
      else if (modifier === "+") out.push({ kind: "one" }, { kind: "star" });
      else if (modifier === "?") out.push({ kind: "opt" });
      else out.push({ kind: "one" });
      continue;
    }
    if (!LITERAL_OK.test(raw)) return null;
    out.push({ kind: "lit", value: raw });
  }
  return out;
}

/** 零宽跳过闭包：`star` / `opt` 可以不吃任何一段就前进。 */
function closure(segs: readonly Seg[], start: number): number[] {
  const seen = new Set<number>();
  const stack = [start];
  while (stack.length > 0) {
    const i = stack.pop()!;
    if (seen.has(i)) continue;
    seen.add(i);
    const seg = segs[i];
    if (seg && (seg.kind === "star" || seg.kind === "opt")) stack.push(i + 1);
  }
  return [...seen];
}

/** 从状态 i 吃掉一段后能到哪：`[目标状态, 该段必须等于的字面量（null = 任意）]`。 */
function steps(segs: readonly Seg[], i: number): Array<[number, string | null]> {
  const seg = segs[i];
  if (!seg) return [];
  if (seg.kind === "lit") return [[i + 1, seg.value]];
  if (seg.kind === "star") return [[i, null]];
  return [[i + 1, null]];
}

/** 具体路径能否被这条规则匹配（NFA 走一遍，符号是已知的路径段）。 */
function matchesConcrete(segs: readonly Seg[], pathSegs: readonly string[]): boolean {
  let states = new Set(closure(segs, 0));
  for (const sym of pathSegs) {
    const next = new Set<number>();
    for (const i of states) {
      for (const [to, lit] of steps(segs, i)) {
        if (lit !== null && lit !== sym) continue;
        for (const c of closure(segs, to)) next.add(c);
      }
    }
    if (next.size === 0) return false;
    states = next;
  }
  return states.has(segs.length);
}

/**
 * 两个模式的交集见证：返回一条同时被两边匹配的具体路径；没有交集返回 null。
 *
 * 做法是两个 NFA 的**积**上做 BFS（状态数 = |page| × |rule|，有限），
 * 沿途记前驱以还原出那条路径。两边都是"任意段"时填 {@link SHADOW_PROBE}。
 */
function intersectionWitness(a: readonly Seg[], b: readonly Seg[]): string[] | null {
  const key = (i: number, j: number) => `${i}:${j}`;
  const from = new Map<string, { prev: string; sym: string } | null>();
  const queue: Array<[number, number]> = [];
  for (const i of closure(a, 0)) {
    for (const j of closure(b, 0)) {
      const k = key(i, j);
      if (from.has(k)) continue;
      from.set(k, null);
      queue.push([i, j]);
    }
  }
  while (queue.length > 0) {
    const [i, j] = queue.shift()!;
    if (i === a.length && j === b.length) {
      const path: string[] = [];
      let cur = key(i, j);
      for (let edge = from.get(cur); edge; edge = from.get(cur)) {
        path.unshift(edge.sym);
        cur = edge.prev;
      }
      return path;
    }
    for (const [ta, la] of steps(a, i)) {
      for (const [tb, lb] of steps(b, j)) {
        if (la !== null && lb !== null && la !== lb) continue;
        const sym = la ?? lb ?? SHADOW_PROBE;
        for (const ca of closure(a, ta)) {
          for (const cb of closure(b, tb)) {
            const k = key(ca, cb);
            if (from.has(k)) continue;
            from.set(k, { prev: key(i, j), sym });
            queue.push([ca, cb]);
          }
        }
      }
    }
  }
  return null;
}

/** destination 带 protocol ⇒ 直接代理出去并结束路由；否则是内部路径，会继续解析到页面。 */
function proxiesOut(destination: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(destination);
}

interface ParsedRule extends RewriteRuleFact {
  segs: Seg[];
}

/**
 * 对一条具体路径，找出**第一条对它生效**的规则。
 *
 * 条件规则（`has`/`missing`）在这里是不对称的，方向刻意选成 fail-closed：
 * - 条件规则指向 API ⇒ 当作会命中（它**可能**把页面代理走，报出来让人看一眼）；
 * - 条件规则指向内部 ⇒ **不**当作逃生路径（我们没法静态确定它会生效，
 *   拿它当"已经放行了"就是给自己发绿灯）。
 */
function firstEffectiveRule(rules: readonly ParsedRule[], pathSegs: readonly string[]): ParsedRule | undefined {
  return rules.find((rule) => {
    if (rule.conditional && !proxiesOut(rule.destination)) return false;
    return matchesConcrete(rule.segs, pathSegs);
  });
}

export function analyzeRewriteShadow(input: ShadowInput): ShadowReport {
  const pages = toPageRouteFacts(input.pageFiles);
  const dynamic = pages.filter((p) => p.dynamic);

  const empty = (reason: string): ShadowReport => ({
    incomplete: true,
    incompleteReason: reason,
    pages,
    dynamicCount: dynamic.length,
    findings: [],
  });

  if (pages.length === 0) {
    return empty("扫到 0 个 page.tsx——扫描器或路径失效，拒绝据此判定遮蔽");
  }
  if (input.rewrites.length === 0) {
    return empty("扫到 0 条 rewrite 规则——next.config.mjs 结构可能变了，拒绝据此判定遮蔽");
  }

  const rules: ParsedRule[] = [];
  for (const rule of input.rewrites) {
    const segs = ruleSegments(rule.source);
    if (!segs) {
      // ⚠ 读不懂一条规则就整次不判。见文件头："反向门最危险的不是漏报而是误报"。
      return empty(`看不懂 rewrite source 语法 \`${rule.source}\`——扫描器需要跟上，拒绝据此判定遮蔽`);
    }
    if (segs.some((s) => s.kind === "lit" && s.value === SHADOW_PROBE)) {
      return empty(`rewrite source \`${rule.source}\` 里出现了探针值，换一个 SHADOW_PROBE 再判`);
    }
    rules.push({ ...rule, segs });
  }

  const allow = new Set(input.allowlist.map((e) => `${e.route}\u0000${e.rewrite}`));
  const findings: ShadowFinding[] = [];

  for (const page of dynamic) {
    const pageSegs = pageSegments(page.route);

    // 候选具体路径：①「任意值」探针；② 与每条规则的交集见证（把字面量重叠的
    // 那些具体点也放进来，否则 `/admin/[module]` 撞上 `/admin/skills/:path*`
    // 这种单复数巧合永远扫不到）。
    const candidates: string[][] = [pageSegs.flatMap((s) =>
      s.kind === "lit" ? [s.value] : s.kind === "star" ? [] : [SHADOW_PROBE])];
    for (const rule of rules) {
      const witness = intersectionWitness(pageSegs, rule.segs);
      if (witness) candidates.push(witness);
    }

    let shadow: { rule: ParsedRule; example: string } | null = null;
    let escaped = false;
    for (const candidate of candidates) {
      const hit = firstEffectiveRule(rules, candidate);
      if (!hit || !proxiesOut(hit.destination)) {
        // 有一条路能走到页面 ⇒ 这条动态路由没有被吃干净。
        escaped = true;
        break;
      }
      shadow ??= { rule: hit, example: `/${candidate.join("/")}` };
    }
    if (escaped || !shadow) continue;
    if (allow.has(`${page.route}\u0000${shadow.rule.source}`)) continue;

    findings.push({
      route: page.route,
      file: page.file,
      rewrite: shadow.rule.source,
      destination: shadow.rule.destination,
      example: shadow.example,
    });
  }

  return { incomplete: false, incompleteReason: null, pages, dynamicCount: dynamic.length, findings };
}

/** 棘轮体检：已经不再被遮蔽的条目应当被删掉，否则它会一直遮住回归。 */
export function staleShadowAllowlistEntries(input: ShadowInput): ShadowAllowEntry[] {
  const withoutAllow = analyzeRewriteShadow({ ...input, allowlist: [] });
  if (withoutAllow.incomplete) return [];
  const stillShadowed = new Set(withoutAllow.findings.map((f) => `${f.route}\u0000${f.rewrite}`));
  return input.allowlist.filter((e) => !stillShadowed.has(`${e.route}\u0000${e.rewrite}`));
}
