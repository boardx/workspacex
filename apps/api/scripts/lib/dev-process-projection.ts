/**
 * D12 —— 开发过程投影的**纯映射**：仓库权威源（git tag、commit message 里的 PR / issue 引用、
 * phases 的 feature_list.json）→ `ontology_edges` 投影边。无 IO，便于测试。
 * 契约：packages/contracts/src/ontology-projection.ts。
 *
 * 不产出 customer_instance 边——实例来自 D9/D10 遥测，仓库里没有，不捏造。
 */
import { createHash } from "node:crypto";
import type { ontologyProjection } from "@repo/contracts";

type ProjectionEdge = ontologyProjection.ProjectionEdge;
type NodeRef = ontologyProjection.OntologyNodeRef;
type Relation = ontologyProjection.DevProcessRelation;

export interface CommitRecord {
  sha: string;
  subject: string;
  body: string;
}

/** `git log --format=%H%x1f%s%x1f%b%x1e` 的输出。 */
export function parseCommitLog(raw: string): CommitRecord[] {
  return raw
    .split("\x1e")
    .map((chunk) => chunk.replace(/^\n+/, ""))
    .filter((chunk) => chunk.trim().length > 0)
    .map((chunk) => {
      const [sha = "", subject = "", body = ""] = chunk.split("\x1f");
      return { sha: sha.trim(), subject, body };
    })
    .filter((c) => /^[0-9a-f]{7,40}$/.test(c.sha));
}

/** squash-merge 标题尾的 `(#1234)`。 */
export function prNumberOf(commit: CommitRecord): number | null {
  const m = /\(#(\d+)\)\s*$/.exec(commit.subject.trim());
  return m ? Number(m[1]) : null;
}

/** 修复型提交（`fix:` / `fix(scope):`）用 Closes/Fixes/Resolves 关掉的 issue = 缺陷。 */
export function defectsFixedBy(commit: CommitRecord): number[] {
  if (!/^fix(\([^)]*\))?!?:/i.test(commit.subject.trim())) return [];
  const out = new Set<number>();
  const re = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi;
  for (const m of commit.body.matchAll(re)) out.add(Number(m[1]));
  return [...out].sort((a, b) => a - b);
}

export interface ReleaseRange {
  tag: string;
  /** 该 tag 相对上一个 tag 新增的提交（`git rev-list prev..tag`）。 */
  commitShas: readonly string[];
}

export interface FeatureRecord {
  phase: string;
  id: string;
  status: string;
  evidence: string;
}

export interface RepoSnapshot {
  commits: readonly CommitRecord[];
  releases: readonly ReleaseRange[];
  features: readonly FeatureRecord[];
}

export function edgeId(orgId: string, src: NodeRef, relation: Relation, dst: NodeRef): string {
  const h = createHash("sha256")
    .update([orgId, src.kind, src.id, relation, dst.kind, dst.id].join("\x1f"))
    .digest("hex")
    .slice(0, 32);
  return `proj-${h}`;
}

export function buildProjectionEdges(orgId: string, snap: RepoSnapshot): ProjectionEdge[] {
  const edges = new Map<string, ProjectionEdge>();
  const add = (src: NodeRef, relation: Relation, dst: NodeRef) => {
    const id = edgeId(orgId, src, relation, dst);
    edges.set(id, { id, src, dst, relation, projectionSource: "repo" });
  };

  const prBySha = new Map<string, number>();
  for (const c of snap.commits) {
    const pr = prNumberOf(c);
    if (pr === null) continue;
    prBySha.set(c.sha, pr);
    for (const d of defectsFixedBy(c)) {
      add({ kind: "pull_request", id: String(pr) }, "fixes", { kind: "defect", id: String(d) });
    }
  }

  for (const r of snap.releases) {
    for (const sha of r.commitShas) {
      const pr = prBySha.get(sha);
      if (pr !== undefined) add({ kind: "release", id: r.tag }, "contains", { kind: "pull_request", id: String(pr) });
    }
  }

  for (const f of snap.features) {
    if (f.status !== "passing" || f.evidence.trim().length === 0) continue;
    const featureId = `${f.phase}/${f.id}`;
    add({ kind: "feature", id: featureId }, "verified_by", { kind: "evidence", id: `${featureId}#evidence` });
  }

  return [...edges.values()].sort((a, b) => a.id.localeCompare(b.id));
}
