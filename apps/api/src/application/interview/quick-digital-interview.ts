import { interview } from "@repo/contracts";
import { buildSystemPrompt } from "../agent-run/execute-run";
import type { AgentRunStore, ModelCallPort } from "../agent-run/ports";
import { ModelCallError } from "../agent-run/ports";
import type { IdFactory } from "../artifact/ports";
import type { PublishedAgentReader } from "../chat/message-command-ports";
import type { DecisionIdFactory } from "../identity/ports";
import type { OrgId } from "../../domain/org-id";
import type {
  DigitalInterviewRepository,
  StoredQuickInterview,
} from "./digital-interview-ports";
import type { DigitalExpertContextMaterial } from "./digital-interview-ports";
import {
  DigitalInterviewConcurrentModificationError,
  DigitalInterviewDependencyUnavailableError,
  DigitalInterviewInputInvalidError,
  DigitalInterviewPermissionRevokedMidwayError,
  NoInterviewAccessError,
} from "./errors";
import { getDigitalInterview } from "./get-digital-interview";
import type { InterviewScopeRepository } from "./ports";

export interface QuickDeps {
  repo: DigitalInterviewRepository;
  ids: IdFactory;
  agents: PublishedAgentReader;
  runs: Pick<AgentRunStore, "readPinnedSkills">;
  model: ModelCallPort;
  scope: InterviewScopeRepository;
  decisions: DecisionIdFactory;
  context: import("./digital-interview-ports").DigitalExpertContextApi;
}

type QuickInput = { orgId: OrgId; actorId: string; interviewId: string };

function presentQuick(stored: StoredQuickInterview) {
  return interview.QuickDigitalInterview.parse({
    ...stored,
    expert: {
      expertId: stored.expert.expertId,
      initials: stored.expert.initials,
      displayName: stored.expert.displayName,
      role: stored.expert.role,
      domains: stored.expert.domains,
      materialBoundary: stored.expert.materialContextPackId === null
        ? "未绑定 Context Pack 材料版本"
        : `Context Pack ${stored.expert.materialContextPackId} · ${stored.expert.materialVersion}`,
      exploratory: true,
    },
    messages: stored.messages.map((message) => ({ ...message, exploratory: true })),
  });
}

export async function startQuick(
  deps: QuickDeps,
  input: { orgId: OrgId; actorId: string; expertId: string; requestId: string },
) {
  const experts = await deps.repo.listVisibleExperts({
    orgId: input.orgId,
    viewerUserId: input.actorId,
  });
  const expert = experts.find((candidate) => candidate.expertId === input.expertId);
  if (!expert) throw new NoInterviewAccessError(input.expertId);

  const stored = await deps.repo.createQuick({
    orgId: input.orgId,
    interviewId: deps.ids.next("itv-quick"),
    actorId: input.actorId,
    requestId: input.requestId,
    expert,
  });
  return presentQuick(stored);
}

export async function getQuick(
  deps: Pick<QuickDeps, "repo" | "scope" | "decisions">,
  input: QuickInput,
) {
  await getDigitalInterview(deps, {
    orgId: input.orgId,
    viewerUserId: input.actorId,
    interviewId: input.interviewId,
  });
  const stored = await deps.repo.loadQuick(input.orgId, input.interviewId);
  if (!stored) throw new NoInterviewAccessError(input.interviewId);
  return presentQuick(stored);
}

