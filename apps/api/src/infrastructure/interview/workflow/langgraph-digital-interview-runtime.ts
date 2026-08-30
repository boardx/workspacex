import type { RunnableConfig } from "@langchain/core/runnables";
import {
  BaseCheckpointSaver,
  Command,
  type Checkpoint,
  type CheckpointMetadata,
  type CheckpointTuple,
} from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import pg from "pg";
import { interview } from "@repo/contracts";
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
import { authorizeDigitalInterview } from "../../../application/interview/get-digital-interview";
import { NoInterviewAccessError } from "../../../application/interview/errors";
import {
  discloseDecided,
  isDisclosed,
  type Guarded,
} from "../../../application/security/permission-filter";
import type { PermissionDecision } from "../../../domain/identity/permission-decision";
import type { OrgId } from "../../../domain/org-id";
import type { PgConfig } from "../../db/pg-config";

const CHECKPOINT_NS = "digital-interview:v1";

function storedCheckpointConfig(config: RunnableConfig, checkpointNamespace: string): RunnableConfig {
  return {
    ...config,
    configurable: { ...config.configurable, checkpoint_ns: checkpointNamespace },
  };
}

function runtimeCheckpointConfig(config: RunnableConfig): RunnableConfig {
  return {
    ...config,
    configurable: { ...config.configurable, checkpoint_ns: "" },
  };
}

/**
 * LangGraph reserves non-empty namespaces for subgraphs and clears a root graph namespace
 * before calling its saver. Keep the runtime root namespace empty while pinning all durable
 * storage operations to the signed digital-interview namespace.
 */
export class FixedNamespaceCheckpointSaver extends BaseCheckpointSaver {
  constructor(
    private readonly delegate: BaseCheckpointSaver,
    private readonly checkpointNamespace: string,
  ) {
    super(delegate.serde);
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const tuple = await this.delegate.getTuple(storedCheckpointConfig(config, this.checkpointNamespace));
    if (!tuple) return undefined;
    return {
      ...tuple,
      config: runtimeCheckpointConfig(tuple.config),
      parentConfig: tuple.parentConfig ? runtimeCheckpointConfig(tuple.parentConfig) : undefined,
    };
  }

