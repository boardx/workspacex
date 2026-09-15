/**
 * mermaid 产业图谱的**结构化比较**——纯函数，无 I/O、无 DOM、无 fabric。
 *
 * 为什么不是文本 diff：产业图谱的一版与下一版之间，用户想知道的是「多了哪个环节、
 * 哪条链路断了、哪个节点从『规划中』改成了『已建成』」。而 mermaid 源的文本 diff 会把
 * 「把同一条边挪到文件另一行」报成一删一增，把「给节点换个形状括号」报成整行改写——
 * 噪声正好盖住信号。所以这里先把两份源各自解析成 (节点集, 边集)，再比较集合。
 *
 * 形状照抄 `apps/api/src/domain/skill/improvement-proposal.ts` 的 `diffContract`：
 * **只返回变化的条目**，没变的不出现；两份相同的源返回空数组。**不**复用那个函数——
 * 它比的是技能契约的固定字段表，与图无关。
 *
 * ## 覆盖到哪里，以及哪里没覆盖
 *
 * 目标是 `graph` / `flowchart`（产业图谱实际用的那一种，见
 * `apps/web/lib/mermaid-diagram-type.ts` 的白名单）。mindmap / sequenceDiagram 等
 * 别的图种会被解析成「没有边的一堆节点」——不会崩、不会瞎报边的增删，但也谈不上
 * 结构比较。这是边界，不是 bug：调用方比较的是同一张图的两个版本，图种不会中途变。
 */

/** 一个节点：id + 显示文本 + 可选的 `:::class`（图谱里常用来表达状态）。 */
export interface MermaidGraphNode {
  readonly id: string;
  /** 括号里的文本；没写括号时就是 id 本身（mermaid 自己也是这么显示的）。 */
  readonly label: string;
  /** `A:::built` 里的 `built`，没有则 `null`。 */
  readonly status: string | null;
}

/** 一条有向边。`label` 是 `-->|文本|` / `-- 文本 -->` 里的文本，没有则 `""`。 */
export interface MermaidGraphEdge {
  readonly from: string;
  readonly to: string;
  readonly label: string;
}

export interface MermaidGraph {
  readonly nodes: readonly MermaidGraphNode[];
  readonly edges: readonly MermaidGraphEdge[];
}

export type MermaidGraphDiffEntry =
  | {
      readonly kind: "node";
      readonly change: "added" | "removed";
      readonly id: string;
      readonly label: string;
      readonly status: string | null;
    }
  | {
      readonly kind: "node";
      readonly change: "changed";
      readonly id: string;
      /** `"label"` / `"status"`，同一个节点两样都改了就出两条。 */
      readonly field: "label" | "status";
      readonly before: string;
      readonly after: string;
    }
  | {
      readonly kind: "edge";
      readonly change: "added" | "removed";
      readonly from: string;
      readonly to: string;
      readonly label: string;
    }
  | {
      readonly kind: "edge";
      readonly change: "changed";
      readonly from: string;
      readonly to: string;
      readonly before: string;
      readonly after: string;
    };

/* ── 解析 ────────────────────────────────────────────────────────────────────── */

/** 图种声明、样式、注释——都不是图的结构，解析前一律丢掉。 */
const IGNORED_STATEMENT =
  /^(graph\b|flowchart\b|subgraph\b|end\b|classDef\b|class\b|style\b|click\b|linkStyle\b|direction\b|%%)/i;

/**
 * 连接符。**顺序即优先级**：长的必须排在短的前面，否则 `-->` 会先被 `--` 吃掉一半。
 * 只认有向/无向的常见几种；`--x`/`--o` 按有向处理（mermaid 里它们也是有向的）。
 */
const CONNECTORS = [
  "-.->", "-.-", "==>", "===", "-->", "--x", "--o", "---", "--",
] as const;

/** `A -- 文本 --> B` / `A == 文本 ==> B` / `A -. 文本 .-> B` ⇒ 归一成 `A -->|文本| B`。 */
function normalizeMidLabels(line: string): string {
  return line
    .replace(/\s--\s+([^->|]+?)\s+-->\s/g, " -->|$1| ")
    .replace(/\s==\s+([^=>|]+?)\s+==>\s/g, " ==>|$1| ")
    .replace(/\s-\.\s+([^.>|]+?)\s+\.->\s/g, " -.->|$1| ");
}