export async function appendQuick(
  deps: QuickDeps,
  input: QuickInput & { text: string; expectedVersion: number },
) {
  const current = await getQuick(deps, input);
  const stored = await deps.repo.loadQuick(input.orgId, input.interviewId);
  if (!stored) throw new NoInterviewAccessError(input.interviewId);

  const snapshot = await deps.agents.resolvePublished(input.orgId, current.expert.expertId);
  if (!snapshot) throw new DigitalInterviewDependencyUnavailableError();
  const skills = await deps.runs.readPinnedSkills(input.orgId, snapshot.skillVersionIds);
  if (skills.length !== snapshot.skillVersionIds.length) {
    throw new DigitalInterviewDependencyUnavailableError();
  }

  const material = await readMaterial(deps, input, stored.expert.materialContextPackId);

  let reply: { readonly text: string };
  try {
    reply = await deps.model.complete({
      modelProvider: snapshot.modelProvider,
      modelId: snapshot.modelId,
      system: appendMaterial(buildSystemPrompt(snapshot.instructions, skills), material),
      user: input.text,
      history: current.messages.map((message) => ({
        role: message.role,
        content: message.text,
      })),
    });
  } catch (error) {
    if (error instanceof ModelCallError) {
      throw new DigitalInterviewDependencyUnavailableError();
    }
    throw error;
  }


  // The model call is an async boundary. Re-authorize both the interview and its Context Pack
  // immediately before persistence; a revoked operation must leave no answer behind.
  try {
    await getQuick(deps, input);
    await readMaterial(deps, input, stored.expert.materialContextPackId);
  } catch (error) {
    if (error instanceof NoInterviewAccessError || error instanceof DigitalInterviewDependencyUnavailableError) {
      throw new DigitalInterviewPermissionRevokedMidwayError();
    }
    throw error;
  }

  const sourcePointers = material
    ? material.items.map(item => `context-pack:${material.runId}#segment:${item.segmentId}@${item.artifactVersionId}`)
    : [`agent-version:${snapshot.agentVersionId}`];
  try {
    await deps.repo.appendQuickExchange({
      orgId: input.orgId,
      interviewId: input.interviewId,
      expectedVersion: input.expectedVersion,
      userMessageId: deps.ids.next("itv-msg"),
      assistantMessageId: deps.ids.next("itv-msg"),
      question: input.text,
      answer: reply.text,
      sourcePointers,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "CONCURRENT_MODIFICATION") {
      throw new DigitalInterviewConcurrentModificationError(input.interviewId);
    }
    throw error;
  }
  return getQuick(deps, input);
}

async function readMaterial(
  deps: QuickDeps,
  input: QuickInput,
  runId: string | null,
): Promise<DigitalExpertContextMaterial | null> {
  if (!runId) return null;
  const material = await deps.context.read({ orgId: input.orgId, actorId: input.actorId, runId });
  if (!material) throw new DigitalInterviewDependencyUnavailableError();
  return material;
}

function appendMaterial(system: string, material: DigitalExpertContextMaterial | null): string {
  if (!material) return system;
  const body = material.items.map(item => `[${item.segmentId}] ${item.content}`).join("\n");
  return `${system}\n\n以下是经 Context Pack API 授权的访谈材料；仅据此材料回答：\n${body}`;
}

export async function convertQuick(
  deps: QuickDeps,
  input: QuickInput & {
    expectedVersion: number;
    name: string;
    tags: readonly string[];
    topic: string;
  },
) {
  const parsed = interview.DigitalInterviewDraftInput.safeParse({
    name: input.name,
    tags: input.tags,
    topic: input.topic,
  });
  if (!parsed.success) throw new DigitalInterviewInputInvalidError();
  await getQuick(deps, input);

  try {
    const converted = await deps.repo.convertQuick({
      orgId: input.orgId,
      sourceInterviewId: input.interviewId,
      interviewId: deps.ids.next("itv"),
      actorId: input.actorId,
      expectedVersion: input.expectedVersion,
      ...parsed.data,
    });
    return interview.ConvertedDigitalInterview.parse({
      interviewId: converted.interviewId,
      name: converted.name,
      tags: converted.tags,
      topic: converted.topic,
      status: converted.status,
      sourceQuickInterviewId: converted.sourceQuickInterviewId,
      selectedExpertIds: converted.selectedExpertIds,
      reportId: converted.reportId,
      version: converted.version,
      sourceMaterials: converted.sourceMaterials,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "CONCURRENT_MODIFICATION") {
      throw new DigitalInterviewConcurrentModificationError(input.interviewId);
    }
    throw error;
  }
}