  async *list(
    config: RunnableConfig,
    options?: Parameters<BaseCheckpointSaver["list"]>[1],
  ): AsyncGenerator<CheckpointTuple> {
    const storedOptions = options?.before
      ? { ...options, before: storedCheckpointConfig(options.before, this.checkpointNamespace) }
      : options;
    for await (const tuple of this.delegate.list(
      storedCheckpointConfig(config, this.checkpointNamespace), storedOptions,
    )) {
      yield {
        ...tuple,
        config: runtimeCheckpointConfig(tuple.config),
        parentConfig: tuple.parentConfig ? runtimeCheckpointConfig(tuple.parentConfig) : undefined,
      };
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    newVersions: Parameters<BaseCheckpointSaver["put"]>[3],
  ): Promise<RunnableConfig> {
    const stored = await this.delegate.put(
      storedCheckpointConfig(config, this.checkpointNamespace), checkpoint, metadata, newVersions,
    );
    return runtimeCheckpointConfig(stored);
  }

  async putWrites(
    config: RunnableConfig,
    writes: Parameters<BaseCheckpointSaver["putWrites"]>[1],
    taskId: string,
  ): Promise<void> {
    await this.delegate.putWrites(
      storedCheckpointConfig(config, this.checkpointNamespace), writes, taskId,
    );
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.delegate.deleteThread(threadId);
  }

  async end(): Promise<void> {
    const delegate = this.delegate as BaseCheckpointSaver & { end?: () => Promise<void> };
    await delegate.end?.();
  }
}

export function withCheckpointNamespace(
  checkpointer: BaseCheckpointSaver,
  checkpointNamespace: string,
): FixedNamespaceCheckpointSaver {
  return new FixedNamespaceCheckpointSaver(checkpointer, checkpointNamespace);
}

export function createDigitalInterviewCheckpointer(config: PgConfig): FixedNamespaceCheckpointSaver {
  const saver = new PostgresSaver(
    new pg.Pool({ ...config, max: 5 }), undefined, { schema: "langgraph_interview" },
  );
  return withCheckpointNamespace(saver, CHECKPOINT_NS);
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
  return { configurable: { thread_id: interviewId } };
}

const STEP_ORDER: Readonly<Record<z.infer<typeof interview.DigitalInterviewStep>, number>> = {
  topic: 0, experts: 1, questions: 2, runs: 3, report: 4,
};

interface AuthorizedWorkflow {
  readonly workflow: DigitalInterviewWorkflowView;
  readonly decision: PermissionDecision;
}

function proposalPatch(
  text: string,
  step: z.infer<typeof interview.DigitalInterviewStep>,
): z.infer<typeof interview.DigitalInterviewSkillPatch> {
  try {
    const parsed = JSON.parse(text) as unknown;
    const validated = interview.DigitalInterviewSkillPatch.safeParse(parsed);
    if (validated.success) {
      const matchesStep =
        (step === "topic" && "topic" in validated.data)
        || (step === "experts" && "expertIds" in validated.data)
        || (step === "questions" && "questions" in validated.data)
        || ((step === "runs" || step === "report") && "instruction" in validated.data);
      if (matchesStep) return validated.data;
    }
  } catch {
    // Handled below as a dependency response that cannot satisfy the signed patch contract.
  }
  throw new DigitalInterviewWorkflowError("DEPENDENCY_UNAVAILABLE");
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
    const guardedReplay = await this.deps.effects.findReceipt({
      orgId: input.orgId,
      interviewId: null,
      operationName: "create_draft",
      requestId: input.requestId,
      payload: { name: input.name, tags: input.tags, scope: input.scope },
    });
    if (guardedReplay) {
      const authorized = await this.authorize(input.orgId, input.actorId, guardedReplay.ref.id);
      const replay = this.discloseWorkflow(guardedReplay, authorized.decision);
      await this.ensureGraphStarted(replay, input.orgId, input.actorId);
      return replay;
    }

    const guardedWorkflow = await this.deps.effects.createDraft({
      ...input,
      interviewId: this.deps.ids.next("itv"),
      revisionId: this.deps.ids.next("itv-revision"),
      skillThreadId: this.deps.ids.next("itv-skill-thread"),
    });
    const authorized = await this.authorize(input.orgId, input.actorId, guardedWorkflow.ref.id);
    const workflow = this.discloseWorkflow(guardedWorkflow, authorized.decision);
    await this.ensureGraphStarted(workflow, input.orgId, input.actorId);
    return workflow;
  }

  private async ensureGraphStarted(workflow: DigitalInterviewWorkflowView, orgId: OrgId, actorId: string): Promise<void> {
    await this.authorize(orgId, actorId, workflow.interviewId);
    const config = checkpointConfig(workflow.interviewId);
    const checkpoint = await this.deps.checkpointer.getTuple(config);
    if (checkpoint) return;
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
    return (await this.authorize(input.orgId, input.actorId, input.interviewId)).workflow;
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
    const confirmed = await this.resumeConfirmation(input, { kind: "confirm_questions", questions: input.questions,
      expectedVersion: input.expectedVersion, requestId: input.requestId });
    await this.deps.effects.executeInterviewRuns({
      orgId: input.orgId, actorId: input.actorId, interviewId: input.interviewId,
      revisionId: confirmed.revisionId,
    });
    return (await this.authorize(input.orgId, input.actorId, input.interviewId)).workflow;
  }

