import { research } from "@repo/contracts";
import { apiRequest } from "./api-client";
import type { z } from "zod";

export type GuidedResearchSession = z.infer<typeof research.GuidedResearchSession>;
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
