import { research } from "@repo/contracts";
import { apiRequest } from "./api-client";
import { streamResearchCommand, type ResearchStreamEvent } from "./guided-research-stream";
import type { z } from "zod";

export type GuidedResearchSession = z.infer<typeof research.GuidedResearchSession>;
export type GuidedResearchWorkflowProjection = z.infer<typeof research.GuidedResearchWorkflowProjection>;
export type GuidedResearchNodeCommand = z.infer<typeof research.GuidedResearchNodeCommand>;
export type GuidedResearchDirection = z.infer<typeof research.GuidedResearchDirection>;
export type GuidedResearchOutlineSection = z.infer<typeof research.GuidedResearchOutlineSection>;
export type CreateGuidedResearchSessionInput = z.infer<typeof research.operations.createGuidedResearchSession.in>;
export type GuidedResearchSkillDraft = z.infer<typeof research.GuidedResearchSkillDraft>;
export type GuidedResearchSkillTurnResponse = z.infer<typeof research.GuidedResearchSkillTurnResponse>;

export async function runGuidedResearchSkillTurn(input: z.infer<typeof research.operations.runGuidedResearchSkillTurn.in>): Promise<GuidedResearchSkillTurnResponse> {
  const validated = research.operations.runGuidedResearchSkillTurn.in.parse(input);
  const raw = await apiRequest<unknown>(research.operations.runGuidedResearchSkillTurn.path, {
    method: research.operations.runGuidedResearchSkillTurn.method,
    body: validated,
  });
  return research.operations.runGuidedResearchSkillTurn.out.parse(raw);
}

export async function listGuidedResearchSessions(): Promise<{ items: GuidedResearchSession[] }> {
  const raw = await apiRequest<unknown>(research.operations.listGuidedResearchSessions.path);
  return research.operations.listGuidedResearchSessions.out.parse(raw);
}

export async function createGuidedResearchSession(
  input: CreateGuidedResearchSessionInput,
): Promise<GuidedResearchSession> {
  const validated = research.operations.createGuidedResearchSession.in.parse(input);
  const raw = await apiRequest<unknown>(research.operations.createGuidedResearchSession.path, {
    method: "POST",
    body: validated,
  });
  return research.operations.createGuidedResearchSession.out.parse(raw);
}

export async function getGuidedResearchSession(sessionId: string): Promise<GuidedResearchSession> {
  const input = research.operations.getGuidedResearchSession.in.parse({ sessionId });
  const path = research.operations.getGuidedResearchSession.path.replace(":sessionId", encodeURIComponent(input.sessionId));
  const raw = await apiRequest<unknown>(path);
  return research.operations.getGuidedResearchSession.out.parse(raw);
}

export async function getGuidedResearchWorkflow(sessionId: string): Promise<GuidedResearchWorkflowProjection> {
  const input = research.operations.getGuidedResearchWorkflow.in.parse({ sessionId });
  const path = research.operations.getGuidedResearchWorkflow.path.replace(":sessionId", encodeURIComponent(input.sessionId));
  const raw = await apiRequest<unknown>(path);
  return research.operations.getGuidedResearchWorkflow.out.parse(raw);
}

export async function executeGuidedResearchNodeCommand(
  sessionId: string,
  command: Omit<GuidedResearchNodeCommand, "sessionId">,
): Promise<GuidedResearchWorkflowProjection> {
  const validated = research.operations.executeGuidedResearchNode.in.parse({ ...command, sessionId });
  const path = research.operations.executeGuidedResearchNode.path
    .replace(":sessionId", encodeURIComponent(validated.sessionId))
    .replace(":node", encodeURIComponent(validated.node));
  const raw = await apiRequest<unknown>(path, {
    method: research.operations.executeGuidedResearchNode.method,
    body: validated,
  });
  return research.operations.executeGuidedResearchNode.out.parse(raw);
}

async function checkpointRequest(
  operation: typeof research.operations.confirmResearchBrief
    | typeof research.operations.generateResearchDirections
    | typeof research.operations.confirmResearchDirections
    | typeof research.operations.generateResearchOutline
    | typeof research.operations.confirmResearchOutline
    | typeof research.operations.finishGuidedResearchCollection
    | typeof research.operations.completeGuidedResearchSession,
  sessionId: string,
  body: Record<string, unknown>,
): Promise<GuidedResearchSession> {
  const path = operation.path.replace(":sessionId", encodeURIComponent(sessionId));
  const raw = await apiRequest<unknown>(path, { method: operation.method, body });
  return operation.out.parse(raw);
}

export const confirmResearchBrief = (
  sessionId: string,
  input: Omit<z.infer<typeof research.operations.confirmResearchBrief.in>, "sessionId">,
) => checkpointRequest(research.operations.confirmResearchBrief, sessionId, input);
export const generateResearchDirections = (sessionId: string) =>
  checkpointRequest(research.operations.generateResearchDirections, sessionId, {});
export const confirmResearchDirections = (
  sessionId: string,
  input: Omit<z.infer<typeof research.operations.confirmResearchDirections.in>, "sessionId">,
) => checkpointRequest(research.operations.confirmResearchDirections, sessionId, input);
export const generateResearchOutline = (sessionId: string) =>
  checkpointRequest(research.operations.generateResearchOutline, sessionId, {});
export const confirmResearchOutline = (
  sessionId: string,
  input: Omit<z.infer<typeof research.operations.confirmResearchOutline.in>, "sessionId">,
) => checkpointRequest(research.operations.confirmResearchOutline, sessionId, input);
export const finishGuidedResearchCollection = (
  sessionId: string,
  input: Omit<z.infer<typeof research.operations.finishGuidedResearchCollection.in>, "sessionId">,
) => checkpointRequest(research.operations.finishGuidedResearchCollection, sessionId, input);
export const completeGuidedResearchSession = (sessionId: string) =>
  checkpointRequest(research.operations.completeGuidedResearchSession, sessionId, {});

export type GuidedResearchRuntime = z.infer<typeof research.GuidedResearchRuntime>;
export type GuidedResearchRuntimeCommand = z.infer<typeof research.GuidedResearchRuntimeCommand>;
export type GuidedResearchRuntimeDraft = z.infer<typeof research.GuidedResearchRuntimeDraft>;
export async function getResearchRuntime(sessionId: string): Promise<GuidedResearchRuntime> {
  const op = research.operations.getGuidedResearchRuntime;
  return research.GuidedResearchRuntime.parse(await apiRequest(op.path.replace(":sessionId", encodeURIComponent(sessionId)), { method: op.method }));
}
export async function executeResearchRuntime(input: GuidedResearchRuntimeCommand, onEvent?: (event: ResearchStreamEvent) => void, signal?: AbortSignal): Promise<GuidedResearchRuntime> {
  if (onEvent) return streamResearchCommand(input, onEvent, signal);
  const op = research.operations.executeGuidedResearchRuntime;
  return research.GuidedResearchRuntime.parse(await apiRequest(op.path.replace(":sessionId", encodeURIComponent(input.sessionId)), { method: op.method, body: input }));
}
