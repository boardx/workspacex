/**
 * WF03 —— 代码图工厂注册表（ADR-118 第 2 条：图本体在代码里，Definition 只是版本化元数据）与
 * LangGraph 图驱动（application `WorkflowGraphDriver` 的实现）。
 *
 * - 注册表同时实现 WF01 的 `WorkflowGraphCatalog`（发布校验：图工厂 `key:version` 已注册、阶段与节点一一对应）。
 * - 驱动按实例冻结的 graphRef 取图，用 checkpointer 工厂的 saver（checkpoint_ns = graphRef，thread_id = instanceId）
 *   编译执行。节点 = 阶段：节点体交给应用层 StageRunner（先写业务产出与事件），节点只把 outputId 指针放进
 *   state，所以 checkpoint 只存指针（ADR-118 第 4 条）。
 * - 已有 checkpoint → `invoke(null)` 从 checkpoint 续跑；没有且不允许新开（E11）→ checkpoint_missing。
 */
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { WorkflowGraphCatalog } from "../../application/workflow/workflow-ports";
import type { StageGatePreview, StageRunner, StageWork, WorkflowGraphDriver } from "../../application/workflow/run-instance";
import type { WorkflowCheckpointerFactory } from "./workflow-checkpointer-factory";

/** 线性阶段图：节点按声明顺序串联。 */
export interface LinearWorkflowGraph {
  graphRef: string;
  stages: readonly { stageId: string; work: StageWork; /** WF05：带人工门的阶段可给出副作用预览。 */ gatePreview?: StageGatePreview }[];
}

const GraphState = Annotation.Root({
  outputs: Annotation<Record<string, string>>({ reducer: (a, b) => ({ ...a, ...b }), default: () => ({}) }),
});

export class WorkflowGraphRegistry implements WorkflowGraphCatalog {
  private readonly graphs = new Map<string, LinearWorkflowGraph>();

  constructor(graphs: readonly LinearWorkflowGraph[]) {
    for (const g of graphs) {
      if (this.graphs.has(g.graphRef)) throw new Error(`workflow graph ${g.graphRef} registered twice`);
      this.graphs.set(g.graphRef, g);
    }
  }

  nodeIdsOf(graphRef: string): readonly string[] | null {
    return this.graphs.get(graphRef)?.stages.map((s) => s.stageId) ?? null;
  }

  get(graphRef: string): LinearWorkflowGraph | null {
    return this.graphs.get(graphRef) ?? null;
  }
}

function compile(graph: LinearWorkflowGraph, stage: StageRunner) {
  // 动态节点名：LangGraph 的节点名类型是字面量联合，这里按运行时声明构建，收窄为 string。
  const builder = new StateGraph(GraphState) as unknown as {
    addNode(id: string, fn: (s: typeof GraphState.State) => Promise<Partial<typeof GraphState.State>>): unknown;
    addEdge(from: string, to: string): unknown;
    compile(opts: { checkpointer: unknown }): { invoke(input: unknown, config: unknown): Promise<unknown> };
  };
  let prev: string = START;
  for (const s of graph.stages) {
    builder.addNode(s.stageId, async () => {
      const { outputId } = await stage(s.stageId, s.work, { gatePreview: s.gatePreview });
      return { outputs: { [s.stageId]: outputId } };
    });
    builder.addEdge(prev, s.stageId);
    prev = s.stageId;
  }
  builder.addEdge(prev, END);
  return builder;
}

export class LangGraphWorkflowDriver implements WorkflowGraphDriver {
  constructor(
    private readonly registry: WorkflowGraphRegistry,
    private readonly checkpointers: WorkflowCheckpointerFactory,
  ) {}

  async run(args: Parameters<WorkflowGraphDriver["run"]>[0]): Promise<"completed" | "checkpoint_missing"> {
    const graph = this.registry.get(args.instance.graphRef);
    if (!graph) throw new Error(`workflow graph ${args.instance.graphRef} is not registered`);
    const saver = this.checkpointers.saverFor(graph.graphRef);
    const config = this.checkpointers.configFor(args.instance.instanceId);
    const existing = await saver.getTuple(config);
    if (!existing && !args.allowFreshStart) return "checkpoint_missing";
    const app = compile(graph, args.stage).compile({ checkpointer: saver });
    await app.invoke(existing ? null : { outputs: {} }, config);
    return "completed";
  }
}
