import { Annotation, END, START, StateGraph, type BaseCheckpointSaver } from "@langchain/langgraph";
import { research as C } from "@repo/contracts";
import type { z } from "zod";
import type { GuidedResearchSession } from "./guided-session-ports";

type NodeCommand = z.infer<typeof C.GuidedResearchNodeCommand>;
type NodeMeta = z.infer<typeof C.GuidedResearchNodeMeta>;
type ResearchNode = z.infer<typeof C.ResearchNode>;

export interface GuidedResearchGraphState {
  readonly sessionId: string;
  readonly graphVersion: number;
  readonly revision: number;
  readonly currentNode: ResearchNode;
  readonly availableNodes: readonly ResearchNode[];
  readonly nodeStates: Record<string, unknown>;
  readonly nodeSummaries: Record<ResearchNode, NodeMeta>;
  readonly processedRequests: Record<string, string>;
  readonly pendingCommand: NodeCommand | null;
  readonly routedNode: ResearchNode | null;
  readonly lastRequestId: string | null;
}

export const GuidedResearchStateAnnotation = Annotation.Root({
  sessionId: Annotation<string>(),
  graphVersion: Annotation<number>(),
  revision: Annotation<number>(),
  currentNode: Annotation<ResearchNode>(),
  availableNodes: Annotation<readonly ResearchNode[]>(),
  nodeStates: Annotation<Record<string, unknown>>(),
  nodeSummaries: Annotation<Record<ResearchNode, NodeMeta>>(),
  processedRequests: Annotation<Record<string, string>>(),
  pendingCommand: Annotation<NodeCommand | null>(),
  routedNode: Annotation<ResearchNode | null>(),
  lastRequestId: Annotation<string | null>(),
});

function now(): string {
  return new Date().toISOString();
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
    updatedAt: now(),
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

export function initialGuidedResearchGraphState(session: GuidedResearchSession): GuidedResearchGraphState {
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

function nextAvailable(node: ResearchNode, action: NodeCommand["action"], previous: readonly ResearchNode[]): readonly ResearchNode[] {
  if (node === "brief" && (action === "confirm" || action === "reconfirm")) return ["brief", "directions"];
  if (node === "directions" && (action === "confirm" || action === "reconfirm")) return ["brief", "directions", "outline"];
  if (node === "outline" && (action === "confirm" || action === "reconfirm")) return ["brief", "directions", "outline", "research"];
  if (node === "research" && action === "complete") return ["brief", "directions", "outline", "research", "report"];
  return previous;
}

function nextCurrent(node: ResearchNode, action: NodeCommand["action"], previous: ResearchNode): ResearchNode {
  if (node === "brief" && (action === "confirm" || action === "reconfirm")) return "directions";
  if (node === "directions" && (action === "confirm" || action === "reconfirm")) return "outline";
  if (node === "outline" && (action === "confirm" || action === "reconfirm")) return "research";
  if (node === "research" && action === "complete") return "report";
  if (node === "report") return "report";
  return previous;
}

function nextNodeMeta(state: GuidedResearchGraphState, command: NodeCommand, graphVersion: number): NodeMeta {
  const previous = state.nodeSummaries[command.node] ?? nodeMeta("draft", 0);
  const timestamp = now();
  if (command.action === "generate") {
    const version = previous.version + 1;
    return {
      ...previous,
      status: "ready",
      version,
      updatedAt: timestamp,
      errorCode: null,
      contentVersionId: `content-${graphVersion}`,
      modelId: ["directions", "outline", "research", "report"].includes(command.node) ? "qwen3.7-plus" : previous.modelId,
      modelInvocationId: ["directions", "outline", "research", "report"].includes(command.node)
        ? `${state.sessionId}:${command.requestId}:${command.node}:generate`
        : previous.modelInvocationId,
      modelOutputSchemaVersion: command.node === "directions"
        ? "guided-research-directions:v1"
        : command.node === "outline"
          ? "guided-research-outline:v1"
          : command.node === "research"
            ? "guided-research-collection:v1"
            : command.node === "report"
              ? "guided-research-report:v1"
              : previous.modelOutputSchemaVersion,
    };
  }
  if (command.action === "confirm" || command.action === "reconfirm") {
    const version = previous.version > 0 ? previous.version : previous.version + 1;
    return {
      ...previous,
      status: "confirmed",
      version,
      confirmedVersion: version,
      confirmedAt: timestamp,
      updatedAt: timestamp,
      errorCode: null,
    };
  }
  if (command.action === "start") {
    return { ...previous, status: "running", updatedAt: timestamp, errorCode: null };
  }
  if (command.action === "complete") {
    const version = previous.version + 1;
    return {
      ...previous,
      status: "completed",
      version,
      confirmedVersion: version,
      confirmedAt: timestamp,
      updatedAt: timestamp,
      errorCode: null,
    };
  }
  return { ...previous, status: "draft", updatedAt: timestamp, errorCode: null };
}

function applyPendingCommand(state: GuidedResearchGraphState): Partial<GuidedResearchGraphState> {
  const command = state.pendingCommand;
  if (!command) return {};
  if (command.sessionId !== state.sessionId) {
    return {
      pendingCommand: null,
      routedNode: null,
      nodeSummaries: {
        ...state.nodeSummaries,
        [state.currentNode]: { ...state.nodeSummaries[state.currentNode], status: "failed", errorCode: "RESEARCH_SESSION_MISMATCH", updatedAt: now() },
      },
    };
  }
  const graphVersion = state.graphVersion + 1;
  return {
    graphVersion,
    revision: command.action === "reconfirm" ? state.revision + 1 : state.revision,
    currentNode: nextCurrent(command.node, command.action, state.currentNode),
    availableNodes: nextAvailable(command.node, command.action, state.availableNodes),
    nodeStates: { ...state.nodeStates, [command.node]: command.nodeState },
    nodeSummaries: {
      ...state.nodeSummaries,
      [command.node]: nextNodeMeta(state, command, graphVersion),
    },
    processedRequests: { ...state.processedRequests, [command.requestId]: command.node },
    pendingCommand: null,
    routedNode: command.node,
    lastRequestId: command.requestId,
  };
}

export function createGuidedResearchWorkflowGraph(input: {
  readonly checkpointer: BaseCheckpointSaver;
}) {
  return new StateGraph(GuidedResearchStateAnnotation)
    .addNode("apply_command", applyPendingCommand)
    .addEdge(START, "apply_command")
    .addEdge("apply_command", END)
    .compile({ checkpointer: input.checkpointer });
}
