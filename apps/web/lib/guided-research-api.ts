import { research } from "@repo/contracts";
import { apiRequest } from "./api-client";
import type { z } from "zod";

export type GuidedResearchSession = z.infer<typeof research.GuidedResearchSession>;
export type GuidedResearchDirection = z.infer<typeof research.GuidedResearchDirection>;
export type GuidedResearchOutlineSection = z.infer<typeof research.GuidedResearchOutlineSection>;
export type CreateGuidedResearchSessionInput = z.infer<typeof research.operations.createGuidedResearchSession.in>;

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

async function checkpointRequest(
  operation: typeof research.operations.generateResearchDirections
    | typeof research.operations.confirmResearchDirections
    | typeof research.operations.generateResearchOutline
    | typeof research.operations.confirmResearchOutline,
  sessionId: string,
  body: Record<string, unknown>,
): Promise<GuidedResearchSession> {
  const path = operation.path.replace(":sessionId", encodeURIComponent(sessionId));
  const raw = await apiRequest<unknown>(path, { method: operation.method, body });
  return operation.out.parse(raw);
}

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