  async appendSkillMessage(input: {
    readonly orgId: OrgId; readonly actorId: string; readonly interviewId: string;
    readonly currentStep: z.infer<typeof interview.DigitalInterviewStep>; readonly text: string;
    readonly draftContext: z.infer<typeof interview.DigitalInterviewSkillDraftContext>;
    readonly expectedVersion: number; readonly requestId: string;
  }): Promise<DigitalInterviewWorkflowView> {
    const current = await this.authorize(input.orgId, input.actorId, input.interviewId);
    const guardedReplay = await this.deps.effects.findReceipt({
      orgId: input.orgId,
      interviewId: input.interviewId,
      operationName: "append_skill_message",
      requestId: input.requestId,
      payload: {
        currentStep: input.currentStep, text: input.text, draftContext: input.draftContext,
        expectedVersion: input.expectedVersion,
      },
    });
    if (guardedReplay) return this.discloseWorkflow(guardedReplay, current.decision);
    if (!this.deps.skillModelProvider || !this.deps.skillModelId) {
      throw new DigitalInterviewWorkflowError("DEPENDENCY_UNAVAILABLE");
    }

    let completion: { readonly text: string };
    try {
      completion = await this.deps.model.complete({
        modelProvider: this.deps.skillModelProvider,
        modelId: this.deps.skillModelId,
        system: "你是数字专家访谈设计 Skill。只返回符合当前步骤严格 schema 的 JSON patch，不得修改其他步骤。",
        user: JSON.stringify({
          currentStep: input.currentStep,
          confirmedWorkflow: {
            name: current.workflow.name, tags: current.workflow.tags,
            scope: current.workflow.scope, topic: current.workflow.topic,
            selectedExpertIds: current.workflow.selectedExpertIds, questions: current.workflow.questions,
            revisionId: current.workflow.revisionId, version: current.workflow.version,
          },
          currentDraft: input.draftContext,
          request: input.text,
        }),
        history: current.workflow.skillMessages.map((message) => ({ role: message.role, content: message.text })),
      });
    } catch (error) {
      if (error instanceof ModelCallError) throw new DigitalInterviewWorkflowError("DEPENDENCY_UNAVAILABLE");
      throw error;
    }

    // The model boundary is an authorization boundary. The final check is performed again by
    // the effect in the same transaction that locks and mutates the interview.
    const rechecked = await this.recheckAfterModel(input.orgId, input.actorId, input.interviewId);
    const guardedWorkflow = await this.deps.effects.appendSkillMessage({
      ...input,
      assistantText: completion.text,
      proposalPatch: proposalPatch(completion.text, input.currentStep),
      userMessageId: this.deps.ids.next("itv-skill-message"),
      assistantMessageId: this.deps.ids.next("itv-skill-message"),
      proposalId: this.deps.ids.next("itv-skill-proposal"),
    });
    return this.discloseWorkflow(guardedWorkflow, rechecked.decision);
  }

  async applySkillProposal(input: {
    readonly orgId: OrgId; readonly actorId: string; readonly interviewId: string; readonly proposalId: string;
    readonly expectedVersion: number; readonly requestId: string;
  }): Promise<DigitalInterviewWorkflowView> {
    const authorized = await this.authorize(input.orgId, input.actorId, input.interviewId);
    const workflow = await this.deps.effects.setSkillProposalStatus({ ...input, status: "applied_to_draft" });
    return this.discloseWorkflow(workflow, authorized.decision);
  }

  async rejectSkillProposal(input: {
    readonly orgId: OrgId; readonly actorId: string; readonly interviewId: string; readonly proposalId: string;
    readonly expectedVersion: number; readonly requestId: string;
  }): Promise<DigitalInterviewWorkflowView> {
    const authorized = await this.authorize(input.orgId, input.actorId, input.interviewId);
    const workflow = await this.deps.effects.setSkillProposalStatus({ ...input, status: "rejected" });
    return this.discloseWorkflow(workflow, authorized.decision);
  }

