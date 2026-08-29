import { createHash } from "node:crypto";
import type { IdFactory } from "../../../application/artifact/ports";
import { ModelCallError, type ModelCallPort } from "../../../application/agent-run/ports";
import type {
  CommitDigitalInterviewStepInput,
  CommitDigitalInterviewStepResult,
  DigitalInterviewEffects,
  GenerateDigitalInterviewDraftInput,
} from "../../../application/interview/workflow/digital-interview-effects.port";
import type { DigitalInterviewRepository } from "../../../application/interview/digital-interview-ports";
import {
  DigitalInterviewWorkflowError,
  type DigitalInterviewWorkflowView,
} from "../../../application/interview/workflow/digital-interview-runtime.port";
import type { DatabasePort, TenantSession } from "../../../application/ports/database.port";
import { guard, type Guarded } from "../../../application/security/permission-filter";
import { scopeIsCoherent } from "../../../domain/interview/scope";
import { toOrgId, type OrgId } from "../../../domain/org-id";
import { readDigitalInterviewWorkflow } from "../pg-digital-interview-repository";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

function payloadDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function guardWorkflow(workflow: DigitalInterviewWorkflowView): Guarded<DigitalInterviewWorkflowView> {
  return guard({ kind: "interview", id: workflow.interviewId }, workflow);
}

interface ReceiptRow {
  payload_digest: string;
  response_body: DigitalInterviewWorkflowView;
}

interface LockedInterviewRow {
  version: string;
  digital_status: string;
  revision_id: string;
  revision_number: number;
}

interface GeneratedInterviewExpert {
  readonly displayName: string;
  readonly role: string;
  readonly domains: readonly string[];
}

function parseGeneratedInterviewExperts(text: string): readonly GeneratedInterviewExpert[] {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text.trim());
  const parsed = JSON.parse(fenced?.[1]?.trim() ?? text) as { experts?: unknown };
  if (!Array.isArray(parsed.experts)) throw new SyntaxError("experts must be an array");
  const experts = parsed.experts.flatMap((value): GeneratedInterviewExpert[] => {
    if (value === null || typeof value !== "object") return [];
    const candidate = value as Record<string, unknown>;
    const displayName = typeof candidate.displayName === "string" ? candidate.displayName.trim() : "";
    const role = typeof candidate.role === "string" ? candidate.role.trim() : "";
    const domains = Array.isArray(candidate.domains)
      ? Array.from(new Set(candidate.domains.filter((domain): domain is string => typeof domain === "string").map((domain) => domain.trim()).filter(Boolean)))
      : [];
    return displayName && role && domains.length ? [{ displayName, role, domains }] : [];
  });
  if (experts.length < 3 || experts.length > 5) throw new SyntaxError("experts must contain 3 to 5 valid entries");
  return experts;
}

function initialsFor(displayName: string): string {
  const compact = displayName.replace(/\s+/g, "");
  return Array.from(compact).slice(0, 2).join("").toUpperCase();
}

const EXPECTED_STATUS = {
  confirm_topic: "topic_pending",
  confirm_experts: "experts_pending",
  confirm_questions: "questions_pending",
} as const;

const RECONFIRMABLE_STATUS = {
  confirm_topic: new Set(["experts_pending", "questions_pending", "running", "report_pending", "completed"]),
  confirm_experts: new Set(["questions_pending", "running", "report_pending", "completed"]),
  confirm_questions: new Set(["running", "report_pending", "completed"]),
} as const;

export class PgDigitalInterviewEffects implements DigitalInterviewEffects {
  constructor(
    private readonly db: DatabasePort,
    private readonly ids: IdFactory,
    private readonly repo: DigitalInterviewRepository,
    private readonly model: ModelCallPort,
    private readonly modelProvider: string,
    private readonly modelId: string,
  ) {}

  async findReceipt(input: {
    readonly orgId: OrgId; readonly interviewId: string | null;
    readonly operationName: string; readonly requestId: string; readonly payload: unknown;
  }): Promise<Guarded<DigitalInterviewWorkflowView> | null> {
    return this.db.withTenant(input.orgId, async (session) => {
      const receipt = await this.readReceipt(
        session, input.orgId, input.interviewId, input.operationName, input.requestId,
      );
      if (!receipt) return null;
      this.assertMatchingReceipt(receipt, input.payload);
      return guardWorkflow(receipt.response_body);
    });
  }