function stripQuotes(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length >= 2 && /^["'].*["']$/s.test(trimmed)) return trimmed.slice(1, -1).trim();
  return trimmed;
}

/** `A[文本]:::cls` / `A(("文本"))` / 裸 `A` ⇒ 一个节点。空串 ⇒ `null`。 */
function parseNodeToken(token: string): MermaidGraphNode | null {
  const text = token.trim();
  if (text === "") return null;

  const statusMatch = /:::\s*([A-Za-z0-9_-]+)\s*$/.exec(text);
  const status = statusMatch ? statusMatch[1]! : null;
  const withoutStatus = statusMatch ? text.slice(0, statusMatch.index).trim() : text;

  // 形状括号：`[[ ]]` `[( )]` `(( ))` `{{ }}` `[ ]` `( )` `{ }` `> ]`。
  const shaped =
    /^([^[\](){}>\s]+)\s*(?:\[\[(.*)\]\]|\[\((.*)\)\]|\(\((.*)\)\)|\{\{(.*)\}\}|\[(.*)\]|\((.*)\)|\{(.*)\}|>(.*)\])$/s.exec(
      withoutStatus,
    );
  if (shaped) {
    const id = shaped[1]!.trim();
    const raw = shaped.slice(2).find((g) => g !== undefined);
    return { id, label: raw === undefined ? id : stripQuotes(raw), status };
  }

  const bare = /^([^[\](){}>|\s]+)$/.exec(withoutStatus);
  if (!bare) return null;
  const id = bare[1]!;
  return { id, label: id, status };
}

/** 一行里按连接符切出 `[节点, 边标签, 节点, ...]` 的链。 */
function splitChain(line: string): { tokens: string[]; labels: string[] } {
  const tokens: string[] = [];
  const labels: string[] = [];
  let rest = line;

  for (;;) {
    let bestIndex = -1;
    let bestConnector = "";
    for (const connector of CONNECTORS) {
      const at = rest.indexOf(connector);
      // 括号里的连字符（`A[a-b] --> B`）不是连接符：只在括号平衡处切。
      if (at === -1) continue;
      if (!isOutsideBrackets(rest, at)) continue;
      if (bestIndex === -1 || at < bestIndex || (at === bestIndex && connector.length > bestConnector.length)) {
        bestIndex = at;
        bestConnector = connector;
      }
    }
    if (bestIndex === -1) {
      tokens.push(rest);
      return { tokens, labels };
    }
    tokens.push(rest.slice(0, bestIndex));
    rest = rest.slice(bestIndex + bestConnector.length);
    const labelMatch = /^\s*\|([^|]*)\|/.exec(rest);
    if (labelMatch) {
      labels.push(stripQuotes(labelMatch[1]!));
      rest = rest.slice(labelMatch[0].length);
    } else {
      labels.push("");
    }
  }
}

function isOutsideBrackets(text: string, index: number): boolean {
  let depth = 0;
  for (let i = 0; i < index; i += 1) {
    const ch = text[i]!;
    if (ch === "[" || ch === "(" || ch === "{") depth += 1;
    else if (ch === "]" || ch === ")" || ch === "}") depth -= 1;
  }
  return depth <= 0;
}

/**
 * mermaid 源 ⇒ (节点集, 边集)。
 *
 * 同一个 id 出现多次时**后写的带括号文本覆盖先前的**（mermaid 自己的行为：节点文本
 * 由最后一次带形状的声明决定），而只写了裸 id 的那次不会把已知文本抹回 id。
 */
