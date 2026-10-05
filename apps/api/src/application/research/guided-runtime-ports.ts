import type { research as C } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import type { PersistedResearchRuntimeSchema } from "./guided-runtime-persistence";
export type ResearchRuntime = z.infer<typeof PersistedResearchRuntimeSchema>;
export type RuntimeCommand = z.infer<typeof C.GuidedResearchRuntimeCommand>;
export type RuntimeDraft = z.infer<typeof C.GuidedResearchRuntimeDraft>;
export interface RuntimeActor { orgId: OrgId; userId: string; sessionId: string }
export class ResearchRuntimeError extends Error {
  constructor(readonly reasonCode: string, options?: ErrorOptions) { super(reasonCode, options); }
}
export interface GuidedRuntimeStore {
  read(actor: RuntimeActor, initial: ResearchRuntime): Promise<ResearchRuntime>;
  claim(actor: RuntimeActor, command: RuntimeCommand, hash: string): Promise<{ state: ResearchRuntime; replay: boolean }>;
  steer?(actor: RuntimeActor, command: RuntimeCommand, hash: string): Promise<ResearchRuntime>;
  write(actor: RuntimeActor, requestId: string, state: ResearchRuntime, done: boolean): Promise<ResearchRuntime | void>;
}
export interface GuidedSearchPort {
  search(query: string, options?: { signal?: AbortSignal }): Promise<readonly { title: string; url: string; content: string }[]>;
  read?(url: string, options?: { signal?: AbortSignal }): Promise<{ text: string; contentKind: "html" | "pdf" | "text"; truncated: boolean }>;
}
export interface GuidedInternalSourceAccessPort {
  authorizedSourceIds(actor: RuntimeActor, requestedSourceIds: readonly string[]): Promise<readonly string[]>;
  loadAuthorizedSources(actor: RuntimeActor, requestedSourceIds: readonly string[]): Promise<readonly {
    id: string; title: string; content: string; retrievedAt: string; contentHash: string;
  }[]>;
}
export const GUIDED_RUNTIME_STORE = Symbol("GuidedRuntimeStore");
export const GUIDED_SEARCH_PORT = Symbol("GuidedSearchPort");
export const GUIDED_RUNTIME_SERVICE = Symbol("GuidedRuntimeService");

export type RuntimeStreamEvent = z.infer<typeof C.GuidedResearchRuntimeStreamEvent>;
export type RuntimeObserver = (event: RuntimeStreamEvent) => void;
