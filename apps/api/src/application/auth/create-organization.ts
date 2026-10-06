import { AuthError } from "./errors";
import type { CredentialRepository } from "./ports";
export interface CreateOrganizationInput {
  readonly userId: string;
  readonly orgName: string;
  readonly requestId: string;
}
export interface CreateOrganizationOutput { readonly orgId: string; readonly orgName: string }
export interface OrganizationCreationRepository {
  /** Organization, first admin, replay receipt and standard agents commit together. */
  create(input: CreateOrganizationInput): Promise<CreateOrganizationOutput>;
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
  return deps.repo.create(input);
}
