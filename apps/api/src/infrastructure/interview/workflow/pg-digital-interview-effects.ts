import { createHash } from "node:crypto";
import type { IdFactory } from "../../../application/artifact/ports";
import type {
  CommitDigitalInterviewStepInput,
  CommitDigitalInterviewStepResult,
  DigitalInterviewEffects,
} from "../../../application/interview/workflow/digital-interview-effects.port";
import {
  DigitalInterviewWorkflowError,
  type DigitalInterviewWorkflowView,
} from "../../../application/interview/workflow/digital-interview-runtime.port";
import type { DatabasePort, TenantSession } from "../../../application/ports/database.port";
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

export class PgDigitalInterviewEffects implements DigitalInterviewEffects {
  constructor(private readonly db: DatabasePort, private readonly ids: IdFactory) {}

  async findReceipt(input: {
    readonly orgId: OrgId; readonly operationName: string; readonly requestId: string; readonly payload: unknown;
  }): Promise<DigitalInterviewWorkflowView | null> {
    return this.db.withTenant(input.orgId, async (session) => {
      const receipt = await this.readReceipt(session, input.orgId, input.operationName, input.requestId);
      if (!receipt) return null;
      this.assertMatchingReceipt(receipt, input.payload);
      return receipt.response_body;
    });
  }

