import { createHash } from "node:crypto";
import { DiscoveryOutlinePlanBoundary } from "@repo/contracts/discovery-execution";
import { MIN_OPENERS_PER_SECTION, type OutlineSectionDraft } from "../../domain/interview/outline";

export interface DiscoveryOutlineImport {
  readonly externalRef: string;
  readonly planId: string;
  readonly sections: readonly OutlineSectionDraft[];
  readonly researchQuestions: readonly { questionId: string; text: string }[];
}

/** Only explicit questions become openers. Scripts/probes cannot pad an incomplete guide. */
export function prepareDiscoveryOutline(instanceId: string, round: number, output: unknown,
  plannedMinutes: number): DiscoveryOutlineImport {
  const plan = DiscoveryOutlinePlanBoundary.parse(output);
  if (!instanceId || !Number.isInteger(round) || round < 1 || round > 2 ||
    !Number.isInteger(plannedMinutes) || plannedMinutes < 15 || plannedMinutes > 120) {
    throw new Error("discovery_outline_context_invalid");
  }
  const rqs = new Set(plan.researchQuestions.map(q => q.questionId));
  const sectionIds = new Set<string>(); const orders = new Set<number>(); const itemIds = new Set<string>();
  if (rqs.size !== plan.researchQuestions.length) throw new Error("discovery_outline_duplicate_rq");
  const sections = plan.guide.map(section => {
    if (sectionIds.has(section.sectionId) || orders.has(section.order)) throw new Error("discovery_outline_duplicate_section");
    sectionIds.add(section.sectionId); orders.add(section.order);
    const questions = new Set(section.items.filter(item => item.kind === "question").map(item => item.itemId));
    for (const item of section.items) {
      if (itemIds.has(item.itemId)) throw new Error("discovery_outline_duplicate_item");
      itemIds.add(item.itemId);
      if (item.kind !== "script" && (!item.rqIds.length || item.rqIds.some(id => !rqs.has(id)))) {
        throw new Error("discovery_outline_unknown_rq");
      }
      if (item.kind === "probe" && (!item.parentItemId || !questions.has(item.parentItemId))) {
        throw new Error("discovery_outline_orphan_probe");
      }
    }
    const openers = section.items.filter(item => item.kind === "question").map(item => item.text);
    if (openers.length < MIN_OPENERS_PER_SECTION) throw new Error("discovery_outline_incomplete");
    return { objective: section.objective, openers, minutes: section.minutes, order: section.order };
  }).sort((a, b) => a.order - b.order);
  if (sections.reduce((total, section) => total + section.minutes, 0) > plannedMinutes) {
    throw new Error("discovery_outline_time_budget_exceeded");
  }
  return { externalRef: createHash("sha256").update(JSON.stringify([instanceId, round, plan.planId])).digest("hex"),
    planId: plan.planId, sections, researchQuestions: plan.researchQuestions };
}
