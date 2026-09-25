/**
 * phase-18 F09 —— 「记忆」面板的纯投影函数与界面用词（非 mock，产品路由与预览共用）。
 *
 * 这些函数原本写在 `lib/mock/knowledge-graph.ts` 里（UI 先行原型阶段只有 mock 一个调用方）。
 * 面板接上真实数据后，产品路由 `/chat` 的 import 闭包**不许**够得到 `lib/mock/`
 * （`lint:ui-wiring`），所以把它们搬到这里；mock 文件原样 re-export，预览与既有单测不变。
 * 定义只有这一份。
 *
 * 用词以 `requirements/06-user-experience.md` R5 用词表为准：界面说「记忆 / 记下的一条 /
 * 人和事」，不说内部术语（见 `KG_BANNED_USER_FACING_WORDS`）。三态与可见范围文案取契约单源
 * `KG_TRI_STATE_LABEL_ZH` / `KG_VISIBILITY_LABEL_ZH`，这里不另建映射表。
 */
import {
  claimTriState,
  KG_GRAPH_VIEW_MAX_NODES,
  KG_TRI_STATE_LABEL_ZH,
  type KgClaim,
  type KgClaimKind,
  type KgObjectKind,
  type KgTriState,
} from "@repo/contracts/chat-knowledge-graph";
import type { ThreadKnowledge } from "@/lib/knowledge-graph-api";

/* ── 「记下的一条」按类型显示（用词表：结论 → 事实 / 猜测 / 决定 / 待办 / 风险） ──── */
export const KG_CLAIM_KIND_LABEL_ZH: Record<KgClaimKind, string> = {
  fact: "事实",
  hypothesis: "猜测",
  decision: "决定",
  todo: "待办",
  risk: "风险",
};

/* ── 「人和事」按类型显示（用词表：实体 → 人物 / 公司 / 项目 / …），界面不出现「实体」字样 ── */
export const KG_OBJECT_KIND_LABEL_ZH: Record<KgObjectKind, string> = {
  person: "人物",
  organization: "公司",
  project: "项目",
  product: "产品",
  concept: "概念",
  term: "术语",
  metric: "指标",
  event: "事件",
};

/** 全部禁用词（R5 用词表的内部术语）——单测用它扫界面上渲染出来的文字，确保说人话。 */
export const KG_BANNED_USER_FACING_WORDS = ["实体", "结论", "三态", "晋升", "本体", "L0", "L1"] as const;

/** 记下的按 kind 分组，`superseded`（triState 为 null）不渲染（uc-18-3 R7）。 */
export function groupClaimsByKind(input: KgClaim[]): { kind: KgClaimKind; label: string; claims: KgClaim[] }[] {
  const order: KgClaimKind[] = ["decision", "fact", "todo", "risk", "hypothesis"];
  return order
    .map((kind) => ({
      kind,
      label: KG_CLAIM_KIND_LABEL_ZH[kind],
      claims: input.filter((c) => c.kind === kind && claimTriState(c.status) !== null),
    }))
    .filter((g) => g.claims.length > 0);
}

/** 三态统计（头部计数徽标） */
export function countByTriState(input: KgClaim[]): Record<KgTriState, number> {
  const acc: Record<KgTriState, number> = { pending: 0, confirmed: 0, conflict: 0 };
  for (const c of input) {
    const tri = claimTriState(c.status);
    if (tri) acc[tri] += 1;
  }
  return acc;
}

/** 图视图会画出来的节点数：人和事（`claimCount = 0` 的孤立项不渲染，uc-18-5 A1）+ 可见的记下的条目。 */
export function graphNodeCount(data: Pick<ThreadKnowledge, "objects" | "claims">): number {
  return (
    data.objects.filter((o) => o.claimCount > 0).length +
    data.claims.filter((c) => claimTriState(c.status) !== null).length
  );
}

export function isGraphOversize(data: Pick<ThreadKnowledge, "objects" | "claims">): boolean {
  return graphNodeCount(data) > KG_GRAPH_VIEW_MAX_NODES;
}

export interface KnowledgeGraphCluster {
  /** 稳定 key：`object-<kind>` / `claim-<triState>`，也是 testid 后缀 */
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly variant: "object" | "claim";
  readonly tone: KgTriState | "object";
}

/**
 * 超限（> `KG_GRAPH_VIEW_MAX_NODES`）时的簇视图（uc-18-3 R3-1 / E4）：人和事按类型聚成簇、
 * 记下的条目按三态聚成簇，每簇只画一个节点 + 计数，不硬画满几百个节点。
 * 顺序固定（先人和事、后记下的），空簇不出现。
 */
export function clusterKnowledgeGraph(data: Pick<ThreadKnowledge, "objects" | "claims">): KnowledgeGraphCluster[] {
  const objectCounts = new Map<KgObjectKind, number>();
  for (const o of data.objects) {
    if (o.claimCount === 0) continue;
    objectCounts.set(o.kind, (objectCounts.get(o.kind) ?? 0) + 1);
  }
  const clusters: KnowledgeGraphCluster[] = [];
  for (const kind of Object.keys(KG_OBJECT_KIND_LABEL_ZH) as KgObjectKind[]) {
    const count = objectCounts.get(kind) ?? 0;
    if (count > 0) {
      clusters.push({ key: `object-${kind}`, label: KG_OBJECT_KIND_LABEL_ZH[kind], count, variant: "object", tone: "object" });
    }
  }
  const tri = countByTriState(data.claims);
  for (const t of ["pending", "confirmed", "conflict"] as const) {
    if (tri[t] > 0) clusters.push({ key: `claim-${t}`, label: KG_TRI_STATE_LABEL_ZH[t], count: tri[t], variant: "claim", tone: t });
  }
  return clusters;
}

export { KG_GRAPH_VIEW_MAX_NODES };