  async createDraft(input: {
    readonly orgId: OrgId; readonly actorId: string; readonly interviewId: string;
    readonly revisionId: string; readonly skillThreadId: string;
    readonly scope: { readonly kind: "none" | "project" | "research"; readonly projectId: string | null; readonly researchProjectId: string | null };
    readonly name: string; readonly tags: readonly string[]; readonly requestId: string;
  }): Promise<DigitalInterviewWorkflowView> {
    if (!scopeIsCoherent(input.scope)) throw new DigitalInterviewWorkflowError("DIGITAL_INTERVIEW_INPUT_INVALID");
    const payload = { name: input.name, tags: input.tags, scope: input.scope };
    return this.db.withTenant(input.orgId, async (session) => {
      await this.lockRequest(session, input.orgId, "create_draft", input.requestId);
      const receipt = await this.readReceipt(session, input.orgId, "create_draft", input.requestId);
      if (receipt) {
        this.assertMatchingReceipt(receipt, payload);
        return receipt.response_body;
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
      return workflow;
    });
  }

  async commitStep(input: CommitDigitalInterviewStepInput): Promise<CommitDigitalInterviewStepResult> {
    const payload = input.command;
    const workflow = await this.db.withTenant(toOrgId(input.orgId), async (session) => {
      await this.lockRequest(session, toOrgId(input.orgId), input.nodeName, input.command.requestId);
      const replay = await this.readReceipt(session, toOrgId(input.orgId), input.nodeName, input.command.requestId);
      if (replay) {
        this.assertMatchingReceipt(replay, payload);
        return replay.response_body;
      }
      const current = await this.lockInterview(session, toOrgId(input.orgId), input.interviewId);
      if (Number(current.version) !== input.command.expectedVersion) {
        throw new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION");
      }
      if (current.revision_id !== input.revisionId || current.revision_number !== input.revisionNumber) {
        throw new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION");
      }

      let committedVersionId: string;
      let nextStatus: "experts_pending" | "questions_pending" | "running";
      if (input.nodeName === "confirm_topic" && input.command.kind === "confirm_topic") {
        if (current.digital_status !== "topic_pending") throw new DigitalInterviewWorkflowError("DIGITAL_INTERVIEW_STEP_INVALID");
        committedVersionId = this.ids.next("itv-topic");
        await session.query(
          `UPDATE digital_interview_topic_versions SET is_current=false
            WHERE org_id=$1 AND revision_id=$2 AND is_current`,
          [input.orgId, input.revisionId],
        );
        await session.query(
          `INSERT INTO digital_interview_topic_versions
             (org_id,id,interview_id,revision_id,version_number,topic,is_current,created_by)
           VALUES ($1,$2,$3,$4,1,$5,true,$6)`,
          [input.orgId, committedVersionId, input.interviewId, input.revisionId, input.command.topic, input.actorId],
        );
        await session.query(
          `UPDATE interview_sessions SET topic=$3,digital_status='experts_pending',version=version+1,updated_at=now()
            WHERE org_id=$1 AND id=$2`,
          [input.orgId, input.interviewId, input.command.topic],
        );
        nextStatus = "experts_pending";
      } else if (input.nodeName === "confirm_experts" && input.command.kind === "confirm_experts") {
        if (current.digital_status !== "experts_pending") throw new DigitalInterviewWorkflowError("DIGITAL_INTERVIEW_STEP_INVALID");
        committedVersionId = this.ids.next("itv-experts");
        await session.query(
          `UPDATE digital_interview_expert_snapshot_versions SET is_current=false
            WHERE org_id=$1 AND revision_id=$2 AND is_current`,
          [input.orgId, input.revisionId],
        );
        await session.query(
          `INSERT INTO digital_interview_expert_snapshot_versions
             (org_id,id,interview_id,revision_id,version_number,is_current,created_by)
           VALUES ($1,$2,$3,$4,1,true,$5)`,
          [input.orgId, committedVersionId, input.interviewId, input.revisionId, input.actorId],
        );
        for (const [index, expertId] of input.command.expertIds.entries()) {
          await session.query(
            `INSERT INTO digital_interview_expert_snapshots(org_id,version_id,expert_id,ordinal)
             VALUES ($1,$2,$3,$4)`,
            [input.orgId, committedVersionId, expertId, index + 1],
          );
        }
        await session.query(
          `UPDATE interview_sessions
              SET selected_expert_ids=$3,digital_status='questions_pending',version=version+1,updated_at=now()
            WHERE org_id=$1 AND id=$2`,
          [input.orgId, input.interviewId, [...input.command.expertIds]],
        );
        nextStatus = "questions_pending";
      } else if (input.nodeName === "confirm_questions" && input.command.kind === "confirm_questions") {
        if (current.digital_status !== "questions_pending") throw new DigitalInterviewWorkflowError("DIGITAL_INTERVIEW_STEP_INVALID");
        await this.assertQuestionsCoverExperts(session, toOrgId(input.orgId), input.interviewId, input.command.questions);
        const expertVersion = await session.query<{ id: string }>(
          `SELECT id FROM digital_interview_expert_snapshot_versions
            WHERE org_id=$1 AND revision_id=$2 AND is_current`,
          [input.orgId, input.revisionId],
        );
        if (!expertVersion.rows[0]) throw new DigitalInterviewWorkflowError("DIGITAL_INTERVIEW_STEP_INVALID");
        committedVersionId = this.ids.next("itv-questions");
        await session.query(
          `UPDATE digital_interview_question_versions SET is_current=false
            WHERE org_id=$1 AND revision_id=$2 AND is_current`,
          [input.orgId, input.revisionId],
        );
        await session.query(
          `INSERT INTO digital_interview_question_versions
             (org_id,id,interview_id,revision_id,expert_snapshot_version_id,version_number,is_current,created_by)
           VALUES ($1,$2,$3,$4,$5,1,true,$6)`,
          [input.orgId, committedVersionId, input.interviewId, input.revisionId, expertVersion.rows[0].id, input.actorId],
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
          `UPDATE interview_sessions SET digital_status='running',version=version+1,updated_at=now()
            WHERE org_id=$1 AND id=$2`,
          [input.orgId, input.interviewId],
        );
        nextStatus = "running";
      } else {
        throw new DigitalInterviewWorkflowError("DIGITAL_INTERVIEW_STEP_INVALID");
      }

      await session.query(
        `UPDATE digital_interview_skill_proposals
            SET status='committed', committed_version_id=$4
          WHERE org_id=$1 AND base_revision_id=$2 AND target_step=$3
            AND status='applied_to_draft'`,
        [input.orgId, input.revisionId, input.nodeName.replace("confirm_", ""), committedVersionId],
      );
      const updated = await this.requireWorkflow(session, toOrgId(input.orgId), input.interviewId);
      if (updated.status !== nextStatus) throw new DigitalInterviewWorkflowError("DEPENDENCY_UNAVAILABLE");
      await this.writeReceipt(session, {
        orgId: toOrgId(input.orgId), interviewId: input.interviewId, operationId: input.operationId,
        operationName: input.nodeName, requestId: input.command.requestId, payload, workflow: updated,
      });
      return updated;
    });
    return {
      interviewId: workflow.interviewId,
      revisionId: workflow.revisionId,
      revisionNumber: input.revisionNumber,
      currentStep: workflow.currentStep,
      topicVersionId: workflow.topicVersionId,
      expertSnapshotVersionId: workflow.expertSnapshotVersionId,
      questionVersionId: workflow.questionVersionId,
      skillThreadId: workflow.skillThreadId,
      operationId: input.operationId,
    };
  }

  async appendSkillMessage(input: {
    readonly orgId: OrgId; readonly actorId: string; readonly interviewId: string;
    readonly currentStep: DigitalInterviewWorkflowView["currentStep"]; readonly text: string;
    readonly assistantText: string; readonly proposalPatch: Readonly<Record<string, unknown>>;
    readonly expectedVersion: number; readonly requestId: string;
    readonly userMessageId: string; readonly assistantMessageId: string; readonly proposalId: string;
  }): Promise<DigitalInterviewWorkflowView> {
    const payload = { currentStep: input.currentStep, text: input.text, expectedVersion: input.expectedVersion };
    return this.db.withTenant(input.orgId, async (session) => {
      await this.lockRequest(session, input.orgId, "append_skill_message", input.requestId);
      const replay = await this.readReceipt(session, input.orgId, "append_skill_message", input.requestId);
      if (replay) { this.assertMatchingReceipt(replay, payload); return replay.response_body; }
      const current = await this.lockInterview(session, input.orgId, input.interviewId);
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
      return workflow;
    });
  }

  async setSkillProposalStatus(input: {
    readonly orgId: OrgId; readonly actorId: string; readonly interviewId: string;
    readonly proposalId: string; readonly status: "applied_to_draft" | "rejected";
    readonly expectedVersion: number; readonly requestId: string;
  }): Promise<DigitalInterviewWorkflowView> {
    const operationName = input.status === "applied_to_draft" ? "apply_skill_proposal" : "reject_skill_proposal";
    const payload = { proposalId: input.proposalId, expectedVersion: input.expectedVersion };
    return this.db.withTenant(input.orgId, async (session) => {
      await this.lockRequest(session, input.orgId, operationName, input.requestId);
      const replay = await this.readReceipt(session, input.orgId, operationName, input.requestId);
      if (replay) { this.assertMatchingReceipt(replay, payload); return replay.response_body; }
      const current = await this.lockInterview(session, input.orgId, input.interviewId);
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
      return workflow;
    });
  }

  private async lockInterview(session: TenantSession, orgId: OrgId, interviewId: string): Promise<LockedInterviewRow> {
    const result = await session.query<LockedInterviewRow>(
      `SELECT s.version, s.digital_status, r.id AS revision_id, r.revision_number
         FROM interview_sessions s
         JOIN digital_interview_revisions r
           ON r.org_id=s.org_id AND r.interview_id=s.id AND r.is_current
        WHERE s.org_id=$1 AND s.id=$2
        FOR UPDATE OF s`,
      [orgId, interviewId],
    );
    if (!result.rows[0]) throw new DigitalInterviewWorkflowError("NO_INTERVIEW_ACCESS");
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
    operationName: string,
    requestId: string,
  ): Promise<ReceiptRow | null> {
    const result = await session.query<ReceiptRow>(
      `SELECT payload_digest,response_body FROM digital_interview_step_receipts
        WHERE org_id=$1 AND operation_name=$2 AND request_id=$3`,
      [orgId, operationName, requestId],
    );
    return result.rows[0] ?? null;
  }

  private async lockRequest(
    session: TenantSession,
    orgId: OrgId,
    operationName: string,
    requestId: string,
  ): Promise<void> {
    await session.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`${orgId}\u0000${operationName}\u0000${requestId}`],
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

  private async requireWorkflow(session: TenantSession, orgId: OrgId, interviewId: string): Promise<DigitalInterviewWorkflowView> {
    const workflow = await readDigitalInterviewWorkflow(session, orgId, interviewId);
    if (!workflow) throw new DigitalInterviewWorkflowError("NO_INTERVIEW_ACCESS");
    return workflow;
  }
}
