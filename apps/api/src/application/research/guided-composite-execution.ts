import { research as C } from "@repo/contracts";
import { ResearchRuntimeError, type ResearchRuntime, type RuntimeCommand, type RuntimeDraft } from "./guided-runtime-ports";
import { preservePreviousReport } from "./guided-report-history";
import type { RuntimePersistence } from "./guided-report-stream";

type Node = ResearchRuntime["currentNode"];
type Activity = NonNullable<ResearchRuntime["activity"]>[number];
export type CompositeSteps = {
  save: (draft: RuntimeDraft) => Promise<void>;
  generate: (node: Node, resume: boolean) => Promise<void>;
  search: (resume: boolean) => Promise<void>;
  completeReport: () => Promise<void>;
  validateOutline: () => void;
  activity: (stage: Activity["stage"], summary: string, status: Activity["status"]) => void;
};

/** One claimed execution owns this chain. Persisted artifacts and intent select
 * the remaining work; reads/replays never launch it and every old gate stays in
 * the supplied single-node steps. No client-side automatic continuation. */
export async function executeComposite(state: ResearchRuntime, command: RuntimeCommand, persist: RuntimePersistence, steps: CompositeSteps) {
  const retry = command.action === "retry";
  const goal = retry ? state.executionGoal : command.action === "prepare_plan" ? "plan" : "report";
  if (!goal || (retry && (command.draft || command.message || command.allowPartialResearch !== undefined)) || !C.GuidedResearchRuntimeCommand.safeParse(command).success) throw new ResearchRuntimeError("RESEARCH_NODE_STATE_INVALID");
  if (!retry && !state.availableNodes.includes(command.node)) throw new ResearchRuntimeError("RESEARCH_NODE_MISMATCH");
  if (command.draft) {
    await steps.save(command.draft);
    if (goal === "plan") state.generatedNodes = state.generatedNodes.filter(node => node !== command.draft!.node);
  }
  state.executionGoal = goal;
  if (!retry && goal === "report") {
    // A new execution cannot publish the previous attempt's completed stages.
    // Retain its saved body/history; retry keeps its resumable timeline intact.
    preservePreviousReport(state);
    state.reportTimeline = []; state.progress = null; state.completed = false;
  }
  const publish = async () => { await persist(); persist.observe({ type: "snapshot", state: structuredClone(state) }); };
  const check = () => { if (state.controlStatus === "paused") throw new ResearchRuntimeError("RESEARCH_WORKFLOW_PAUSED"); };
  const enter = async (node: Node) => {
    check(); state.currentNode = node;
    state.availableNodes = C.ResearchNode.options.slice(0, C.ResearchNode.options.indexOf(node) + 1);
    await publish();
  };
  await publish(); check();
  if (goal === "plan") {
    if (state.generatedNodes.includes("outline")) { await enter("outline"); return; }
    steps.activity("planning", "正在分析研究内容并准备研究计划", "started");
    state.progress = { executionVersion: state.version, stage: "planning", completed: 0, total: 3 }; await publish();
    try {
      for (const node of ["brief", "directions", "outline"] as const) {
        if (!state.generatedNodes.includes(node)) { await enter(node); await steps.generate(node, retry); }
        check();
        state.progress = { executionVersion: state.version, stage: "planning", completed: ["brief", "directions", "outline"].indexOf(node) + 1, total: 3 };
        await publish();
      }
      steps.activity("planning", "研究计划已生成，等待确认", "succeeded"); await publish();
    } catch (error) { steps.activity("planning", "研究计划未完成", "failed"); throw error; }
    return;
  }
  if (retry && state.completed && !state.reportPartial && state.report && state.generatedNodes.includes("report") && !state.reportQualityWarnings?.length && state.tasks.length && state.tasks.every(task => task.status === "succeeded")) {
    await steps.completeReport(); return;
  }
  // A legacy partial publication stays readable as history; it cannot become a
  // full composite publication by clearing its partial flag or skipping search.
  if (state.reportPartial && state.report) {
    preservePreviousReport(state); state.report = null;
    state.generatedNodes = state.generatedNodes.filter(node => node !== "report");
  }
  state.completed = false; state.reportPartial = false;
  check(); steps.validateOutline();
  if (!state.generatedNodes.includes("outline")) state.generatedNodes.push("outline");
  // A saved chapter edit may retain successful sources/tasks. Existing source
  // preparation independently checks their new basis before report generation.
  if (!state.tasks.length || state.tasks.some(task => task.status !== "succeeded")) {
    await enter("research"); await steps.search(retry); check();
  }
  await enter("report");
  if (!retry || !state.report || !state.generatedNodes.includes("report")) await steps.generate("report", retry);
  check();
  if (!state.report || state.reportQualityWarnings?.length) throw new ResearchRuntimeError(state.reportDraft || state.reportQualityWarnings?.length ? "RESEARCH_REPORT_QUALITY_INSUFFICIENT" : "RESEARCH_NODE_STATE_INVALID");
  // Completion is the old explicit report command: citation, basis and quality
  // requirements are not replaced by a non-null report or optimistic UI state.
  await steps.completeReport();
}
