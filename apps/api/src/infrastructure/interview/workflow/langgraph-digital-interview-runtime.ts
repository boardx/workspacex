import type { RunnableConfig } from "@langchain/core/runnables";
import { Command, type BaseCheckpointSaver } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import pg from "pg";
import type { interview } from "@repo/contracts";
import type { z } from "zod";
import type { ModelCallPort } from "../../../application/agent-run/ports";
import { ModelCallError } from "../../../application/agent-run/ports";
import type { IdFactory } from "../../../application/artifact/ports";
import type { DigitalInterviewRepository } from "../../../application/interview/digital-interview-ports";
import type { DigitalInterviewEffects } from "../../../application/interview/workflow/digital-interview-effects.port";
import {
  DigitalInterviewWorkflowError,
  type DigitalInterviewRuntime,
  type DigitalInterviewWorkflowView,
} from "../../../application/interview/workflow/digital-interview-runtime.port";
import {
  initialDigitalInterviewState,
  type DigitalInterviewCommand,
} from "../../../application/interview/workflow/digital-interview-state";
import { createDigitalInterviewGraph } from "../../../application/interview/workflow/digital-interview-graph";
import type { DecisionIdFactory } from "../../../application/identity/ports";
import type { InterviewScopeRepository } from "../../../application/interview/ports";
import { getDigitalInterview } from "../../../application/interview/get-digital-interview";
import { NoInterviewAccessError } from "../../../application/interview/errors";
import type { OrgId } from "../../../domain/org-id";
import type { PgConfig } from "../../db/pg-config";

const CHECKPOINT_NS = "digital-interview:v1";

export function createDigitalInterviewCheckpointer(config: PgConfig): PostgresSaver {
  return new PostgresSaver(new pg.Pool({ ...config, max: 5 }), undefined, { schema: "langgraph_interview" });
}

export interface DigitalInterviewRuntimeDeps {
  readonly effects: DigitalInterviewEffects;
  readonly checkpointer: BaseCheckpointSaver;
  readonly repo: DigitalInterviewRepository;
  readonly scope: InterviewScopeRepository;
  readonly decisions: DecisionIdFactory;
  readonly ids: IdFactory;
  readonly model: ModelCallPort;
  readonly skillModelProvider: string;
  readonly skillModelId: string;
}

function checkpointConfig(interviewId: string): RunnableConfig {
  return { configurable: { thread_id: interviewId, checkpoint_ns: CHECKPOINT_NS } };
}

function proposalPatch(text: string): Readonly<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Readonly<Record<string, unknown>>;
    }
  } catch {
    // A provider may return prose even when asked for JSON. Persist the suggestion as data;
    // never discard a durable assistant reply merely because its optional patch is unstructured.
  }
  return { suggestion: text };
}

export class LangGraphDigitalInterviewRuntime implements DigitalInterviewRuntime {
  private readonly graph;

  constructor(private readonly deps: DigitalInterviewRuntimeDeps) {
    this.graph = createDigitalInterviewGraph({ effects: deps.effects, checkpointer: deps.checkpointer });
  }

  async onModuleDestroy(): Promise<void> {
    const checkpointer = this.deps.checkpointer as BaseCheckpointSaver & { end?: () => Promise<void> };
    await checkpointer.end?.();
  }

  async createDraft(input: {
    readonly orgId: OrgId; readonly actorId: string; readonly name: string; readonly tags: readonly string[];
    readonly scope: z.infer<typeof interview.InterviewScope>; readonly requestId: string;
  }): Promise<DigitalInterviewWorkflowView> {
    await this.assertOrgMember(input.orgId, input.actorId);
    const replay = await this.deps.effects.findReceipt({
      orgId: input.orgId,
      operationName: "create_draft",
      requestId: input.requestId,
      payload: { name: input.name, tags: input.tags, scope: input.scope },
    });
    if (replay) {
      await this.ensureGraphStarted(replay, input.orgId, input.actorId);
      return replay;
    }

    const workflow = await this.deps.effects.createDraft({
      ...input,
      interviewId: this.deps.ids.next("itv"),
      revisionId: this.deps.ids.next("itv-revision"),
      skillThreadId: this.deps.ids.next("itv-skill-thread"),
    });
    await this.ensureGraphStarted(workflow, input.orgId, input.actorId);
    return workflow;
  }

