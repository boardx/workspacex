import { interview } from "@repo/contracts";
import type { IdFactory } from "../artifact/ports";
import type { OrgId } from "../../domain/org-id";
import type { ScopeSelector } from "../../domain/interview/scope";
import { scopeIsCoherent } from "../../domain/interview/scope";
import { DigitalInterviewInputInvalidError, IncoherentScopeError } from "./errors";
import type { DigitalInterviewRepository, StoredDigitalInterview } from "./digital-interview-ports";

export interface CreateDigitalInterviewDraftDeps {
  readonly repo: DigitalInterviewRepository;
  readonly ids: IdFactory;
}

export interface CreateDigitalInterviewDraftDto {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly scope: ScopeSelector;
  readonly name: string;
  readonly tags: readonly string[];
  readonly topic: string;
}

export async function createDigitalInterviewDraft(
  deps: CreateDigitalInterviewDraftDeps,
  input: CreateDigitalInterviewDraftDto,
): Promise<StoredDigitalInterview> {
  const parsed = interview.DigitalInterviewDraftInput.safeParse({
    name: input.name,
    tags: input.tags,
  });
  const topic = interview.operations.confirmDigitalInterviewTopic.in.shape.topic.safeParse(input.topic);
  if (!parsed.success || !topic.success) throw new DigitalInterviewInputInvalidError();
  if (!scopeIsCoherent(input.scope)) throw new IncoherentScopeError();

  return deps.repo.createDraft({
    orgId: input.orgId,
    interviewId: deps.ids.next("itv"),
    actorId: input.actorId,
    scope: input.scope,
    ...parsed.data,
    topic: topic.data,
  });
}
