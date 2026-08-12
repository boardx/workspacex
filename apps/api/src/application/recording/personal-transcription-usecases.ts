import type { IdentityRepository } from "../identity/ports";
import type { IdGenerator } from "./ports";
import type { OrgId } from "../../domain/org-id";
import type { PersonalTranscriptionRepository } from "./personal-transcription-ports";

export class PersonalTranscriptionOrgMembershipRequired extends Error {}
export class PersonalTranscriptionNotFound extends Error {}

async function requireOrgMembership(
  identities: IdentityRepository,
  userId: string,
  orgId: OrgId,
): Promise<void> {
  if ((await identities.findOrgMembership(userId, orgId)) === null) {
    throw new PersonalTranscriptionOrgMembershipRequired();
  }
}

export async function createPersonalTranscription(
  deps: { readonly identities: IdentityRepository; readonly repository: PersonalTranscriptionRepository; readonly ids: IdGenerator },
  input: { readonly userId: string; readonly orgId: OrgId; readonly name: string; readonly tags: readonly string[] },
) {
  await requireOrgMembership(deps.identities, input.userId, input.orgId);
  return deps.repository.create({
    transcriptionId: deps.ids.next("personal-transcription"),
    orgId: input.orgId,
    ownerUserId: input.userId,
    name: input.name,
    tags: input.tags,
  });
}

export async function listPersonalTranscriptions(
  deps: { readonly identities: IdentityRepository; readonly repository: PersonalTranscriptionRepository },
  input: {
    readonly userId: string;
    readonly orgId: OrgId;
    readonly query?: string;
    readonly tag?: string;
    readonly sort?: "recent" | "oldest";
    readonly cursor?: string;
  },
) {
  await requireOrgMembership(deps.identities, input.userId, input.orgId);
  return deps.repository.listOwned({
    orgId: input.orgId,
    ownerUserId: input.userId,
    query: input.query,
    tag: input.tag,
    sort: input.sort ?? "recent",
    cursor: input.cursor,
  });
}

export async function readPersonalTranscription(
  deps: { readonly identities: IdentityRepository; readonly repository: PersonalTranscriptionRepository },
  input: { readonly userId: string; readonly orgId: OrgId; readonly transcriptionId: string },
) {
  await requireOrgMembership(deps.identities, input.userId, input.orgId);
  const found = await deps.repository.readOwned({
    orgId: input.orgId,
    ownerUserId: input.userId,
    transcriptionId: input.transcriptionId,
  });
  if (found === undefined) throw new PersonalTranscriptionNotFound();
  return found;
}