export function parseMermaidGraph(source: string): MermaidGraph {
  const nodes = new Map<string, MermaidGraphNode>();
  const edges: MermaidGraphEdge[] = [];
  const seenEdges = new Set<string>();

  const body = source.replace(/^\s*```[^\n]*\n?/, "").replace(/```\s*$/, "");

  for (const rawLine of body.split("\n")) {
    const withoutComment = rawLine.replace(/%%.*$/, "");
    for (const statement of withoutComment.split(";")) {
      const line = statement.trim();
      if (line === "" || IGNORED_STATEMENT.test(line)) continue;

      const { tokens, labels } = splitChain(normalizeMidLabels(line));
      const parsed = tokens.map(parseNodeToken);

      for (const node of parsed) {
        if (node === null) continue;
        const existing = nodes.get(node.id);
        if (existing === undefined) {
          nodes.set(node.id, node);
          continue;
        }
        nodes.set(node.id, {
          id: node.id,
          // 裸 id（label === id）不覆盖已知文本；带括号的新文本覆盖。
          label: node.label === node.id ? existing.label : node.label,
          status: node.status ?? existing.status,
        });
      }

      for (let i = 0; i + 1 < parsed.length; i += 1) {
        const from = parsed[i];
        const to = parsed[i + 1];
        if (!from || !to) continue;
        const edge = { from: from.id, to: to.id, label: labels[i] ?? "" };
        const key = `${edge.from} ${edge.to}`;
        // 同一对节点重复连线只算一条边（第一次出现的标签为准）——否则「同一条链路写了
        // 两遍」会在 diff 里变成一条凭空多出来的边。
        if (seenEdges.has(key)) continue;
        seenEdges.add(key);
        edges.push(edge);
      }
    }
  }

  return { nodes: [...nodes.values()], edges };
}

/* ── 比较 ────────────────────────────────────────────────────────────────────── */

/**
 * 两份 mermaid 源的结构差异。**只返回变化的条目**；两份等价的源返回 `[]`。
 *
 * 顺序固定：节点（删 → 增 → 改）在前，边（删 → 增 → 改）在后，各自按 id / (from,to)
 * 字典序。调用方（以及测试）因此不需要自己排序，也不会因为源里语句的先后顺序变化
 * 而看到不同的输出。
 */
export function diffMermaidGraphs(
  beforeSource: string,
  afterSource: string,
): readonly MermaidGraphDiffEntry[] {
  const before = parseMermaidGraph(beforeSource);
  const after = parseMermaidGraph(afterSource);

  const beforeNodes = new Map(before.nodes.map((n) => [n.id, n]));
  const afterNodes = new Map(after.nodes.map((n) => [n.id, n]));
  const beforeEdges = new Map(before.edges.map((e) => [`${e.from} ${e.to}`, e]));
  const afterEdges = new Map(after.edges.map((e) => [`${e.from} ${e.to}`, e]));

  const removedNodes: MermaidGraphDiffEntry[] = [];
  const addedNodes: MermaidGraphDiffEntry[] = [];
  const changedNodes: MermaidGraphDiffEntry[] = [];

  for (const id of [...beforeNodes.keys()].sort()) {
    const b = beforeNodes.get(id)!;
    if (!afterNodes.has(id)) {
      removedNodes.push({ kind: "node", change: "removed", id, label: b.label, status: b.status });
      continue;
    }
    const a = afterNodes.get(id)!;
    if (a.label !== b.label) {
      changedNodes.push({ kind: "node", change: "changed", id, field: "label", before: b.label, after: a.label });
    }
    if ((a.status ?? "") !== (b.status ?? "")) {
      changedNodes.push({
        kind: "node", change: "changed", id, field: "status",
        before: b.status ?? "", after: a.status ?? "",
      });
    }
  }
  for (const id of [...afterNodes.keys()].sort()) {
    if (beforeNodes.has(id)) continue;
    const a = afterNodes.get(id)!;
    addedNodes.push({ kind: "node", change: "added", id, label: a.label, status: a.status });
  }

  const removedEdges: MermaidGraphDiffEntry[] = [];
  const addedEdges: MermaidGraphDiffEntry[] = [];
  const changedEdges: MermaidGraphDiffEntry[] = [];

  for (const key of [...beforeEdges.keys()].sort()) {
    const b = beforeEdges.get(key)!;
    const a = afterEdges.get(key);
    if (a === undefined) {
      removedEdges.push({ kind: "edge", change: "removed", from: b.from, to: b.to, label: b.label });
      continue;
    }
    if (a.label !== b.label) {
      changedEdges.push({ kind: "edge", change: "changed", from: b.from, to: b.to, before: b.label, after: a.label });
    }
  }
  for (const key of [...afterEdges.keys()].sort()) {
    if (beforeEdges.has(key)) continue;
    const a = afterEdges.get(key)!;
    addedEdges.push({ kind: "edge", change: "added", from: a.from, to: a.to, label: a.label });
  }

  return [
    ...removedNodes, ...addedNodes, ...changedNodes,
    ...removedEdges, ...addedEdges, ...changedEdges,
  ];
}
