import type { z } from "zod";
import type { wave2Runtime } from "@repo/contracts";
import type { OrgId } from "../../domain/org-id";
import type { AgentStarterPack } from "../../domain/agent/starter-pack";

export type AgentStarterImportResult = z.infer<typeof wave2Runtime.AgentStarterImportResult>;
export interface AgentStarterPackSource { load(packId: string, packVersion: string): Promise<unknown | null>; }
export const AGENT_STARTER_PACK_SOURCE = Symbol("AgentStarterPackSource");

export type ExistingAgentImportOutcome =
  | { readonly kind: "missing" }
  | { readonly kind: "replayed"; readonly result: AgentStarterImportResult }
  | { readonly kind: "idempotency-conflict" }
  | { readonly kind: "previous-failure"; readonly failureCode: string };
export type PersistVerifiedAgentImportOutcome =
  | { readonly kind: "created"; readonly result: AgentStarterImportResult }
  | Exclude<ExistingAgentImportOutcome, { readonly kind: "missing" }>
  | { readonly kind: "name-conflict" }
  | { readonly kind: "skill-missing" }
  | { readonly kind: "skill-mismatch" };

export interface AgentStarterImportRepository {
  findExisting(input: { readonly orgId: OrgId; readonly idempotencyKey: string; readonly payloadDigest: string }): Promise<ExistingAgentImportOutcome>;
  persistVerified(input: { readonly orgId: OrgId; readonly actorId: string; readonly idempotencyKey: string; readonly payloadDigest: string; readonly pack: AgentStarterPack }): Promise<PersistVerifiedAgentImportOutcome>;
  recordFailure(input: { readonly orgId: OrgId; readonly actorId: string; readonly idempotencyKey: string; readonly payloadDigest: string; readonly packId: string; readonly packVersion: string; readonly packDigest: string | null; readonly failureCode: string }): Promise<Exclude<ExistingAgentImportOutcome, { readonly kind: "missing" }>>;
}
export const AGENT_STARTER_IMPORT_REPOSITORY = Symbol("AgentStarterImportRepository");
