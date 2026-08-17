import { createHash } from "node:crypto";
import { research as C } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import type { GuidedResearchSession } from "./guided-session-ports";
import type { GuidedResearchNodeReceiptRepository } from "./guided-workflow-receipt-ports";
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

function nodeMeta(status: NodeMeta["status"], version = 0): NodeMeta {
  return {
    status,
    version,
    confirmedVersion: status === "confirmed" || status === "completed" ? version : null,
    contentVersionId: null,
    modelId: null,
    modelInvocationId: null,
    modelOutputSchemaVersion: null,
    confirmedAt: null,
    updatedAt: new Date().toISOString(),
    errorCode: null,
  };
}

function briefNodeState(session: GuidedResearchSession): z.infer<typeof C.BriefNodeInputState> {
  return {
    name: session.title,
    tags: session.tags,
    topic: session.brief.topic,
    objective: session.brief.goal,
    timeRange: session.brief.timeRange,
    geography: session.brief.region,
    focus: session.brief.focus,
  };
}

function initialGraphState(session: GuidedResearchSession): Record<string, unknown> {
  return {
    sessionId: session.sessionId,
    graphVersion: 0,
    revision: 1,
    currentNode: "directions",
    availableNodes: ["brief", "directions"],
    nodeStates: { brief: briefNodeState(session) },
    nodeSummaries: {
      brief: nodeMeta("confirmed", 1),
      directions: nodeMeta("draft", 0),
      outline: nodeMeta("locked", 0),
      research: nodeMeta("locked", 0),
      report: nodeMeta("locked", 0),
    },
    processedRequests: {},
    pendingCommand: null,
    routedNode: null,
    lastRequestId: null,
  };
}

function allowedActions(node: ResearchNode): z.infer<typeof C.ResearchNodeAction>[] {
  if (node === "brief") return ["save", "confirm"];
  if (node === "directions" || node === "outline") return ["save", "generate", "confirm", "reconfirm"];
  if (node === "research") return ["save", "start", "retry", "complete", "reconfirm"];
  return ["save", "retry", "complete", "reconfirm"];
}

function project(values: Record<string, unknown>, _checkpointId: string | null): WorkflowProjection {
  const currentNode = C.ResearchNode.parse(values.currentNode);
  const nodeStates = values.nodeStates && typeof values.nodeStates === "object"
    ? values.nodeStates as Record<string, unknown>
    : {};
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
  constructor(
    private readonly receipts: GuidedResearchNodeReceiptRepository,
    private readonly graphUrl = process.env.GUIDED_RESEARCH_GRAPH_URL,
    private readonly directions?: GuidedResearchDirectionGenerator,
    private readonly outlines?: GuidedResearchOutlineGenerator,
  ) {}

  private requireGraphUrl(): string {
    if (!this.graphUrl) throw new GuidedResearchWorkflowError("RESEARCH_WORKFLOW_UNAVAILABLE");
    return this.graphUrl.replace(/\/+$/, "");
  }

  private async graphJson(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetch(`${this.requireGraphUrl()}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
    if (response.status === 404) throw new GuidedResearchWorkflowError("RESEARCH_NOT_FOUND");
    if (!response.ok) throw new GuidedResearchWorkflowError("RESEARCH_WORKFLOW_UNAVAILABLE");
    return response.json();
  }

  private async readGraph(sessionId: string): Promise<WorkflowProjection> {
    const raw = await this.graphJson(`/threads/${encodeURIComponent(sessionId)}/state`);
    const parsed = raw as { values?: Record<string, unknown>; checkpoint?: { checkpoint_id?: string } };
    if (!parsed.values) throw new GuidedResearchWorkflowError("RESEARCH_NOT_FOUND");
    return project(parsed.values, parsed.checkpoint?.checkpoint_id ?? null);
  }

  private async startGraph(session: GuidedResearchSession): Promise<WorkflowProjection> {
    await this.graphJson("/threads", {
      method: "POST",
      body: JSON.stringify({ thread_id: session.sessionId }),
    });
    await this.graphJson(`/threads/${encodeURIComponent(session.sessionId)}/runs/wait`, {
      method: "POST",
      body: JSON.stringify({ input: initialGraphState(session) }),
    });
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
    const generatedDirections = await this.generateDirectionsAfterBrief(input.command);
    const generatedOutline = await this.generateOutlineAfterDirections(input.command);

    await this.receipts.begin({
      orgId: input.orgId,
      sessionId: input.session.sessionId,
      requestId: input.command.requestId,
      node: input.command.node,
      action: input.command.action,
      payloadFingerprint,
    });

    await this.graphJson(`/threads/${encodeURIComponent(input.session.sessionId)}/runs/wait`, {
      method: "POST",
      body: JSON.stringify({ command: { resume: input.command } }),
    });
    if (generatedDirections && input.command.node === "brief") {
      await this.graphJson(`/threads/${encodeURIComponent(input.session.sessionId)}/runs/wait`, {
        method: "POST",
        body: JSON.stringify({
          command: {
            resume: this.generatedDirectionsCommand(
              input.command,
              current.graphVersion + 1,
              generatedDirections,
            ),
          },
        }),
      });
    }
    if (generatedOutline && input.command.node === "directions") {
      await this.graphJson(`/threads/${encodeURIComponent(input.session.sessionId)}/runs/wait`, {
        method: "POST",
        body: JSON.stringify({
          command: {
            resume: this.generatedOutlineCommand(
              input.command,
              current.graphVersion + 1,
              generatedOutline,
            ),
          },
        }),
      });
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
}