  private async resumeConfirmation(
    input: { readonly orgId: OrgId; readonly actorId: string; readonly interviewId: string },
    command: Exclude<DigitalInterviewCommand, { readonly kind: "skill_refine" }>,
  ): Promise<DigitalInterviewWorkflowView> {
    const current = await this.authorize(input.orgId, input.actorId, input.interviewId);
    const operationName = command.kind;
    const config = checkpointConfig(input.interviewId);
    const guardedReplay = await this.deps.effects.findReceipt({
      orgId: input.orgId, interviewId: input.interviewId,
      operationName, requestId: command.requestId, payload: command,
    });
    const replay = guardedReplay ? this.discloseWorkflow(guardedReplay, current.decision) : null;
    const expectedNode = command.kind;
    const generationOperation = command.kind === "confirm_topic"
      ? "generate_expert_candidates"
      : command.kind === "confirm_experts"
        ? "generate_questions"
        : null;
    let generatedReplay: DigitalInterviewWorkflowView | null = null;
    if (replay && generationOperation !== null) {
      const guardedGeneratedReplay = await this.deps.effects.findReceipt({
        orgId: input.orgId, interviewId: input.interviewId, operationName: generationOperation,
        requestId: command.requestId, payload: { expectedVersion: replay.version },
      });
      generatedReplay = guardedGeneratedReplay
        ? this.discloseWorkflow(guardedGeneratedReplay, current.decision)
        : null;
    } else if (replay) {
      const snapshot = await this.graph.getState(config);
      if (snapshot.next.includes(expectedNode)) {
        await this.graph.invoke(new Command({ update: { actorId: input.actorId }, resume: command }), config);
      } else if (snapshot.next.length !== 0) {
        throw new DigitalInterviewWorkflowError("DEPENDENCY_UNAVAILABLE");
      }
      return replay;
    }
    if (!replay) {
      if (current.workflow.version !== command.expectedVersion) {
        throw new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION");
      }
      const targetStep = command.kind.replace("confirm_", "") as "topic" | "experts" | "questions";
      if (targetStep !== current.workflow.currentStep) {
        if (STEP_ORDER[targetStep] >= STEP_ORDER[current.workflow.currentStep]) {
          throw new DigitalInterviewWorkflowError("DIGITAL_INTERVIEW_STEP_INVALID");
        }
        // Fork the durable checkpoint from the routing node. A Command.goto from a paused
        // downstream interrupt adds work beside that pending task; updateState supersedes the
        // old pending interrupt and lets the graph derive exactly one new confirmation task.
        await this.graph.updateState(
          config,
          { currentStep: targetStep, actorId: input.actorId },
          "route",
        );
      }
    } else {
      const snapshot = await this.graph.getState(config);
      if (snapshot.next.includes(expectedNode)) {
        await this.graph.invoke(new Command({ update: { actorId: input.actorId }, resume: command }), config);
      } else if (generationOperation !== null && snapshot.next.includes(generationOperation)) {
        await this.graph.invoke(new Command({ update: { actorId: input.actorId } }), config);
      } else if (generatedReplay) {
        return generatedReplay;
      } else {
        throw new DigitalInterviewWorkflowError("DEPENDENCY_UNAVAILABLE");
      }
    }

    // The authorization above occurs directly before checkpoint load/resume. The effect is
    // receipt-first, so a crash after its business commit but before the next checkpoint is safe.
    if (!replay) {
      await this.graph.invoke(new Command({ update: { actorId: input.actorId }, resume: command }), config);
    }
    if (generationOperation !== null) {
      const guardedGenerated = await this.deps.effects.findReceipt({
        orgId: input.orgId, interviewId: input.interviewId, operationName: generationOperation,
        requestId: command.requestId, payload: { expectedVersion: command.expectedVersion + 1 },
      });
      if (!guardedGenerated) throw new DigitalInterviewWorkflowError("DEPENDENCY_UNAVAILABLE");
      this.discloseWorkflow(guardedGenerated, current.decision);
    }
    const guardedStored = await this.deps.effects.findReceipt({
      orgId: input.orgId, interviewId: input.interviewId,
      operationName, requestId: command.requestId, payload: command,
    });
    if (!guardedStored) throw new DigitalInterviewWorkflowError("DEPENDENCY_UNAVAILABLE");
    return this.discloseWorkflow(guardedStored, current.decision);
  }

  private async authorize(orgId: OrgId, actorId: string, interviewId: string): Promise<AuthorizedWorkflow> {
    try {
      const authorized = await authorizeDigitalInterview(
        { repo: this.deps.repo, scope: this.deps.scope, decisions: this.deps.decisions },
        { orgId, viewerUserId: actorId, interviewId },
      );
      const guardedWorkflow = await this.deps.repo.loadWorkflow(orgId, interviewId);
      if (!guardedWorkflow) throw new DigitalInterviewWorkflowError("NO_INTERVIEW_ACCESS");
      return {
        workflow: this.discloseWorkflow(guardedWorkflow, authorized.decision),
        decision: authorized.decision,
      };
    } catch (error) {
      if (error instanceof NoInterviewAccessError) throw new DigitalInterviewWorkflowError("NO_INTERVIEW_ACCESS");
      throw error;
    }
  }

  private discloseWorkflow(
    workflow: Guarded<DigitalInterviewWorkflowView>,
    decision: PermissionDecision,
  ): DigitalInterviewWorkflowView {
    const disclosed = discloseDecided(workflow, decision);
    if (!isDisclosed(disclosed)) throw new DigitalInterviewWorkflowError("NO_INTERVIEW_ACCESS");
    return disclosed.payload;
  }

  private async recheckAfterModel(orgId: OrgId, actorId: string, interviewId: string): Promise<AuthorizedWorkflow> {
    try {
      return await this.authorize(orgId, actorId, interviewId);
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
