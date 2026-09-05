import type { research as C } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
export type ResearchRuntime = z.infer<typeof C.GuidedResearchRuntime>;
export type RuntimeCommand = z.infer<typeof C.GuidedResearchRuntimeCommand>;
export type RuntimeDraft = z.infer<typeof C.GuidedResearchRuntimeDraft>;
export interface RuntimeActor { orgId: OrgId; userId: string; sessionId: string }
export class ResearchRuntimeError extends Error {
  constructor(readonly reasonCode: string) { super(reasonCode); }
}
export interface GuidedRuntimeStore {
  read(actor: RuntimeActor, initial: ResearchRuntime): Promise<ResearchRuntime>;
  claim(actor: RuntimeActor, command: RuntimeCommand, hash: string): Promise<{ state: ResearchRuntime; replay: boolean }>;
  write(actor: RuntimeActor, requestId: string, state: ResearchRuntime, done: boolean): Promise<void>;
}
export interface GuidedSearchPort {
  search(query: string): Promise<readonly { title: string; url: string; content: string }[]>;
}
export const GUIDED_RUNTIME_STORE = Symbol("GuidedRuntimeStore");
export const GUIDED_SEARCH_PORT = Symbol("GuidedSearchPort");
export const GUIDED_RUNTIME_SERVICE = Symbol("GuidedRuntimeService");
