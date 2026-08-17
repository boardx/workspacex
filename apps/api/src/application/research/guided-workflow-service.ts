import { createHash } from "node:crypto";
import type { RunnableConfig } from "@langchain/core/runnables";
import { type BaseCheckpointSaver } from "@langchain/langgraph";
import { research as C } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import type { GuidedResearchSession } from "./guided-session-ports";
import type { GuidedResearchNodeReceiptRepository } from "./guided-workflow-receipt-ports";
import {
  createGuidedResearchWorkflowGraph,
  initialGuidedResearchGraphState,
  type GuidedResearchGraphState,
} from "./guided-research-workflow-graph";
import {
  GuidedResearchDirectionGenerationError,
  type GuidedResearchDirectionGeneration,
  type GuidedResearchDirectionGenerator,
} from "./guided-direction-generator";
import {
  GuidedResearchOutlineGenerationError,
  type GuidedResearchOutlineGeneration,
  type GuidedResearchOutlineGenerator,
} from "./guided-outline-generator";
import {
  GuidedResearchCollectionGenerationError,
  type GuidedResearchCollectionGeneration,
  type GuidedResearchCollectionGenerator,
} from "./guided-research-collection-generator";
import {
  GuidedResearchReportGenerationError,
  type GuidedResearchReportGeneration,
  type GuidedResearchReportGenerator,
} from "./guided-research-report-generator";

type WorkflowProjection = z.infer<typeof C.GuidedResearchWorkflowProjection>;
type NodeCommand = z.infer<typeof C.GuidedResearchNodeCommand>;
type NodeMeta = z.infer<typeof C.GuidedResearchNodeMeta>;
type ResearchNode = z.infer<typeof C.ResearchNode>;

export const GUIDED_RESEARCH_WORKFLOW_SERVICE = Symbol("GuidedResearchWorkflowService");

export class GuidedResearchWorkflowError extends Error {
  constructor(readonly reasonCode: string, readonly latestProjection?: WorkflowProjection) {
    super(reasonCode);
  }
}

const RESEARCH_NODES: readonly ResearchNode[] = ["brief", "directions", "outline", "research", "report"];

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)));
  });
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function allowedActions(node: ResearchNode): z.infer<typeof C.ResearchNodeAction>[] {
  if (node === "brief") return ["save", "confirm"];
  if (node === "directions" || node === "outline") return ["save", "generate", "confirm", "reconfirm"];
  if (node === "research") return ["save", "start", "retry", "complete", "reconfirm"];
  return ["save", "retry", "complete", "reconfirm"];
}

function checkpointConfig(sessionId: string): RunnableConfig {
  return { configurable: { thread_id: sessionId } };
}

function project(values: GuidedResearchGraphState, _checkpointId: string | null): WorkflowProjection {
  const currentNode = C.ResearchNode.parse(values.currentNode);
  const nodeStates = values.nodeStates;
  const fallbackState = nodeStates[currentNode] ?? nodeStates.brief ?? {};
  return C.GuidedResearchWorkflowProjection.parse({
    sessionId: values.sessionId,
    graphVersion: values.graphVersion,
    revision: values.revision,
    currentNode,
    availableNodes: values.availableNodes,
    nodeSummaries: values.nodeSummaries,
    activeNodeState: fallbackState,
    nodeStateVersions: Object.fromEntries(
      RESEARCH_NODES.flatMap((node) => {
        const meta = (values.nodeSummaries as Record<string, NodeMeta> | undefined)?.[node];
        return meta && meta.version > 0 ? [[node, meta.version]] : [];
      }),
    ),
    skill: {
      threadId: values.sessionId,
      activeNode: currentNode,
      summaryId: null,
      recentMessageIds: [],
      activeProposalId: null,
      proposalStatus: "none",
    },
    interrupt: { node: currentNode, allowedActions: allowedActions(currentNode) },
  });
}

export class GuidedResearchWorkflowService {
  private readonly graph;

  constructor(
    private readonly receipts: GuidedResearchNodeReceiptRepository,
    private readonly checkpointer: BaseCheckpointSaver,
    private readonly directions?: GuidedResearchDirectionGenerator,
    private readonly outlines?: GuidedResearchOutlineGenerator,
    private readonly collections?: GuidedResearchCollectionGenerator,
    private readonly reports?: GuidedResearchReportGenerator,
  ) {
    this.graph = createGuidedResearchWorkflowGraph({ checkpointer });
  }

  async onModuleDestroy(): Promise<void> {
    const checkpointer = this.checkpointer as BaseCheckpointSaver & { end?: () => Promise<void> };
    await checkpointer.end?.();
  }

  private async readGraph(sessionId: string): Promise<WorkflowProjection> {
    const state = await this.readGraphState(sessionId);
    return project(state.values, state.checkpointId);
  }

