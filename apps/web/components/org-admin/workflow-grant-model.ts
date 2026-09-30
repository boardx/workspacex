/**
 * 工作流权限授予 —— 纯函数视图模型（可单测，无 IO）。
 *
 * 授权按「能力分类」存（整个组织共享），清单按 Workflow 展开只是为了回答
 * 「这一项授权影响哪些工作流、现在哪些会被卡住」。
 */
import type {
  SideEffectCap, WorkflowCapabilityCatalogEntry, WorkflowCapabilityGrant, WorkflowCapabilityGrantsOut,
} from "@/lib/live-workflow-capability-grants";

const RANK: Record<SideEffectCap, number> = { none: 0, read: 1, write: 2, external_send: 3 };

export const covers = (have: SideEffectCap, need: SideEffectCap): boolean => RANK[have] >= RANK[need];
export const maxCap = (a: SideEffectCap, b: SideEffectCap): SideEffectCap => (RANK[a] >= RANK[b] ? a : b);

export function effectiveCap(g: WorkflowCapabilityGrant): SideEffectCap {
  return g.authorized ? g.sideEffectCap : "none";
}

export interface CapabilityUse {
  readonly workflowId: string;
  readonly workflowKey: string;
  readonly title: string;
  readonly requiredCap: SideEffectCap;
  readonly stageIds: readonly string[];
}

export interface CapabilityRow {
  readonly category: string;
  readonly grant: WorkflowCapabilityGrant;
  readonly current: SideEffectCap;
  readonly requiredMax: SideEffectCap;
  readonly uses: readonly CapabilityUse[];
  /** 当前等级下会在对应步骤暂停的工作流。 */
  readonly blocked: readonly CapabilityUse[];
}

export function capabilityRows(data: WorkflowCapabilityGrantsOut): CapabilityRow[] {
  return data.grants.map((grant) => {
    const uses: CapabilityUse[] = data.workflows.flatMap((w) =>
      w.capabilities
        .filter((c) => c.capabilityCategory === grant.capabilityCategory)
        .map((c) => ({ workflowId: w.workflowId, workflowKey: w.workflowKey, title: w.title, requiredCap: c.requiredCap, stageIds: c.stageIds })),
    );
    const current = effectiveCap(grant);
    const requiredMax = uses.reduce<SideEffectCap>((acc, u) => maxCap(acc, u.requiredCap), "read");
    return { category: grant.capabilityCategory, grant, current, requiredMax, uses, blocked: uses.filter((u) => !covers(current, u.requiredCap)) };
  }).sort((a, b) => b.blocked.length - a.blocked.length || b.uses.length - a.uses.length || a.category.localeCompare(b.category));
}

export interface WorkflowRow {
  readonly workflow: WorkflowCapabilityCatalogEntry;
  readonly items: readonly { category: string; requiredCap: SideEffectCap; current: SideEffectCap; ok: boolean; stageIds: readonly string[] }[];
  readonly ready: boolean;
}

export function workflowRows(data: WorkflowCapabilityGrantsOut): WorkflowRow[] {
  const byCat = new Map(data.grants.map((g) => [g.capabilityCategory, effectiveCap(g)]));
  return data.workflows.map((workflow) => {
    const items = workflow.capabilities.map((c) => {
      const current = byCat.get(c.capabilityCategory) ?? "read";
      return { category: c.capabilityCategory, requiredCap: c.requiredCap, current, ok: covers(current, c.requiredCap), stageIds: c.stageIds };
    });
    return { workflow, items, ready: items.every((i) => i.ok) };
  });
}
