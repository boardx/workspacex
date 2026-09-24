/**
 * D4 —— 把仓库里的 ADR / 方法论 / 模块经验映射成平台组织大脑里的**投影节点**（纯函数，无 IO）。
 *
 * 权威源永远是仓库（人类决策 D17 读法 B，与 D12 同一纪律）：
 *   - `docs/adr/*.md`（README 除外）                   → `decision`，key = `ADR-NNN`（或文件名）
 *   - `.harness/instructions/` 下的 `.md`              → `methodology`，key = 仓库相对路径
 *   - `.agents/skills/mod-<x>/SKILL.md` 的「踩坑与经验」段 → `lesson`，每条顶层 `- ` 一个节点，
 *     key = `<模块>#<条目内容哈希前 16 位>`（条目 append-only，内容即身份）
 * 行 id 由 (org, kind, key) 哈希确定；contentHash 是正文哈希——重跑幂等。
 * 另外从提交记录推出 `pull_request -decided_by-> decision`：squash 标题带 `(#N)` 的提交，
 * 标题或正文提到 `ADR-NNN` 且该 ADR 存在。
 * 契约：packages/contracts/src/ontology-projection.ts（ProjectionNode）。
 */
import { createHash } from "node:crypto";
import type { ontologyProjection } from "@repo/contracts";
import { edgeId, prNumberOf, type CommitRecord } from "./dev-process-projection";

type ProjectionNode = ontologyProjection.ProjectionNode;
type ProjectionEdge = ontologyProjection.ProjectionEdge;
type NodeKind = ontologyProjection.OntologyNodeKind;

export interface RepoDoc {
  /** 仓库相对路径，正斜杠。 */
  path: string;
  content: string;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function nodeRowId(orgId: string, kind: NodeKind, key: string): string {
  return `node-${sha256([orgId, kind, key].join("\x1f")).slice(0, 32)}`;
}

export function makeNode(
  orgId: string,
  kind: NodeKind,
  key: string,
  title: string,
  body: string,
  sourcePath: string | null,
  projectionSource: ProjectionNode["projectionSource"],
): ProjectionNode {
  const t = title.trim() || key;
  return {
    id: nodeRowId(orgId, kind, key),
    kind,
    key,
    title: t,
    body,
    sourcePath,
    contentHash: sha256(`${t}\x1f${body}`),
    projectionSource,
  };
}

function firstHeading(content: string): string | null {
  const m = /^#\s+(.+)$/m.exec(content);
  return m ? m[1]!.trim() : null;
}

/** `ADR-12` / `adr-012` → `ADR-012`。 */
export function normalizeAdrId(raw: string): string {
  const m = /ADR-?(\d+)/i.exec(raw);
  return m ? `ADR-${m[1]!.padStart(3, "0")}` : raw;
}

export function adrKeyOf(path: string): string | null {
  const m = /^docs\/adr\/([^/]+)\.md$/.exec(path);
  if (!m || m[1]!.toLowerCase() === "readme") return null;
  return /^ADR-\d+/i.test(m[1]!) ? normalizeAdrId(m[1]!) : m[1]!;
}

const LESSON_HEADING = /^##\s+踩坑与经验/;

/** SKILL.md「踩坑与经验」段里的顶层条目（`- ` 起头，续行缩进），占位注释与空条目丢掉。 */
export function lessonEntries(content: string): string[] {
  const lines = content.split("\n");
  const start = lines.findIndex((l) => LESSON_HEADING.test(l));
  if (start < 0) return [];
  const entries: string[] = [];
  let cur: string[] | null = null;
  const flush = () => {
    if (cur) entries.push(cur.join("\n").trim());
    cur = null;
  };
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    if (/^- /.test(line)) {
      flush();
      cur = [line];
    } else if (cur && (/^\s+\S/.test(line) || line.trim() === "")) {
      cur.push(line);
    } else {
      flush();
    }
  }
  flush();
  return entries.filter((e) => e.replace(/^- /, "").trim().length > 0 && !/^- <!--/.test(e));
}

export function buildKnowledgeNodes(orgId: string, docs: readonly RepoDoc[]): ProjectionNode[] {
  const nodes = new Map<string, ProjectionNode>();
  const add = (n: ProjectionNode) => nodes.set(n.id, n);
  for (const d of docs) {
    const adr = adrKeyOf(d.path);
    if (adr) {
      add(makeNode(orgId, "decision", adr, firstHeading(d.content) ?? adr, d.content, d.path, "repo"));
      continue;
    }
    if (d.path.startsWith(".harness/instructions/") && d.path.endsWith(".md")) {
      add(makeNode(orgId, "methodology", d.path, firstHeading(d.content) ?? d.path, d.content, d.path, "repo"));
      continue;
    }
    const mod = /^\.agents\/skills\/(mod-[^/]+)\/SKILL\.md$/.exec(d.path);
    if (mod && mod[1] !== "mod-_template") {
      for (const entry of lessonEntries(d.content)) {
        const key = `${mod[1]}#${sha256(entry).slice(0, 16)}`;
        const title = entry.replace(/^- /, "").split("\n")[0]!.slice(0, 120);
        add(makeNode(orgId, "lesson", key, title, entry, d.path, "repo"));
      }
    }
  }
  return [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** PR 提交提到了哪些（存在的）ADR → `pull_request -decided_by-> decision` 投影边。 */
export function buildDecisionEdges(
  orgId: string,
  commits: readonly CommitRecord[],
  decisionKeys: ReadonlySet<string>,
): ProjectionEdge[] {
  const edges = new Map<string, ProjectionEdge>();
  for (const c of commits) {
    const pr = prNumberOf(c);
    if (pr === null) continue;
    for (const m of `${c.subject}\n${c.body}`.matchAll(/\bADR-?\d+\b/gi)) {
      const key = normalizeAdrId(m[0]);
      if (!decisionKeys.has(key)) continue;
      const src = { kind: "pull_request" as const, id: String(pr) };
      const dst = { kind: "decision" as const, id: key };
      const id = edgeId(orgId, src, "decided_by", dst);
      edges.set(id, { id, src, dst, relation: "decided_by", projectionSource: "repo" });
    }
  }
  return [...edges.values()].sort((a, b) => a.id.localeCompare(b.id));
}