  private async readGraphState(sessionId: string): Promise<{ values: GuidedResearchGraphState; checkpointId: string | null }> {
    const tuple = await this.checkpointer.getTuple(checkpointConfig(sessionId));
    const values = tuple?.checkpoint.channel_values as GuidedResearchGraphState | undefined;
    if (!values?.sessionId) throw new GuidedResearchWorkflowError("RESEARCH_NOT_FOUND");
    return { values, checkpointId: tuple?.checkpoint.id ?? null };
  }

  private async startGraph(session: GuidedResearchSession): Promise<WorkflowProjection> {
    await this.graph.invoke(initialGuidedResearchGraphState(session), checkpointConfig(session.sessionId));
    return this.readGraph(session.sessionId);
  }

  private async loadOrStart(session: GuidedResearchSession): Promise<WorkflowProjection> {
    try {
      return await this.readGraph(session.sessionId);
    } catch (error) {
      if (error instanceof GuidedResearchWorkflowError && error.reasonCode === "RESEARCH_NOT_FOUND") {
        return this.startGraph(session);
      }
      throw error;
    }
  }

  async getWorkflow(session: GuidedResearchSession): Promise<WorkflowProjection> {
    return this.loadOrStart(session);
  }

  async execute(input: {
    orgId: OrgId;
    session: GuidedResearchSession;
    command: NodeCommand;
  }): Promise<WorkflowProjection> {
    const payloadFingerprint = fingerprint(input.command);
    const replay = await this.receipts.find({
      orgId: input.orgId,
      sessionId: input.session.sessionId,
      requestId: input.command.requestId,
    });
    if (replay) {
      if (replay.payloadFingerprint !== payloadFingerprint || !replay.stableResponse) {
        throw new GuidedResearchWorkflowError("RESEARCH_IDEMPOTENCY_REPLAY_MISMATCH");
      }
      return C.GuidedResearchWorkflowProjection.parse(replay.stableResponse);
    }

    const current = await this.loadOrStart(input.session);
    if (current.graphVersion !== input.command.expectedGraphVersion) {
      throw new GuidedResearchWorkflowError("RESEARCH_GRAPH_VERSION_CONFLICT", current);
    }
    const graphState = await this.readGraphState(input.session.sessionId);
    const generatedDirections = await this.generateDirectionsAfterBrief(input.command);
    const generatedOutline = await this.generateOutlineAfterDirections(input.command);
    const generatedCollection = await this.generateCollectionAfterOutline(input.command, graphState.values);
    const generatedReport = await this.generateReportAfterResearch(input.command, graphState.values);

    await this.receipts.begin({
      orgId: input.orgId,
      sessionId: input.session.sessionId,
      requestId: input.command.requestId,
      node: input.command.node,
      action: input.command.action,
      payloadFingerprint,
    });

    await this.runCommand(input.session.sessionId, input.command);
    if (generatedDirections && input.command.node === "brief") {
      await this.runCommand(
        input.session.sessionId,
        this.generatedDirectionsCommand(input.command, current.graphVersion + 1, generatedDirections),
      );
    }
    if (generatedOutline && input.command.node === "directions") {
      await this.runCommand(
        input.session.sessionId,
        this.generatedOutlineCommand(input.command, current.graphVersion + 1, generatedOutline),
      );
    }
    if (generatedCollection && input.command.node === "outline") {
      await this.runCommand(
        input.session.sessionId,
        this.generatedCollectionCommand(input.command, current.graphVersion + 1, generatedCollection),
      );
    }
    if (generatedReport && input.command.node === "research") {
      await this.runCommand(
        input.session.sessionId,
        this.generatedReportCommand(input.command, current.graphVersion + 1, generatedReport),
      );
    }
    const projection = await this.readGraph(input.session.sessionId);
    await this.receipts.finalize({
      orgId: input.orgId,
      sessionId: input.session.sessionId,
      requestId: input.command.requestId,
      checkpointId: `cp-${projection.graphVersion}`,
      graphVersion: projection.graphVersion,
      stableResponse: projection,
    });
    return projection;
  }

  private async runCommand(sessionId: string, command: NodeCommand): Promise<void> {
    const state = await this.readGraphState(sessionId);
    await this.graph.invoke({ ...state.values, pendingCommand: command }, checkpointConfig(sessionId));
  }

  private async generateDirectionsAfterBrief(command: NodeCommand): Promise<GuidedResearchDirectionGeneration | null> {
    if (command.node !== "brief" || !["confirm", "reconfirm"].includes(command.action)) return null;
    if (!this.directions) throw new GuidedResearchWorkflowError("RESEARCH_WORKFLOW_UNAVAILABLE");
    try {
      return await this.directions.generate({
        sessionId: command.sessionId,
        requestId: command.requestId,
        brief: command.nodeState,
      });
    } catch (error) {
      if (error instanceof GuidedResearchDirectionGenerationError) {
        throw new GuidedResearchWorkflowError(error.reasonCode);
      }
      throw error;
    }
  }