  async createDraft(input: {
    readonly orgId: OrgId; readonly actorId: string; readonly interviewId: string;
    readonly revisionId: string; readonly skillThreadId: string;
    readonly scope: { readonly kind: "none" | "project" | "research"; readonly projectId: string | null; readonly researchProjectId: string | null };
    readonly name: string; readonly tags: readonly string[]; readonly requestId: string;
  }): Promise<Guarded<DigitalInterviewWorkflowView>> {
    if (!scopeIsCoherent(input.scope)) throw new DigitalInterviewWorkflowError("DIGITAL_INTERVIEW_INPUT_INVALID");
    const payload = { name: input.name, tags: input.tags, scope: input.scope };
    return this.db.withTenant(input.orgId, async (session) => {
      await this.lockRequest(session, input.orgId, null, "create_draft", input.requestId);
      const receipt = await this.readReceipt(session, input.orgId, null, "create_draft", input.requestId);
      if (receipt) {
        this.assertMatchingReceipt(receipt, payload);
        return guardWorkflow(receipt.response_body);
      }
      const membership = await session.query<{ allowed: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM org_memberships WHERE org_id=$1 AND user_id=$2
         ) AS allowed`,
        [input.orgId, input.actorId],
      );
      if (!membership.rows[0]?.allowed) {
        throw new DigitalInterviewWorkflowError("PERMISSION_REVOKED_MIDWAY");
      }
      await session.query(
        `INSERT INTO interview_sessions
           (id, org_id, project_id, research_project_id, source_kind, title, created_by, tags,
            topic, digital_status, selected_expert_ids, version)
         VALUES ($1,$2,$3,$4,'virtual',$5,$6,$7,NULL,'topic_pending','{}',1)`,
        [
          input.interviewId,
          input.orgId,
          input.scope.projectId,
          input.scope.researchProjectId,
          input.name,
          input.actorId,
          [...input.tags],
        ],
      );
      await session.query(
        `INSERT INTO digital_interview_revisions
           (org_id,id,interview_id,revision_number,is_current,created_by)
         VALUES ($1,$2,$3,1,true,$4)`,
        [input.orgId, input.revisionId, input.interviewId, input.actorId],
      );
      await session.query(
        `INSERT INTO digital_interview_skill_threads(org_id,id,interview_id,created_by)
         VALUES ($1,$2,$3,$4)`,
        [input.orgId, input.skillThreadId, input.interviewId, input.actorId],
      );
      const workflow = await this.requireWorkflow(session, input.orgId, input.interviewId);
      await this.writeReceipt(session, {
        orgId: input.orgId,
        interviewId: input.interviewId,
        operationId: `${input.interviewId}:create_draft:1:${input.requestId}`,
        operationName: "create_draft",
        requestId: input.requestId,
        payload,
        workflow,
      });
      return guardWorkflow(workflow);
    });
  }

  async commitStep(input: CommitDigitalInterviewStepInput): Promise<CommitDigitalInterviewStepResult> {
    const payload = input.command;
    const committed = await this.db.withTenant(toOrgId(input.orgId), async (session) => {
      await this.lockRequest(
        session, toOrgId(input.orgId), input.interviewId, input.nodeName, input.command.requestId,
      );
      const replay = await this.readReceipt(
        session, toOrgId(input.orgId), input.interviewId, input.nodeName, input.command.requestId,
      );
      if (replay) {
        this.assertMatchingReceipt(replay, payload);
        const revision = await session.query<{ revision_number: number }>(
          "SELECT revision_number FROM digital_interview_revisions WHERE org_id=$1 AND id=$2",
          [input.orgId, replay.response_body.revisionId],
        );
        return {
          workflow: replay.response_body,
          revisionNumber: revision.rows[0]?.revision_number ?? input.revisionNumber,
        };
      }
      const current = await this.lockInterview(
        session, toOrgId(input.orgId), input.interviewId, input.actorId,
      );
      if (Number(current.version) !== input.command.expectedVersion) {
        throw new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION");
      }
      if (current.revision_id !== input.revisionId || current.revision_number !== input.revisionNumber) {
        throw new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION");
      }

      let activeRevisionId = input.revisionId;
      let activeRevisionNumber = input.revisionNumber;
      const expectedStatus = EXPECTED_STATUS[input.nodeName];
      if (current.digital_status !== expectedStatus) {
        if (!RECONFIRMABLE_STATUS[input.nodeName].has(current.digital_status)) {
          throw new DigitalInterviewWorkflowError("DIGITAL_INTERVIEW_STEP_INVALID");
        }
        const branched = await this.branchRevision(session, input, current);
        activeRevisionId = branched.revisionId;
        activeRevisionNumber = branched.revisionNumber;
      }

      let committedVersionId: string;
      let nextStatus: "experts_pending" | "questions_pending" | "running";
      if (input.nodeName === "confirm_topic" && input.command.kind === "confirm_topic") {
        committedVersionId = this.ids.next("itv-topic");
        await session.query(
          `UPDATE digital_interview_topic_versions SET is_current=false
            WHERE org_id=$1 AND revision_id=$2 AND is_current`,
          [input.orgId, activeRevisionId],
        );
        await session.query(
          `INSERT INTO digital_interview_topic_versions
             (org_id,id,interview_id,revision_id,version_number,topic,is_current,created_by)
           VALUES ($1,$2,$3,$4,1,$5,true,$6)`,
          [input.orgId, committedVersionId, input.interviewId, activeRevisionId, input.command.topic, input.actorId],
        );
        await session.query(
          `UPDATE interview_sessions
              SET topic=$3,digital_status='experts_pending',selected_expert_ids='{}',report_id=NULL,
                  version=version+1,updated_at=now()
            WHERE org_id=$1 AND id=$2`,
          [input.orgId, input.interviewId, input.command.topic],
        );
        nextStatus = "experts_pending";
      } else if (input.nodeName === "confirm_experts" && input.command.kind === "confirm_experts") {
        const candidateIds = await session.query<{ expert_id: string }>(
          `SELECT expert_id
             FROM digital_interview_expert_candidates
            WHERE org_id=$1 AND revision_id=$2 AND expert_id=ANY($3::text[])`,
          [input.orgId, activeRevisionId, [...input.command.expertIds]],
        );
        if (candidateIds.rows.length !== input.command.expertIds.length) {
          throw new DigitalInterviewWorkflowError("DIGITAL_INTERVIEW_STEP_INVALID");
        }
        committedVersionId = this.ids.next("itv-experts");
        await session.query(
          `UPDATE digital_interview_expert_snapshot_versions SET is_current=false
            WHERE org_id=$1 AND revision_id=$2 AND is_current`,
          [input.orgId, activeRevisionId],
        );
        await session.query(
          `INSERT INTO digital_interview_expert_snapshot_versions
             (org_id,id,interview_id,revision_id,version_number,is_current,created_by)
           VALUES ($1,$2,$3,$4,1,true,$5)`,
          [input.orgId, committedVersionId, input.interviewId, activeRevisionId, input.actorId],
        );
        for (const [index, expertId] of input.command.expertIds.entries()) {
          await session.query(
            `INSERT INTO digital_interview_expert_snapshots
               (org_id,version_id,expert_id,agent_definition_id,agent_version,ordinal,
                initials,display_name,role,domains,material_context_pack_id,material_version)
             SELECT org_id,$2,expert_id,agent_definition_id,agent_version,$4,
                    initials,display_name,role,domains,material_context_pack_id,material_version
               FROM digital_interview_expert_candidates
              WHERE org_id=$1 AND revision_id=$3 AND expert_id=$5`,
            [input.orgId, committedVersionId, activeRevisionId, index + 1, expertId],
          );
        }
        await session.query(
          `UPDATE interview_sessions
              SET selected_expert_ids=$3,digital_status='questions_pending',report_id=NULL,
                  version=version+1,updated_at=now()
            WHERE org_id=$1 AND id=$2`,
          [input.orgId, input.interviewId, [...input.command.expertIds]],
        );
        nextStatus = "questions_pending";
      } else if (input.nodeName === "confirm_questions" && input.command.kind === "confirm_questions") {
        await this.assertQuestionsCoverExperts(session, toOrgId(input.orgId), input.interviewId, input.command.questions);
        const expertVersion = await session.query<{ id: string }>(
          `SELECT id FROM digital_interview_expert_snapshot_versions
            WHERE org_id=$1 AND revision_id=$2 AND is_current`,
          [input.orgId, activeRevisionId],
        );
        if (!expertVersion.rows[0]) throw new DigitalInterviewWorkflowError("DIGITAL_INTERVIEW_STEP_INVALID");
        committedVersionId = this.ids.next("itv-questions");
        await session.query(
          `UPDATE digital_interview_question_versions SET is_current=false
            WHERE org_id=$1 AND revision_id=$2 AND is_current`,
          [input.orgId, activeRevisionId],
        );
        await session.query(
          `INSERT INTO digital_interview_question_versions
             (org_id,id,interview_id,revision_id,expert_snapshot_version_id,version_number,is_current,created_by)
           VALUES ($1,$2,$3,$4,$5,1,true,$6)`,
          [input.orgId, committedVersionId, input.interviewId, activeRevisionId, expertVersion.rows[0].id, input.actorId],
        );
        for (const question of input.command.questions) {
          await session.query(
            `INSERT INTO digital_interview_questions
               (org_id,version_id,question_id,expert_id,ordinal,body,purpose)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [input.orgId, committedVersionId, question.questionId, question.expertId, question.order, question.text, question.purpose],
          );
        }
        await session.query(
          "DELETE FROM digital_interview_question_candidates WHERE org_id=$1 AND revision_id=$2",
          [input.orgId, activeRevisionId],
        );
        for (const question of input.command.questions) {
          await session.query(
            `INSERT INTO digital_interview_question_candidates
               (org_id,revision_id,question_id,expert_id,ordinal,body,purpose)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [input.orgId, activeRevisionId, question.questionId, question.expertId,
              question.order, question.text, question.purpose],
          );
        }
        await session.query(
          `UPDATE interview_sessions SET digital_status='running',report_id=NULL,version=version+1,updated_at=now()
            WHERE org_id=$1 AND id=$2`,
          [input.orgId, input.interviewId],
        );
        nextStatus = "running";
      } else {
        throw new DigitalInterviewWorkflowError("DIGITAL_INTERVIEW_STEP_INVALID");
      }

      await this.finishStepProposals(
        session, toOrgId(input.orgId), activeRevisionId, input.nodeName,
        input.command, committedVersionId,
      );
      const updated = await this.requireWorkflow(session, toOrgId(input.orgId), input.interviewId);
      if (updated.status !== nextStatus) throw new DigitalInterviewWorkflowError("DEPENDENCY_UNAVAILABLE");
      await this.writeReceipt(session, {
        orgId: toOrgId(input.orgId), interviewId: input.interviewId, operationId: input.operationId,
        operationName: input.nodeName, requestId: input.command.requestId, payload, workflow: updated,
      });
      return { workflow: updated, revisionNumber: activeRevisionNumber };
    });
    const workflow = committed.workflow;
    return {
      interviewId: workflow.interviewId,
      revisionId: workflow.revisionId,
      revisionNumber: committed.revisionNumber,
      currentStep: workflow.currentStep,
      topicVersionId: workflow.topicVersionId,
      expertSnapshotVersionId: workflow.expertSnapshotVersionId,
      questionVersionId: workflow.questionVersionId,
      skillThreadId: workflow.skillThreadId,
      operationId: input.operationId,
      requestId: input.command.requestId,
      aggregateVersion: workflow.version,
    };
  }

  async generateExpertCandidates(input: GenerateDigitalInterviewDraftInput): Promise<void> {
    const payload = { expectedVersion: input.expectedVersion };
    const replayed = await this.db.withTenant(toOrgId(input.orgId), async (session) => {
      const replay = await this.readReceipt(
        session, toOrgId(input.orgId), input.interviewId, "generate_expert_candidates", input.requestId,
      );
      if (!replay) return false;
      this.assertMatchingReceipt(replay, payload);
      return true;
    });
    if (replayed) return;
    const topic = await this.db.withTenant(toOrgId(input.orgId), async (session) => {
      const result = await session.query<{ topic: string | null }>(
        "SELECT topic FROM interview_sessions WHERE org_id=$1 AND id=$2",
        [input.orgId, input.interviewId],
      );
      return result.rows[0]?.topic?.trim() ?? "";
    });
    if (!topic) throw new DigitalInterviewWorkflowError("DIGITAL_INTERVIEW_INPUT_INVALID");
    if (!this.modelProvider || !this.modelId) throw new DigitalInterviewWorkflowError("AI_GENERATION_UNAVAILABLE");
    let experts: readonly GeneratedInterviewExpert[];
    try {
      const response = await this.model.complete({
        modelProvider: this.modelProvider,
        modelId: this.modelId,
        system: "你是访谈研究助手。根据访谈主题直接创建 3 至 5 位视角互补的虚拟专家，而不是从已有专家列表选择。只返回 JSON：{\"experts\":[{\"displayName\":\"姓名或称谓\",\"role\":\"具体身份与观察视角\",\"domains\":[\"专业领域\"]}]}。",
        user: JSON.stringify({ operation: "generate_interview_experts", topic }),
      });
      experts = parseGeneratedInterviewExperts(response.text);
    } catch (error) {
      if (!(error instanceof ModelCallError || error instanceof SyntaxError)) throw error;
      throw new DigitalInterviewWorkflowError("AI_GENERATION_UNAVAILABLE");
    }
    await this.db.withTenant(toOrgId(input.orgId), async (session) => {
      await this.lockRequest(
        session, toOrgId(input.orgId), input.interviewId, "generate_expert_candidates", input.requestId,
      );
      const replay = await this.readReceipt(
        session, toOrgId(input.orgId), input.interviewId, "generate_expert_candidates", input.requestId,
      );
      if (replay) { this.assertMatchingReceipt(replay, payload); return; }
      const current = await this.lockInterview(session, toOrgId(input.orgId), input.interviewId, input.actorId);
      if (Number(current.version) !== input.expectedVersion || current.revision_id !== input.revisionId) {
        throw new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION");
      }
      await session.query(
        "DELETE FROM digital_interview_expert_candidates WHERE org_id=$1 AND revision_id=$2",
        [input.orgId, input.revisionId],
      );
      const generatedExpertIds: string[] = [];
      for (const [index, expert] of experts.entries()) {
        const expertId = this.ids.next("itv-generated-expert");
        generatedExpertIds.push(expertId);
        await session.query(
          `INSERT INTO digital_interview_expert_candidates
             (org_id,revision_id,expert_id,agent_definition_id,agent_version,ordinal,initials,display_name,role,domains,
              material_context_pack_id,material_version)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [input.orgId, input.revisionId, expertId, expertId,
            expertId, index + 1, initialsFor(expert.displayName),
            expert.displayName, expert.role, [...expert.domains], null, null],
        );
      }
      await session.query(
        "UPDATE interview_sessions SET selected_expert_ids=$3 WHERE org_id=$1 AND id=$2",
        [input.orgId, input.interviewId, generatedExpertIds],
      );
      const workflow = await this.requireWorkflow(session, toOrgId(input.orgId), input.interviewId);
      await this.writeReceipt(session, {
        orgId: toOrgId(input.orgId), interviewId: input.interviewId, operationId: input.operationId,
        operationName: "generate_expert_candidates", requestId: input.requestId, payload, workflow,
      });
      await this.refreshReceipt(
        session, toOrgId(input.orgId), input.interviewId, "confirm_topic", input.requestId, workflow,
      );
    });
  }

  async generateQuestions(input: GenerateDigitalInterviewDraftInput): Promise<void> {
    const payload = { expectedVersion: input.expectedVersion };
    await this.db.withTenant(toOrgId(input.orgId), async (session) => {
      await this.lockRequest(
        session, toOrgId(input.orgId), input.interviewId, "generate_questions", input.requestId,
      );
      const replay = await this.readReceipt(
        session, toOrgId(input.orgId), input.interviewId, "generate_questions", input.requestId,
      );
      if (replay) { this.assertMatchingReceipt(replay, payload); return; }
      const current = await this.lockInterview(session, toOrgId(input.orgId), input.interviewId, input.actorId);
      if (Number(current.version) !== input.expectedVersion || current.revision_id !== input.revisionId) {
        throw new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION");
      }
      const selected = await session.query<{
        expert_id: string; display_name: string; existing_question_count: string;
      }>(
        `SELECT c.expert_id,c.display_name,count(q.question_id)::text AS existing_question_count
           FROM digital_interview_expert_candidates c
           JOIN interview_sessions s ON s.org_id=c.org_id AND s.id=$3
           LEFT JOIN digital_interview_question_candidates q
             ON q.org_id=c.org_id AND q.revision_id=c.revision_id AND q.expert_id=c.expert_id
          WHERE c.org_id=$1 AND c.revision_id=$2 AND c.expert_id=ANY(s.selected_expert_ids)
          GROUP BY c.expert_id,c.display_name,c.ordinal
          ORDER BY c.ordinal`,
        [input.orgId, input.revisionId, input.interviewId],
      );
      await session.query(
        `DELETE FROM digital_interview_question_candidates q
          USING interview_sessions s
         WHERE q.org_id=$1 AND q.revision_id=$2 AND s.org_id=q.org_id AND s.id=$3
           AND NOT (q.expert_id=ANY(s.selected_expert_ids))`,
        [input.orgId, input.revisionId, input.interviewId],
      );
      const maximum = await session.query<{ ordinal: string }>(
        `SELECT COALESCE(max(ordinal),0)::text AS ordinal
           FROM digital_interview_question_candidates WHERE org_id=$1 AND revision_id=$2`,
        [input.orgId, input.revisionId],
      );
      let ordinal = Number(maximum.rows[0]?.ordinal ?? "0");
      for (const expert of selected.rows) {
        if (Number(expert.existing_question_count) > 0) continue;
        const defaults = [
          { text: `请描述${expert.display_name}参与的决策流程与关键节点。`, purpose: "梳理决策流程" },
          { text: `从${expert.display_name}视角，哪些风险会触发否决或暂停？`, purpose: "识别否决风险" },
          { text: `请提供${expert.display_name}支持上述判断的实际案例或依据。`, purpose: "追问案例依据" },
        ];
        for (const question of defaults) {
          ordinal += 1;
          await session.query(
            `INSERT INTO digital_interview_question_candidates
               (org_id,revision_id,question_id,expert_id,ordinal,body,purpose)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [input.orgId, input.revisionId, this.ids.next("itv-question-draft"), expert.expert_id,
              ordinal, question.text, question.purpose],
          );
        }
      }
      const workflow = await this.requireWorkflow(session, toOrgId(input.orgId), input.interviewId);
      await this.writeReceipt(session, {
        orgId: toOrgId(input.orgId), interviewId: input.interviewId, operationId: input.operationId,
        operationName: "generate_questions", requestId: input.requestId, payload, workflow,
      });
      await this.refreshReceipt(
        session, toOrgId(input.orgId), input.interviewId, "confirm_experts", input.requestId, workflow,
      );
    });
  }

  async appendSkillMessage(input: {
    readonly orgId: OrgId; readonly actorId: string; readonly interviewId: string;
    readonly currentStep: DigitalInterviewWorkflowView["currentStep"]; readonly text: string;
    readonly draftContext: unknown;
    readonly assistantText: string; readonly proposalPatch: Readonly<Record<string, unknown>>;
    readonly expectedVersion: number; readonly requestId: string;
    readonly userMessageId: string; readonly assistantMessageId: string; readonly proposalId: string;
  }): Promise<Guarded<DigitalInterviewWorkflowView>> {
    const payload = {
      currentStep: input.currentStep, text: input.text, draftContext: input.draftContext,
      expectedVersion: input.expectedVersion,
    };
    return this.db.withTenant(input.orgId, async (session) => {
      await this.lockRequest(session, input.orgId, input.interviewId, "append_skill_message", input.requestId);
      const replay = await this.readReceipt(
        session, input.orgId, input.interviewId, "append_skill_message", input.requestId,
      );
      if (replay) { this.assertMatchingReceipt(replay, payload); return guardWorkflow(replay.response_body); }
      const current = await this.lockInterview(session, input.orgId, input.interviewId, input.actorId);
      if (Number(current.version) !== input.expectedVersion) throw new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION");
      const workflowBefore = await this.requireWorkflow(session, input.orgId, input.interviewId);
      if (workflowBefore.currentStep !== input.currentStep) throw new DigitalInterviewWorkflowError("DIGITAL_INTERVIEW_STEP_INVALID");
      const ordinal = await session.query<{ next: string }>(
        `SELECT (COALESCE(max(ordinal),0)+1)::text AS next
           FROM digital_interview_skill_messages WHERE org_id=$1 AND skill_thread_id=$2`,
        [input.orgId, workflowBefore.skillThreadId],
      );
      const firstOrdinal = Number(ordinal.rows[0]?.next ?? "1");
      await session.query(
        `INSERT INTO digital_interview_skill_messages
           (org_id,id,skill_thread_id,ordinal,role,body)
         VALUES ($1,$2,$3,$4,'user',$5),($1,$6,$3,$7,'assistant',$8)`,
        [input.orgId, input.userMessageId, workflowBefore.skillThreadId, firstOrdinal, input.text,
          input.assistantMessageId, firstOrdinal + 1, input.assistantText],
      );
      await session.query(
        `INSERT INTO digital_interview_skill_proposals
           (org_id,id,skill_thread_id,source_message_id,target_step,base_revision_id,patch,status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'proposed')`,
        [input.orgId, input.proposalId, workflowBefore.skillThreadId, input.assistantMessageId,
          input.currentStep, workflowBefore.revisionId, input.proposalPatch],
      );
      await session.query(
        `UPDATE interview_sessions SET version=version+1,updated_at=now() WHERE org_id=$1 AND id=$2`,
        [input.orgId, input.interviewId],
      );
      const workflow = await this.requireWorkflow(session, input.orgId, input.interviewId);
      await this.writeReceipt(session, {
        orgId: input.orgId, interviewId: input.interviewId,
        operationId: `${input.interviewId}:append_skill_message:${current.revision_number}:${input.requestId}`,
        operationName: "append_skill_message", requestId: input.requestId, payload, workflow,
      });
      return guardWorkflow(workflow);
    });
  }

  async setSkillProposalStatus(input: {
    readonly orgId: OrgId; readonly actorId: string; readonly interviewId: string;
    readonly proposalId: string; readonly status: "applied_to_draft" | "rejected";
    readonly expectedVersion: number; readonly requestId: string;
  }): Promise<Guarded<DigitalInterviewWorkflowView>> {
    const operationName = input.status === "applied_to_draft" ? "apply_skill_proposal" : "reject_skill_proposal";
    const payload = { proposalId: input.proposalId, expectedVersion: input.expectedVersion };
    return this.db.withTenant(input.orgId, async (session) => {
      await this.lockRequest(session, input.orgId, input.interviewId, operationName, input.requestId);
      const replay = await this.readReceipt(
        session, input.orgId, input.interviewId, operationName, input.requestId,
      );
      if (replay) { this.assertMatchingReceipt(replay, payload); return guardWorkflow(replay.response_body); }
      const current = await this.lockInterview(session, input.orgId, input.interviewId, input.actorId);
      if (Number(current.version) !== input.expectedVersion) throw new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION");
      const changed = await session.query<{ id: string }>(
        `UPDATE digital_interview_skill_proposals p
            SET status=$4,
                applied_at=CASE WHEN $4='applied_to_draft' THEN now() ELSE NULL END,
                rejected_at=CASE WHEN $4='rejected' THEN now() ELSE NULL END
           FROM digital_interview_skill_threads st
          WHERE p.org_id=$1 AND p.id=$2 AND p.status='proposed'
            AND st.org_id=p.org_id AND st.id=p.skill_thread_id AND st.interview_id=$3
          RETURNING p.id`,
        [input.orgId, input.proposalId, input.interviewId, input.status],
      );
      if (!changed.rows[0]) throw new DigitalInterviewWorkflowError("DIGITAL_INTERVIEW_STEP_INVALID");
      await session.query(
        `UPDATE interview_sessions SET version=version+1,updated_at=now() WHERE org_id=$1 AND id=$2`,
        [input.orgId, input.interviewId],
      );
      const workflow = await this.requireWorkflow(session, input.orgId, input.interviewId);
      await this.writeReceipt(session, {
        orgId: input.orgId, interviewId: input.interviewId,
        operationId: `${input.interviewId}:${operationName}:${current.revision_number}:${input.requestId}`,
        operationName, requestId: input.requestId, payload, workflow,
      });
      return guardWorkflow(workflow);
    });
  }

  private async branchRevision(
    session: TenantSession,
    input: CommitDigitalInterviewStepInput,
    current: LockedInterviewRow,
  ): Promise<{ revisionId: string; revisionNumber: number }> {
    const previousTopic = await session.query<{ topic: string }>(
      `SELECT topic FROM digital_interview_topic_versions
        WHERE org_id=$1 AND revision_id=$2 AND is_current`,
      [input.orgId, current.revision_id],
    );
    const previousExperts = await session.query<{
      expert_id: string; agent_definition_id: string; agent_version: string; ordinal: number;
      initials: string; display_name: string; role: string; domains: string[];
      material_context_pack_id: string | null; material_version: string | null;
    }>(
      `SELECT s.expert_id,s.agent_definition_id,s.agent_version,s.ordinal,s.initials,
              s.display_name,s.role,s.domains,s.material_context_pack_id,s.material_version
         FROM digital_interview_expert_snapshots s
         JOIN digital_interview_expert_snapshot_versions v
           ON v.org_id=s.org_id AND v.id=s.version_id
        WHERE v.org_id=$1 AND v.revision_id=$2 AND v.is_current
        ORDER BY s.ordinal`,
      [input.orgId, current.revision_id],
    );
    const previousQuestions = await session.query<{
      question_id: string; expert_id: string; ordinal: number; body: string; purpose: string;
    }>(
      `SELECT q.question_id,q.expert_id,q.ordinal,q.body,q.purpose
         FROM digital_interview_questions q
         JOIN digital_interview_question_versions v
           ON v.org_id=q.org_id AND v.id=q.version_id
        WHERE v.org_id=$1 AND v.revision_id=$2 AND v.is_current
        ORDER BY q.ordinal`,
      [input.orgId, current.revision_id],
    );
    await session.query(
      `UPDATE digital_interview_revisions
          SET is_current=false,superseded_at=now()
        WHERE org_id=$1 AND id=$2 AND is_current`,
      [input.orgId, current.revision_id],
    );
    for (const table of [
      "digital_interview_topic_versions",
      "digital_interview_expert_snapshot_versions",
      "digital_interview_question_versions",
    ]) {
      await session.query(
        `UPDATE ${table} SET is_current=false WHERE org_id=$1 AND revision_id=$2 AND is_current`,
        [input.orgId, current.revision_id],
      );
    }
    await session.query(
      `UPDATE digital_interview_skill_proposals
          SET status='stale',applied_at=NULL,rejected_at=NULL,committed_version_id=NULL
        WHERE org_id=$1 AND base_revision_id=$2 AND status IN ('proposed','applied_to_draft')`,
      [input.orgId, current.revision_id],
    );

    const revisionId = this.ids.next("itv-revision");
    const revisionNumber = current.revision_number + 1;
    await session.query(
      `INSERT INTO digital_interview_revisions
         (org_id,id,interview_id,revision_number,is_current,created_by)
       VALUES ($1,$2,$3,$4,true,$5)`,
      [input.orgId, revisionId, input.interviewId, revisionNumber, input.actorId],
    );
    await session.query(
      `INSERT INTO digital_interview_expert_candidates
         (org_id,revision_id,expert_id,agent_definition_id,agent_version,ordinal,initials,display_name,role,domains,
          material_context_pack_id,material_version)
       SELECT org_id,$3,expert_id,agent_definition_id,agent_version,ordinal,initials,display_name,role,domains,
              material_context_pack_id,material_version
         FROM digital_interview_expert_candidates
        WHERE org_id=$1 AND revision_id=$2`,
      [input.orgId, current.revision_id, revisionId],
    );

    if (input.nodeName !== "confirm_topic") {
      const topic = previousTopic.rows[0]?.topic;
      if (!topic) throw new DigitalInterviewWorkflowError("DIGITAL_INTERVIEW_STEP_INVALID");
      await session.query(
        `INSERT INTO digital_interview_topic_versions
           (org_id,id,interview_id,revision_id,version_number,topic,is_current,created_by)
         VALUES ($1,$2,$3,$4,1,$5,true,$6)`,
        [input.orgId, this.ids.next("itv-topic"), input.interviewId, revisionId, topic, input.actorId],
      );
    }
    if (input.nodeName === "confirm_experts" && input.command.kind === "confirm_experts") {
      const retainedExpertIds = new Set(input.command.expertIds);
      let ordinal = 0;
      for (const question of previousQuestions.rows) {
        if (!retainedExpertIds.has(question.expert_id)) continue;
        ordinal += 1;
        await session.query(
          `INSERT INTO digital_interview_question_candidates
             (org_id,revision_id,question_id,expert_id,ordinal,body,purpose)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [input.orgId, revisionId, question.question_id, question.expert_id,
            ordinal, question.body, question.purpose],
        );
      }
    }
    if (input.nodeName === "confirm_questions") {
      if (previousExperts.rows.length === 0) {
        throw new DigitalInterviewWorkflowError("DIGITAL_INTERVIEW_STEP_INVALID");
      }
      const expertVersionId = this.ids.next("itv-experts");
      await session.query(
        `INSERT INTO digital_interview_expert_snapshot_versions
           (org_id,id,interview_id,revision_id,version_number,is_current,created_by)
         VALUES ($1,$2,$3,$4,1,true,$5)`,
        [input.orgId, expertVersionId, input.interviewId, revisionId, input.actorId],
      );
      for (const expert of previousExperts.rows) {
        await session.query(
          `INSERT INTO digital_interview_expert_snapshots
             (org_id,version_id,expert_id,agent_definition_id,agent_version,ordinal,
              initials,display_name,role,domains,material_context_pack_id,material_version)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [input.orgId, expertVersionId, expert.expert_id, expert.agent_definition_id,
            expert.agent_version, expert.ordinal, expert.initials, expert.display_name,
            expert.role, expert.domains, expert.material_context_pack_id, expert.material_version],
        );
      }
    }
    return { revisionId, revisionNumber };
  }

  private async finishStepProposals(
    session: TenantSession,
    orgId: OrgId,
    revisionId: string,
    nodeName: CommitDigitalInterviewStepInput["nodeName"],
    command: CommitDigitalInterviewStepInput["command"],
    committedVersionId: string,
  ): Promise<void> {
    const submittedPatch = command.kind === "confirm_topic"
      ? { topic: command.topic }
      : command.kind === "confirm_experts"
        ? { expertIds: command.expertIds }
        : { questions: command.questions };
    await session.query(
      `UPDATE digital_interview_skill_proposals
          SET status=CASE WHEN status='applied_to_draft' AND patch=$5::jsonb
                          THEN 'committed' ELSE 'stale' END,
              applied_at=CASE WHEN status='applied_to_draft' AND patch=$5::jsonb
                              THEN applied_at ELSE NULL END,
              rejected_at=NULL,
              committed_version_id=CASE WHEN status='applied_to_draft' AND patch=$5::jsonb
                                        THEN $4 ELSE NULL END
        WHERE org_id=$1 AND base_revision_id=$2 AND target_step=$3
          AND status IN ('proposed','applied_to_draft')`,
      [orgId, revisionId, nodeName.replace("confirm_", ""), committedVersionId, submittedPatch],
    );
  }

  private async lockInterview(
    session: TenantSession,
    orgId: OrgId,
    interviewId: string,
    actorId: string,
  ): Promise<LockedInterviewRow> {
    const result = await session.query<LockedInterviewRow>(
      `SELECT s.version, s.digital_status, r.id AS revision_id, r.revision_number
         FROM interview_sessions s
         JOIN digital_interview_revisions r
           ON r.org_id=s.org_id AND r.interview_id=s.id AND r.is_current
        WHERE s.org_id=$1 AND s.id=$2
          AND EXISTS (
            SELECT 1 FROM org_memberships om
             WHERE om.org_id=$1 AND om.user_id=$3
          )
          AND (
            s.created_by=$3
            OR EXISTS (
              SELECT 1 FROM interview_collaborators ic
               WHERE ic.org_id=$1 AND ic.interview_id=s.id AND ic.user_id=$3
            )
            OR (
              s.project_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM project_memberships pm
                 WHERE pm.org_id=$1 AND pm.project_id=s.project_id AND pm.user_id=$3
              )
            )
          )
        FOR UPDATE OF s`,
      [orgId, interviewId, actorId],
    );
    if (!result.rows[0]) throw new DigitalInterviewWorkflowError("PERMISSION_REVOKED_MIDWAY");
    return result.rows[0];
  }

  private async assertQuestionsCoverExperts(
    session: TenantSession,
    orgId: OrgId,
    interviewId: string,
    questions: readonly { readonly expertId: string }[],
  ): Promise<void> {
    const result = await session.query<{ selected_expert_ids: string[] }>(
      "SELECT selected_expert_ids FROM interview_sessions WHERE org_id=$1 AND id=$2",
      [orgId, interviewId],
    );
    const selected = result.rows[0]?.selected_expert_ids ?? [];
    const covered = new Set(questions.map((question) => question.expertId));
    if (covered.size !== selected.length || selected.some((expertId) => !covered.has(expertId))) {
      throw new DigitalInterviewWorkflowError("DIGITAL_INTERVIEW_STEP_INVALID");
    }
  }

  private async readReceipt(
    session: TenantSession,
    orgId: OrgId,
    interviewId: string | null,
    operationName: string,
    requestId: string,
  ): Promise<ReceiptRow | null> {
    const result = interviewId === null
      ? await session.query<ReceiptRow>(
        `SELECT payload_digest,response_body FROM digital_interview_step_receipts
          WHERE org_id=$1 AND operation_name=$2 AND request_id=$3`,
        [orgId, operationName, requestId],
      )
      : await session.query<ReceiptRow>(
        `SELECT payload_digest,response_body FROM digital_interview_step_receipts
          WHERE org_id=$1 AND interview_id=$2 AND operation_name=$3 AND request_id=$4`,
        [orgId, interviewId, operationName, requestId],
      );
    return result.rows[0] ?? null;
  }

  private async lockRequest(
    session: TenantSession,
    orgId: OrgId,
    interviewId: string | null,
    operationName: string,
    requestId: string,
  ): Promise<void> {
    await session.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [payloadDigest([orgId, interviewId, operationName, requestId])],
    );
  }

  private assertMatchingReceipt(receipt: ReceiptRow, payload: unknown): void {
    if (receipt.payload_digest !== payloadDigest(payload)) {
      throw new DigitalInterviewWorkflowError("IDEMPOTENCY_KEY_REUSED");
    }
  }

  private async writeReceipt(session: TenantSession, input: {
    readonly orgId: OrgId; readonly interviewId: string; readonly operationId: string;
    readonly operationName: string; readonly requestId: string; readonly payload: unknown;
    readonly workflow: DigitalInterviewWorkflowView;
  }): Promise<void> {
    await session.query(
      `INSERT INTO digital_interview_step_receipts
         (org_id,interview_id,operation_id,operation_name,request_id,payload_digest,http_status,response_body,response_version)
       VALUES ($1,$2,$3,$4,$5,$6,201,$7,$8)`,
      [input.orgId, input.interviewId, input.operationId, input.operationName, input.requestId,
        payloadDigest(input.payload), input.workflow, input.workflow.version],
    );
  }

  private async refreshReceipt(
    session: TenantSession,
    orgId: OrgId,
    interviewId: string,
    operationName: string,
    requestId: string,
    workflow: DigitalInterviewWorkflowView,
  ): Promise<void> {
    await session.query(
      `UPDATE digital_interview_step_receipts
          SET response_body=$5,response_version=$6
        WHERE org_id=$1 AND interview_id=$2 AND operation_name=$3 AND request_id=$4`,
      [orgId, interviewId, operationName, requestId, workflow, workflow.version],
    );
  }

  private async requireWorkflow(session: TenantSession, orgId: OrgId, interviewId: string): Promise<DigitalInterviewWorkflowView> {
    const workflow = await readDigitalInterviewWorkflow(session, orgId, interviewId);
    if (!workflow) throw new DigitalInterviewWorkflowError("NO_INTERVIEW_ACCESS");
    return workflow;
  }
}
