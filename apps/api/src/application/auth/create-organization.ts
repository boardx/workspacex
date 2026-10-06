import { randomUUID } from "node:crypto";
import { discloseDecided, isDisclosed, type Guarded } from "../security/permission-filter";
import { decideOrganizationCreationReceipt } from "../../domain/auth/organization-creation-receipt";
import { AuthError } from "./errors";
import type { CredentialRepository } from "./ports";
export interface CreateOrganizationInput {
  readonly userId: string;
  readonly orgName: string;
  readonly requestId: string;
}
export interface CreateOrganizationOutput { readonly orgId: string; readonly orgName: string }
export interface OrganizationCreationReceipt {
  readonly creatorId: string;
  readonly requestId: string;
  readonly result: Guarded<CreateOrganizationOutput>;
}
export interface OrganizationCreationRepository {
  /** Organization, first admin, replay receipt and standard agents commit together. */
  create(input: CreateOrganizationInput): Promise<OrganizationCreationReceipt>;
}
export const ORGANIZATION_CREATION_REPOSITORY = Symbol("OrganizationCreationRepository");
export class OrganizationCreationConflict extends Error {
  readonly reasonCode = "ORGANIZATION_CREATION_CONFLICT" as const;
}
export async function createOrganization(
  deps: { readonly credentials: CredentialRepository; readonly repo: OrganizationCreationRepository },
  input: CreateOrganizationInput,
): Promise<CreateOrganizationOutput> {
  const credential = await deps.credentials.findByUserId(input.userId);
  if (!credential) throw new AuthError("SESSION_REVOKED");
  if (!credential.emailVerifiedAt) throw new AuthError("EMAIL_NOT_VERIFIED");
  const receipt = await deps.repo.create(input);
  const decision = decideOrganizationCreationReceipt({
    decisionId: randomUUID(), requesterId: input.userId, requestId: input.requestId,
    creatorId: receipt.creatorId, receiptRequestId: receipt.requestId,
  });
  const result = discloseDecided(receipt.result, decision);
  if (!isDisclosed(result)) throw new AuthError("SESSION_REVOKED");
  return result.payload;
}
