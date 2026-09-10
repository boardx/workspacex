import type { DigitalInterviewRepository } from "./digital-interview-ports";
import type { OrgId } from "../../domain/org-id";
import { NoInterviewAccessError } from "./errors";

type ActorInput = { orgId: OrgId; actorId: string; interviewId: string };

export async function updateDigitalInterviewMetadata(
  repo: DigitalInterviewRepository,
  input: ActorInput & { name: string; tags: readonly string[] },
) {
  const tags = [...new Set(input.tags)];
  if (!await repo.updateMetadata({ ...input, tags })) throw new NoInterviewAccessError(input.interviewId);
  return { interviewId: input.interviewId, name: input.name, tags };
}

export async function deleteDigitalInterview(repo: DigitalInterviewRepository, input: ActorInput) {
  if (!await repo.archive(input)) throw new NoInterviewAccessError(input.interviewId);
  return { interviewId: input.interviewId, archived: true as const };
}