  private async generateOutlineAfterDirections(command: NodeCommand): Promise<GuidedResearchOutlineGeneration | null> {
    if (command.node !== "directions" || !["confirm", "reconfirm"].includes(command.action)) return null;
    if (!this.outlines) throw new GuidedResearchWorkflowError("RESEARCH_WORKFLOW_UNAVAILABLE");
    try {
      return await this.outlines.generate({
        sessionId: command.sessionId,
        requestId: command.requestId,
        directions: command.nodeState,
      });
    } catch (error) {
      if (error instanceof GuidedResearchOutlineGenerationError) {
        throw new GuidedResearchWorkflowError(error.reasonCode);
      }
      throw error;
    }
  }

  private async generateCollectionAfterOutline(
    command: NodeCommand,
    state: GuidedResearchGraphState,
  ): Promise<GuidedResearchCollectionGeneration | null> {
    if (command.node !== "outline" || !["confirm", "reconfirm"].includes(command.action)) return null;
    if (!this.collections) throw new GuidedResearchWorkflowError("RESEARCH_WORKFLOW_UNAVAILABLE");
    try {
      return await this.collections.generate({
        sessionId: command.sessionId,
        requestId: command.requestId,
        brief: C.BriefNodeInputState.parse(state.nodeStates.brief),
        directions: C.DirectionsNodeInputState.parse(state.nodeStates.directions),
        outline: command.nodeState,
      });
    } catch (error) {
      if (error instanceof GuidedResearchCollectionGenerationError) {
        throw new GuidedResearchWorkflowError(error.reasonCode);
      }
      throw error;
    }
  }

  private async generateReportAfterResearch(
    command: NodeCommand,
    state: GuidedResearchGraphState,
  ): Promise<GuidedResearchReportGeneration | null> {
    if (command.node !== "research" || command.action !== "complete") return null;
    if (!this.reports) throw new GuidedResearchWorkflowError("RESEARCH_WORKFLOW_UNAVAILABLE");
    try {
      return await this.reports.generate({
        sessionId: command.sessionId,
        requestId: command.requestId,
        brief: C.BriefNodeInputState.parse(state.nodeStates.brief),
        outline: C.OutlineNodeInputState.parse(state.nodeStates.outline),
        research: command.nodeState,
        revisionInstruction: "",
      });
    } catch (error) {
      if (error instanceof GuidedResearchReportGenerationError) {
        throw new GuidedResearchWorkflowError(error.reasonCode);
      }
      throw error;
    }
  }

  private generatedDirectionsCommand(
    source: Extract<NodeCommand, { node: "brief" }>,
    expectedGraphVersion: number,
    generation: GuidedResearchDirectionGeneration,
  ): NodeCommand {
    const generatedRequestId = `${source.requestId}:generated-directions`;
    return C.GuidedResearchNodeCommand.parse({
      sessionId: source.sessionId,
      node: "directions",
      action: "generate",
      requestId: generatedRequestId.length <= 200
        ? generatedRequestId
        : `generated-directions-${fingerprint({ sessionId: source.sessionId, requestId: source.requestId }).slice(0, 32)}`,
      expectedGraphVersion,
      nodeState: {
        directions: generation.directions,
      },
    });
  }

  private generatedOutlineCommand(
    source: Extract<NodeCommand, { node: "directions" }>,
    expectedGraphVersion: number,
    generation: GuidedResearchOutlineGeneration,
  ): NodeCommand {
    const generatedRequestId = `${source.requestId}:generated-outline`;
    return C.GuidedResearchNodeCommand.parse({
      sessionId: source.sessionId,
      node: "outline",
      action: "generate",
      requestId: generatedRequestId.length <= 200
        ? generatedRequestId
        : `generated-outline-${fingerprint({ sessionId: source.sessionId, requestId: source.requestId }).slice(0, 32)}`,
      expectedGraphVersion,
      nodeState: {
        sections: generation.sections,
      },
    });
  }

  private generatedCollectionCommand(
    source: Extract<NodeCommand, { node: "outline" }>,
    expectedGraphVersion: number,
    generation: GuidedResearchCollectionGeneration,
  ): NodeCommand {
    const generatedRequestId = `${source.requestId}:generated-research`;
    return C.GuidedResearchNodeCommand.parse({
      sessionId: source.sessionId,
      node: "research",
      action: "generate",
      requestId: generatedRequestId.length <= 200
        ? generatedRequestId
        : `generated-research-${fingerprint({ sessionId: source.sessionId, requestId: source.requestId }).slice(0, 32)}`,
      expectedGraphVersion,
      nodeState: generation.state,
    });
  }

  private generatedReportCommand(
    source: Extract<NodeCommand, { node: "research" }>,
    expectedGraphVersion: number,
    generation: GuidedResearchReportGeneration,
  ): NodeCommand {
    const generatedRequestId = `${source.requestId}:generated-report`;
    return C.GuidedResearchNodeCommand.parse({
      sessionId: source.sessionId,
      node: "report",
      action: "generate",
      requestId: generatedRequestId.length <= 200
        ? generatedRequestId
        : `generated-report-${fingerprint({ sessionId: source.sessionId, requestId: source.requestId }).slice(0, 32)}`,
      expectedGraphVersion,
      nodeState: generation.state,
    });
  }
}