  private async ensureGraphStarted(workflow: DigitalInterviewWorkflowView, orgId: OrgId, actorId: string): Promise<void> {
    await this.authorize(orgId, actorId, workflow.interviewId);
    const config = checkpointConfig(workflow.interviewId);
    const state = await this.graph.getState(config);
    if ((state.values as Partial<{ interviewId: string }>).interviewId === workflow.interviewId) return;
    await this.graph.invoke(initialDigitalInterviewState({
      interviewId: workflow.interviewId,
      orgId,
      actorId,
      revisionId: workflow.revisionId,
      revisionNumber: 1,
      skillThreadId: workflow.skillThreadId,
    }), config);
  }

  async get(input: { readonly orgId: OrgId; readonly actorId: string; readonly interviewId: string }): Promise<DigitalInterviewWorkflowView> {
    return this.authorize(input.orgId, input.actorId, input.interviewId);
  }

  async confirmTopic(input: {
    readonly orgId: OrgId; readonly actorId: string; readonly interviewId: string; readonly topic: string;
    readonly expectedVersion: number; readonly requestId: string;
  }): Promise<DigitalInterviewWorkflowView> {
    return this.resumeConfirmation(input, { kind: "confirm_topic", topic: input.topic,
      expectedVersion: input.expectedVersion, requestId: input.requestId });
  }

  async confirmExperts(input: {
    readonly orgId: OrgId; readonly actorId: string; readonly interviewId: string; readonly expertIds: readonly string[];
    readonly expectedVersion: number; readonly requestId: string;
  }): Promise<DigitalInterviewWorkflowView> {
    await this.assertExpertsVisible(input.orgId, input.actorId, input.expertIds);
    return this.resumeConfirmation(input, { kind: "confirm_experts", expertIds: input.expertIds,
      expectedVersion: input.expectedVersion, requestId: input.requestId });
  }

  async confirmQuestions(input: {
    readonly orgId: OrgId; readonly actorId: string; readonly interviewId: string;
    readonly questions: readonly z.infer<typeof interview.DigitalInterviewQuestion>[];
    readonly expectedVersion: number; readonly requestId: string;
  }): Promise<DigitalInterviewWorkflowView> {
    return this.resumeConfirmation(input, { kind: "confirm_questions", questions: input.questions,
      expectedVersion: input.expectedVersion, requestId: input.requestId });
  }

  async appendSkillMessage(input: {
    readonly orgId: OrgId; readonly actorId: string; readonly interviewId: string;
    readonly currentStep: z.infer<typeof interview.DigitalInterviewStep>; readonly text: string;
    readonly expectedVersion: number; readonly requestId: string;
  }): Promise<DigitalInterviewWorkflowView> {
    const current = await this.authorize(input.orgId, input.actorId, input.interviewId);
    const replay = await this.deps.effects.findReceipt({
      orgId: input.orgId,
      operationName: "append_skill_message",
      requestId: input.requestId,
      payload: { currentStep: input.currentStep, text: input.text, expectedVersion: input.expectedVersion },
    });
    if (replay) return replay;
    if (!this.deps.skillModelProvider || !this.deps.skillModelId) {
      throw new DigitalInterviewWorkflowError("DEPENDENCY_UNAVAILABLE");
    }

    let completion: { readonly text: string };
    try {
      completion = await this.deps.model.complete({
        modelProvider: this.deps.skillModelProvider,
        modelId: this.deps.skillModelId,
        system: "你是数字专家访谈设计 Skill。只返回一个 JSON object，表示对当前步骤草稿的建议 patch。",
        user: `当前步骤: ${input.currentStep}\n用户请求: ${input.text}`,
        history: current.skillMessages.map((message) => ({ role: message.role, content: message.text })),
      });
    } catch (error) {
      if (error instanceof ModelCallError) throw new DigitalInterviewWorkflowError("DEPENDENCY_UNAVAILABLE");
      throw error;
    }

    // The model boundary is an authorization boundary. Recheck after the response and once
    // more immediately before the transaction so a revoked user leaves no assistant message.
    await this.recheckAfterModel(input.orgId, input.actorId, input.interviewId);
    await this.recheckAfterModel(input.orgId, input.actorId, input.interviewId);
    return this.deps.effects.appendSkillMessage({
      ...input,
      assistantText: completion.text,
      proposalPatch: proposalPatch(completion.text),
      userMessageId: this.deps.ids.next("itv-skill-message"),
      assistantMessageId: this.deps.ids.next("itv-skill-message"),
      proposalId: this.deps.ids.next("itv-skill-proposal"),
    });
  }

