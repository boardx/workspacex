import type { z } from "zod";
import type { wave2Runtime } from "@repo/contracts";
import type { OrgId } from "../../domain/org-id";
import type { SkillStarterPack } from "../../domain/skill/starter-pack";

export type SkillStarterImportResult = z.infer<typeof wave2Runtime.SkillStarterImportResult>;

export interface SkillStarterPackSource {
  load(packId: string, packVersion: string): Promise<unknown | null>;
}

export const SKILL_STARTER_PACK_SOURCE = Symbol("SkillStarterPackSource");

export type PersistVerifiedImportOutcome =
  | { readonly kind: "created"; readonly result: SkillStarterImportResult }
  | { readonly kind: "replayed"; readonly result: SkillStarterImportResult }
  | { readonly kind: "name-conflict" }
  | { readonly kind: "idempotency-conflict" }
  | { readonly kind: "previous-failure"; readonly failureCode: string };

export type ExistingImportOutcome =
  | { readonly kind: "missing" }
  | { readonly kind: "replayed"; readonly result: SkillStarterImportResult }
  | { readonly kind: "idempotency-conflict" }
  | { readonly kind: "previous-failure"; readonly failureCode: string };

export interface SkillStarterImportRepository {
  findExisting(input: {
    readonly orgId: OrgId;
    readonly idempotencyKey: string;
    readonly payloadDigest: string;
  }): Promise<ExistingImportOutcome>;

  persistVerified(input: {
    readonly orgId: OrgId;
    readonly actorId: string;
    readonly idempotencyKey: string;
    readonly payloadDigest: string;
    readonly pack: SkillStarterPack;
  }): Promise<PersistVerifiedImportOutcome>;

  recordFailure(input: {
    readonly orgId: OrgId;
    readonly actorId: string;
    readonly idempotencyKey: string;
    readonly payloadDigest: string;
    readonly packId: string;
    readonly packVersion: string;
    readonly packDigest: string | null;
    readonly failureCode: string;
  }): Promise<Exclude<ExistingImportOutcome, { readonly kind: "missing" }>>;
}

export const SKILL_STARTER_IMPORT_REPOSITORY = Symbol("SkillStarterImportRepository");