  async applySkillProposal(input: {
    readonly orgId: OrgId; readonly actorId: string; readonly interviewId: string; readonly proposalId: string;
    readonly expectedVersion: number; readonly requestId: string;
  }): Promise<DigitalInterviewWorkflowView> {
    await this.authorize(input.orgId, input.actorId, input.interviewId);
    return this.deps.effects.setSkillProposalStatus({ ...input, status: "applied_to_draft" });
  }

  async rejectSkillProposal(input: {
    readonly orgId: OrgId; readonly actorId: string; readonly interviewId: string; readonly proposalId: string;
    readonly expectedVersion: number; readonly requestId: string;
  }): Promise<DigitalInterviewWorkflowView> {
    await this.authorize(input.orgId, input.actorId, input.interviewId);
    return this.deps.effects.setSkillProposalStatus({ ...input, status: "rejected" });
  }

  private async resumeConfirmation(
    input: { readonly orgId: OrgId; readonly actorId: string; readonly interviewId: string },
    command: Exclude<DigitalInterviewCommand, { readonly kind: "skill_refine" }>,
  ): Promise<DigitalInterviewWorkflowView> {
    const current = await this.authorize(input.orgId, input.actorId, input.interviewId);
    const operationName = command.kind;
    const config = checkpointConfig(input.interviewId);
    const replay = await this.deps.effects.findReceipt({
      orgId: input.orgId, operationName, requestId: command.requestId, payload: command,
    });
    const state = await this.graph.getState(config);
    const expectedNode = command.kind;
    if (replay && !state.next.includes(expectedNode)) return replay;
    if (!state.next.includes(expectedNode)) {
      if (current.version !== command.expectedVersion) {
        throw new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION");
      }
      throw new DigitalInterviewWorkflowError("DIGITAL_INTERVIEW_STEP_INVALID");
    }

    // The authorization above occurs directly before checkpoint load/resume. The effect is
    // receipt-first, so a crash after its business commit but before the next checkpoint is safe.
    await this.graph.invoke(new Command({ resume: command }), config);
    const stored = await this.deps.effects.findReceipt({
      orgId: input.orgId, operationName, requestId: command.requestId, payload: command,
    });
    if (!stored) throw new DigitalInterviewWorkflowError("DEPENDENCY_UNAVAILABLE");
    return stored;
  }

  private async authorize(orgId: OrgId, actorId: string, interviewId: string): Promise<DigitalInterviewWorkflowView> {
    try {
      await getDigitalInterview(
        { repo: this.deps.repo, scope: this.deps.scope, decisions: this.deps.decisions },
        { orgId, viewerUserId: actorId, interviewId },
      );
    } catch (error) {
      if (error instanceof NoInterviewAccessError) throw new DigitalInterviewWorkflowError("NO_INTERVIEW_ACCESS");
      throw error;
    }
    const workflow = await this.deps.repo.loadWorkflow(orgId, interviewId);
    if (!workflow) throw new DigitalInterviewWorkflowError("NO_INTERVIEW_ACCESS");
    return workflow;
  }

  private async recheckAfterModel(orgId: OrgId, actorId: string, interviewId: string): Promise<void> {
    try {
      await this.authorize(orgId, actorId, interviewId);
    } catch (error) {
      if (error instanceof DigitalInterviewWorkflowError && error.code === "NO_INTERVIEW_ACCESS") {
        throw new DigitalInterviewWorkflowError("PERMISSION_REVOKED_MIDWAY");
      }
      throw error;
    }
  }

  private async assertOrgMember(orgId: OrgId, actorId: string): Promise<void> {
    const membership = await this.deps.scope.orgMembershipOf(orgId, actorId);
    if (!membership.orgRole) throw new DigitalInterviewWorkflowError("NO_INTERVIEW_ACCESS");
  }

  private async assertExpertsVisible(orgId: OrgId, actorId: string, expertIds: readonly string[]): Promise<void> {
    const visible = await this.deps.repo.listVisibleExperts({ orgId, viewerUserId: actorId });
    const ids = new Set(visible.map((expert) => expert.expertId));
    if (expertIds.some((expertId) => !ids.has(expertId))) {
      throw new DigitalInterviewWorkflowError("NO_INTERVIEW_ACCESS");
    }
  }
}
