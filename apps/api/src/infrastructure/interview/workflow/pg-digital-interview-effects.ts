import { createHash } from "node:crypto";
import type { IdFactory } from "../../../application/artifact/ports";
import { ModelCallError, type ModelCallPort } from "../../../application/agent-run/ports";
import type {
  ConfirmationNodeName,
  CommitDigitalInterviewStepInput,
  CommitDigitalInterviewStepResult,
  DigitalInterviewEffects,
  GenerateDigitalInterviewDraftInput,
} from "../../../application/interview/workflow/digital-interview-effects.port";
import {
  buildDigitalInterviewReportSystemPrompt,
  DIGITAL_REPORT_REQUIRED_HEADINGS,
  DigitalReportNdjsonDecoder,
  type ParsedDigitalReportStreamEvent,
} from "../../../application/interview/workflow/digital-report-stream";
import type { DigitalInterviewRepository } from "../../../application/interview/digital-interview-ports";
import {
  DigitalInterviewWorkflowError,
  type DigitalInterviewWorkflowView,
} from "../../../application/interview/workflow/digital-interview-runtime.port";
import type { DatabasePort, TenantSession } from "../../../application/ports/database.port";
import { guard, type Guarded } from "../../../application/security/permission-filter";
import { scopeIsCoherent } from "../../../domain/interview/scope";
import { assertFindingSources, deriveApprovalEligibility } from "../../../domain/interview/digital-report-evidence";
import { canApproveReport } from "../../../domain/interview/research-quality";
import { toOrgId, type OrgId } from "../../../domain/org-id";
import { readDigitalInterviewWorkflow } from "../pg-digital-interview-repository";

import { DIGITAL_REPORT_STALE_SQL } from "./digital-report-lease";
import { completeInterviewRunAnswers, InvalidInterviewAnswersError } from "./interview-run-answers";

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

const DIGITAL_INTERVIEW_ACTOR_VISIBILITY = `
  EXISTS (
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
  )`;

interface GeneratedInterviewExpert {
  readonly displayName: string;
  readonly role: string;
  readonly domains: readonly string[];
  readonly category: string;
  readonly bio: string;
  readonly location: string;
  readonly typicalAdvice: string;
  readonly age: number;
  readonly occupation: string;
  readonly goals: readonly string[];
  readonly interests: readonly string[];
  readonly painPoints: readonly string[];
  readonly motivations: readonly string[];
  readonly influences: readonly string[];
  readonly personalityTraits: { readonly introvertExtrovert: number; readonly analyticalCreative: number; readonly busyTimeRich: number };
  readonly serviceValue: string;
}

interface InterviewQuestionExpertProfile extends GeneratedInterviewExpert {
  readonly expertId: string;
  readonly displayName: string;
  readonly existingQuestionCount: number;
}

interface GeneratedInterviewQuestion {
  readonly text: string;
  readonly purpose: string;
}

interface ReportSourceAnswer {
  readonly expertId: string;
  readonly displayName: string;
  readonly questionId: string;
  readonly question: string;
  readonly answer: string;
}

function excerpt(value: string, max = 120): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

function stripMarkdownHeadings(value: string): string {
  return value
    .split("\n")
    .filter((line) => !/^#{1,6}\s+/.test(line.trim()))
    .join("\n")
    .trim();
}

function buildFallbackReportMarkdown(input: {
  readonly topic: string;
  readonly answers: readonly ReportSourceAnswer[];
  readonly sections: readonly string[];
  readonly findings: readonly { readonly title: string; readonly summary: string; readonly expertId: string; readonly questionId: string }[];
}): string {
  const sourceById = new Map(input.answers.map((answer) => [`${answer.expertId}:${answer.questionId}`, answer]));
  const findings = input.findings.length > 0
    ? input.findings
    : input.answers.slice(0, 3).map((answer, index) => ({
      title: `关键发现 ${index + 1}`,
      summary: `${answer.displayName}围绕“${answer.question}”指出：“${excerpt(answer.answer)}”。该回答为当前判断提供直接证据，仍需真人访谈或业务数据复核。`,
      expertId: answer.expertId,
      questionId: answer.questionId,
    }));
  const sourceLines = input.answers.map((answer, index) => `${index + 1}. ${answer.displayName}｜${answer.question}\n   > ${excerpt(answer.answer, 180)}`);
  const streamedMarkdown = input.sections.map((section) => section.trim()).filter(Boolean).join("\n\n");
  const generatedNarrativeText = input.sections
    .map(stripMarkdownHeadings)
    .filter(Boolean)
    .join("\n\n");
  const roleLines = input.answers.map((answer) => {
    return `- ${answer.displayName}：在“${answer.question}”中回答“${excerpt(answer.answer, 140)}”。`;
  });
  const findingLines = findings.map((finding, index) => {
    const source = sourceById.get(`${finding.expertId}:${finding.questionId}`);
    const sourceLabel = source ? `${source.displayName}｜${source.question}` : `${finding.expertId}:${finding.questionId}`;
    return `${index + 1}. **${finding.title}**：${finding.summary}\n   证据：${sourceLabel}`;
  });
  const distinctExpertCount = new Set(input.answers.map((answer) => answer.expertId)).size;
  const formalAppendix = [
    "## 研究方法",
    `本报告围绕“${input.topic}”整理数字专家模拟访谈结果。样本为 ${input.answers.length} 条已完成回答，来自 ${distinctExpertCount} 位数字专家。分析仅基于页面已确认的专家回答，不引入外部事实；结论属于探索性发现，正式决策前需要真人访谈或业务数据验证。`,
    sourceLines.join("\n"),
    "## 研究简报",
    `本次研究围绕“${input.topic}”支持后续决策，所有结论仅来自当前确认版本。`,
    "## 专家边界",
    roleLines.join("\n"),
    "## 证据覆盖",
    sourceLines.join("\n"),
    "## 关键发现",
    findingLines.join("\n\n"),
    generatedNarrativeText || "当前模型已生成的正文不足以支撑额外主题展开；以上结论仅依据已完成回答。",
    "## 分歧与反例",
    distinctExpertCount > 1
      ? "不同专家回答之间的共识与分歧需要结合后续真人访谈继续校验；当前报告保留每条回答的来源，避免把少量样本推成总体结论。"
      : "当前只有一位专家的有效回答，不能判断跨角色共识或分歧；该回答只能作为后续追访和验证的起点。",
    "## 局限性",
    "本报告基于数字专家模拟访谈生成，样本规模和语境有限。后续应补充真人专家、利益相关方访谈和实际业务数据，优先验证高影响结论、角色差异和可执行建议。",
    "## 待验证假设",
    findings.map((finding) => `- ${finding.title}：仍需真人访谈或业务数据验证。`).join("\n"),
    "## 建议行动",
    findings.map((finding, index) => `- P${Math.min(index, 2)}：围绕“${finding.title}”设计下一轮验证动作，补充真人访谈、业务数据或试点观察，确认该判断是否可进入决策。`).join("\n"),
  ].filter((part) => part.trim().length > 0).join("\n\n");
  return [streamedMarkdown, formalAppendix].filter((part) => part.trim().length > 0).join("\n\n");
}

function parseStringList(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)))
    : [];
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
    const category = typeof candidate.category === "string" ? candidate.category.trim() : "";
    const bio = typeof candidate.bio === "string" ? candidate.bio.trim() : "";
    const location = typeof candidate.location === "string" ? candidate.location.trim() : "";
    const typicalAdvice = typeof candidate.typicalAdvice === "string" ? candidate.typicalAdvice.trim() : "";
    const occupation = typeof candidate.occupation === "string" ? candidate.occupation.trim() : "";
    const serviceValue = typeof candidate.serviceValue === "string" ? candidate.serviceValue.trim() : "";
    const age = typeof candidate.age === "number" && Number.isInteger(candidate.age) && candidate.age > 0 ? candidate.age : 0;
    const domains = parseStringList(candidate.domains);
    const goals = parseStringList(candidate.goals);
    const interests = parseStringList(candidate.interests);
    const painPoints = parseStringList(candidate.painPoints);
    const motivations = parseStringList(candidate.motivations);
    const influences = parseStringList(candidate.influences);
    const traits = candidate.personalityTraits && typeof candidate.personalityTraits === "object"
      ? candidate.personalityTraits as Record<string, unknown> : {};
    const personalityTraits = {
      introvertExtrovert: traits.introvertExtrovert,
      analyticalCreative: traits.analyticalCreative,
      busyTimeRich: traits.busyTimeRich,
    };
    const validTraits = Object.values(personalityTraits).every((score) => typeof score === "number" && Number.isInteger(score) && score >= 1 && score <= 10);
    return displayName && role && domains.length && category && bio && location && typicalAdvice && age && occupation
      && goals.length && interests.length && painPoints.length && motivations.length && influences.length && validTraits && serviceValue
      ? [{ displayName, role, domains, category, bio, location, typicalAdvice, age, occupation, goals, interests,
        painPoints, motivations, influences, personalityTraits: personalityTraits as GeneratedInterviewExpert["personalityTraits"], serviceValue }]
      : [];
  });
  if (experts.length < 3 || experts.length > 5) throw new SyntaxError("experts must contain 3 to 5 valid entries");
  return experts;
}

function parseGeneratedInterviewQuestions(
  text: string,
  expectedExpertIds: readonly string[],
): ReadonlyMap<string, readonly GeneratedInterviewQuestion[]> {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text.trim());
  const parsed = JSON.parse(fenced?.[1]?.trim() ?? text) as { experts?: unknown };
  if (!Array.isArray(parsed.experts)) throw new SyntaxError("experts must be an array");
  const expected = new Set(expectedExpertIds);
  const questionsByExpert = new Map<string, readonly GeneratedInterviewQuestion[]>();
  const uniqueQuestionBodies = new Set<string>();
  for (const value of parsed.experts) {
    if (value === null || typeof value !== "object") throw new SyntaxError("expert question group must be an object");
    const group = value as Record<string, unknown>;
    const expertId = typeof group.expertId === "string" ? group.expertId.trim() : "";
    if (!expected.has(expertId) || questionsByExpert.has(expertId) || !Array.isArray(group.questions)) {
      throw new SyntaxError("expert question group does not match selected experts");
    }
    const questions = group.questions.flatMap((question): GeneratedInterviewQuestion[] => {
      if (question === null || typeof question !== "object") return [];
      const candidate = question as Record<string, unknown>;
      const body = typeof candidate.text === "string" ? candidate.text.trim() : "";
      const purpose = typeof candidate.purpose === "string" ? candidate.purpose.trim() : "";
      return body && purpose ? [{ text: body, purpose }] : [];
    });
    if (questions.length !== 3) throw new SyntaxError("each expert must have exactly three valid questions");
    for (const question of questions) {
      const normalized = question.text.replace(/\s+/g, "").toLocaleLowerCase();
      if (uniqueQuestionBodies.has(normalized)) throw new SyntaxError("questions must be distinct across experts");
      uniqueQuestionBodies.add(normalized);
    }
    questionsByExpert.set(expertId, questions);
  }
  if (questionsByExpert.size !== expected.size) throw new SyntaxError("questions must cover every selected expert");
  return questionsByExpert;
}

function initialsFor(displayName: string): string {
  const compact = displayName.replace(/\s+/g, "");
  return Array.from(compact).slice(0, 2).join("").toUpperCase();
}

const EXPECTED_STATUS = {
  confirm_brief: "topic_pending",
  confirm_topic: "topic_pending",
  confirm_experts: "experts_pending",
  confirm_questions: "questions_pending",
} as const;

const RECONFIRMABLE_STATUS = {
  confirm_brief: new Set(["experts_pending", "questions_pending", "running", "report_pending", "completed"]),
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
      if ((input.nodeName === "confirm_brief" && input.command.kind === "confirm_brief")
        || (input.nodeName === "confirm_topic" && input.command.kind === "confirm_topic")) {
        committedVersionId = this.ids.next("itv-topic");
        await session.query(
          `UPDATE digital_interview_topic_versions SET is_current=false
            WHERE org_id=$1 AND revision_id=$2 AND is_current`,
          [input.orgId, activeRevisionId],
        );
        const researchBrief = input.command.researchBrief;
        if (researchBrief) {
          await session.query(
            `INSERT INTO digital_interview_research_briefs
               (org_id,id,interview_id,revision_id,brief,rule_version,request_id,created_by)
             VALUES ($1,$2,$3,$4,$5::jsonb,'quality-v1',$6,$7)`,
            [input.orgId, this.ids.next("itv-brief"), input.interviewId, activeRevisionId,
              JSON.stringify(researchBrief), input.command.requestId, input.actorId],
          );
        }
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
        const selectedIds = new Set(input.command.expertIds);
        if (input.command.addedExperts.some((expert) => !selectedIds.has(expert.expertId) || !expert.expertId.startsWith("mock-persona:"))) {
          throw new DigitalInterviewWorkflowError("DIGITAL_INTERVIEW_INPUT_INVALID");
        }
        const nextOrdinal = await session.query<{ ordinal: string }>(
          `SELECT (coalesce(max(ordinal),0)+1)::text AS ordinal
             FROM digital_interview_expert_candidates WHERE org_id=$1 AND revision_id=$2`,
          [input.orgId, activeRevisionId],
        );
        let ordinal = Number(nextOrdinal.rows[0]?.ordinal ?? 1);
        for (const expert of input.command.addedExperts) {
          await session.query(
            `INSERT INTO digital_interview_expert_candidates
               (org_id,revision_id,expert_id,agent_definition_id,agent_version,ordinal,initials,display_name,role,domains,
                material_context_pack_id,material_version,category,bio,location,typical_advice,
                age,occupation,goals,interests,pain_points,motivations,influences,personality_traits,service_value)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
             ON CONFLICT (org_id,revision_id,expert_id) DO NOTHING`,
            [input.orgId, activeRevisionId, expert.expertId, expert.agentDefinitionId, expert.agentVersion,
              ordinal++, expert.initials, expert.displayName, expert.role, [...expert.domains],
              expert.materialContextPackId, expert.materialVersion, expert.category, expert.bio,
              expert.location, expert.typicalAdvice, expert.age, expert.occupation, [...expert.goals],
              [...expert.interests], [...expert.painPoints], [...expert.motivations], [...expert.influences],
              expert.personalityTraits, expert.serviceValue],
          );
        }
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
                initials,display_name,role,domains,material_context_pack_id,material_version,
                category,bio,location,typical_advice,age,occupation,goals,interests,pain_points,
                motivations,influences,personality_traits,service_value)
             SELECT org_id,$2,expert_id,agent_definition_id,agent_version,$4,
                    initials,display_name,role,domains,material_context_pack_id,material_version,
                    category,bio,location,typical_advice,age,occupation,goals,interests,pain_points,
                    motivations,influences,personality_traits,service_value
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
               (org_id,version_id,question_id,expert_id,ordinal,body,purpose,section,goal_ids)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [input.orgId, committedVersionId, question.questionId, question.expertId, question.order,
              question.text, question.purpose, question.section, [...question.goalIds]],
          );
        }
        await session.query(
          "DELETE FROM digital_interview_question_candidates WHERE org_id=$1 AND revision_id=$2",
          [input.orgId, activeRevisionId],
        );
        for (const question of input.command.questions) {
          await session.query(
            `INSERT INTO digital_interview_question_candidates
               (org_id,revision_id,question_id,expert_id,ordinal,body,purpose,section,goal_ids)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [input.orgId, activeRevisionId, question.questionId, question.expertId,
              question.order, question.text, question.purpose, question.section, [...question.goalIds]],
          );
        }
        await session.query(
          `INSERT INTO digital_interview_moderator_policies
             (org_id,id,interview_id,revision_id,question_version_id,policy,rule_version,request_id,created_by)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,'quality-v1',$7,$8)`,
          [input.orgId, this.ids.next("itv-policy"), input.interviewId, activeRevisionId, committedVersionId,
            JSON.stringify(input.command.moderatorPolicy ?? { probingDepth: "balanced", clarifyAmbiguity: true,
              seekCounterexamples: true, redirectOffTopic: true, stopWhenGoalSatisfied: true,
              maxFollowUpsPerQuestion: 2 }), input.command.requestId, input.actorId],
        );
        await session.query(
          `UPDATE interview_sessions SET digital_status='questions_pending',report_id=NULL,version=version+1,updated_at=now()
            WHERE org_id=$1 AND id=$2`,
          [input.orgId, input.interviewId],
        );
        nextStatus = "questions_pending";
      } else {
        throw new DigitalInterviewWorkflowError("DIGITAL_INTERVIEW_STEP_INVALID");
      }

      await this.appendConfirmedArtifact(session, {
        orgId: toOrgId(input.orgId), interviewId: input.interviewId, revisionId: activeRevisionId,
        actorId: input.actorId, nodeName: input.nodeName, command: input.command,
      });

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
        system: "你是访谈研究助手。根据访谈主题直接创建 3 至 5 位视角互补的虚拟专家，而不是从已有专家列表选择。专家以专业角色而非虚构姓名标识：displayName 和 role 都使用简洁明确的专业角色称谓，不填写人名；role 应体现与当前主题相关的细分专长，避免泛称“行业专家”或只列普通用户身份。bio 用 1 至 2 句话描述具体专业能力、擅长的研究或实践方法，以及能回答的主题关键问题；不要用空泛资历代替能力，不要编造真实机构任职、荣誉或业绩。各专家应覆盖互补的机制研究、实践实施、成效评估或风险治理视角，根据主题选择而非套用固定职业列表。每位专家必须是与专家列表一致的完整虚拟 Persona 档案，数组字段各给出 2 至 4 条，性格分值为 1 至 10 的整数。只返回 JSON：{\"experts\":[{\"displayName\":\"专业角色称谓\",\"role\":\"简洁的细分专业角色\",\"domains\":[\"专业领域\"],\"category\":\"专家分类\",\"bio\":\"具体专长、方法与主题贡献\",\"location\":\"所在地区\",\"age\":45,\"occupation\":\"职业描述\",\"goals\":[\"目标\"],\"interests\":[\"兴趣\"],\"painPoints\":[\"痛点\"],\"motivations\":[\"动机\"],\"influences\":[\"影响来源\"],\"personalityTraits\":{\"introvertExtrovert\":5,\"analyticalCreative\":7,\"busyTimeRich\":4},\"serviceValue\":\"服务价值说明\",\"typicalAdvice\":\"代表性的建议\"}]}。",
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
              material_context_pack_id,material_version,category,bio,location,typical_advice,
              age,occupation,goals,interests,pain_points,motivations,influences,personality_traits,service_value)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
          [input.orgId, input.revisionId, expertId, expertId,
            expertId, index + 1, initialsFor(expert.displayName),
            expert.displayName, expert.role, [...expert.domains], null, null,
            expert.category, expert.bio, expert.location, expert.typicalAdvice, expert.age, expert.occupation,
            [...expert.goals], [...expert.interests], [...expert.painPoints], [...expert.motivations],
            [...expert.influences], expert.personalityTraits, expert.serviceValue],
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
      await this.refreshReceipt(
        session, toOrgId(input.orgId), input.interviewId, "confirm_brief", input.requestId, workflow,
      );
    });
  }

  async executeInterviewRuns(input: {
    readonly orgId: OrgId; readonly actorId: string; readonly interviewId: string;
    readonly revisionId: string; readonly bypassReadiness?: boolean;
  }): Promise<void> {
    if (!this.modelProvider || !this.modelId) throw new DigitalInterviewWorkflowError("DEPENDENCY_UNAVAILABLE");
    const snapshot = await this.db.withTenant(input.orgId, async (session) => {
      const workflow = await this.requireWorkflow(session, input.orgId, input.interviewId);
      const assessment = workflow.quality.readiness;
      const decision = workflow.quality.readinessDecision;
      const validDecision = decision?.revisionId === workflow.revisionId
        && decision.assessmentRuleVersion === assessment?.ruleVersion
        && ((assessment?.status === "ready" && decision.status === "ready")
          || (assessment?.status === "warning" && decision.status === "warning_accepted"));
      if (workflow.revisionId !== input.revisionId
        || (!input.bypassReadiness && (assessment?.status === "blocking" || !validDecision))) {
        throw new DigitalInterviewWorkflowError("INTERVIEW_NOT_READY");
      }
      if (input.bypassReadiness && workflow.status === "questions_pending") {
        await session.query(
          `UPDATE interview_sessions SET digital_status='running',updated_at=now()
            WHERE org_id=$1 AND id=$2`,
          [input.orgId, input.interviewId],
        );
      }
      const allowed = await session.query<{ allowed: boolean; topic: string }>(
        `SELECT EXISTS(SELECT 1 FROM org_memberships WHERE org_id=$1 AND user_id=$2) AS allowed,
                topic FROM interview_sessions WHERE org_id=$1 AND id=$3`,
        [input.orgId, input.actorId, input.interviewId],
      );
      if (!allowed.rows[0]?.allowed) throw new DigitalInterviewWorkflowError("PERMISSION_REVOKED_MIDWAY");
      const experts = await session.query<{
        expert_id: string; display_name: string; role: string; domains: string[]; ordinal: number;
      }>(
        `SELECT s.expert_id,s.display_name,s.role,s.domains,s.ordinal
           FROM digital_interview_expert_snapshots s
           JOIN digital_interview_expert_snapshot_versions v
             ON v.org_id=s.org_id AND v.id=s.version_id
          WHERE s.org_id=$1 AND v.revision_id=$2 AND v.is_current ORDER BY s.ordinal`,
        [input.orgId, input.revisionId],
      );
      const questions = await session.query<{
        question_id: string; expert_id: string; body: string; purpose: string; ordinal: number;
      }>(
        `SELECT q.question_id,q.expert_id,q.body,q.purpose,q.ordinal
           FROM digital_interview_questions q
           JOIN digital_interview_question_versions v ON v.org_id=q.org_id AND v.id=q.version_id
          WHERE q.org_id=$1 AND v.revision_id=$2 AND v.is_current ORDER BY q.ordinal`,
        [input.orgId, input.revisionId],
      );
      const existing = await session.query<{ expert_id: string }>(
        `SELECT expert_id FROM digital_interview_expert_runs
          WHERE org_id=$1 AND interview_id=$2 AND revision_id=$3`,
        [input.orgId, input.interviewId, input.revisionId],
      );
      return { topic: allowed.rows[0].topic, experts: experts.rows, questions: questions.rows,
        moderatorPolicy: workflow.moderatorPolicy,
        existing: new Set(existing.rows.map((row) => row.expert_id)) };
    });

    const pendingExperts = snapshot.experts.filter((expert) => !snapshot.existing.has(expert.expert_id));
    await Promise.all(pendingExperts.map((expert) => this.persistRun(
      input, expert,
      snapshot.questions.filter((question) => question.expert_id === expert.expert_id).length,
      "running", [], null,
    )));

    // Model calls deliberately outlive the confirmation request. The durable running rows above
    // make the runs immediately visible, while each completion independently writes its result.
    void Promise.all(pendingExperts.map(async (expert) => {
      const questions = snapshot.questions.filter((question) => question.expert_id === expert.expert_id);
      let answers: Awaited<ReturnType<typeof completeInterviewRunAnswers>>;
      try {
        answers = await completeInterviewRunAnswers({
          model: this.model, modelProvider: this.modelProvider!, modelId: this.modelId!,
          topic: snapshot.topic, expert, questions, moderatorPolicy: snapshot.moderatorPolicy,
        });
      } catch (error) {
        const code = error instanceof InvalidInterviewAnswersError ? "MODEL_OUTPUT_INVALID" : "MODEL_CALL_FAILED";
        await this.persistRun(input, expert, questions.length, "failed", [], code);
        return;
      }
      await this.persistRun(input, expert, questions.length, "completed", answers, null);
    })).catch(() => undefined);
  }

  async decideReadiness(input: {
    readonly orgId: OrgId; readonly actorId: string; readonly interviewId: string;
    readonly assessmentRuleVersion: string; readonly status: "ready" | "warning_accepted";
    readonly rationale: string | null; readonly expectedVersion: number; readonly requestId: string;
  }): Promise<Guarded<DigitalInterviewWorkflowView>> {
    if (input.status === "warning_accepted" && (!input.rationale || input.rationale.trim().length < 10)) {
      throw new DigitalInterviewWorkflowError("READINESS_RATIONALE_REQUIRED");
    }
    return this.db.withTenant(input.orgId, async (session) => {
      await this.lockRequest(session, input.orgId, input.interviewId, "decide_readiness", input.requestId);
      const replay = await this.readReceipt(session, input.orgId, input.interviewId, "decide_readiness", input.requestId);
      if (replay) return guardWorkflow(replay.response_body);
      const current = await this.lockInterview(session, input.orgId, input.interviewId, input.actorId);
      if (Number(current.version) !== input.expectedVersion) throw new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION");
      const workflow = await this.requireWorkflow(session, input.orgId, input.interviewId);
      const assessment = workflow.quality.readiness;
      const allowed = assessment?.ruleVersion === input.assessmentRuleVersion
        && ((assessment.status === "ready" && input.status === "ready")
          || (assessment.status === "warning" && input.status === "warning_accepted"));
      if (!allowed) throw new DigitalInterviewWorkflowError("INTERVIEW_NOT_READY");
      await session.query(
        `INSERT INTO digital_interview_readiness_decisions
           (org_id,id,interview_id,revision_id,assessment_rule_version,status,rationale,request_id,decided_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [input.orgId, this.ids.next("itv-readiness"), input.interviewId, workflow.revisionId,
          input.assessmentRuleVersion, input.status, input.rationale, input.requestId, input.actorId],
      );
      await session.query(
        `UPDATE interview_sessions SET digital_status='running',version=version+1,updated_at=now()
          WHERE org_id=$1 AND id=$2`, [input.orgId, input.interviewId],
      );
      const updated = await this.requireWorkflow(session, input.orgId, input.interviewId);
      await this.writeReceipt(session, { orgId: input.orgId, interviewId: input.interviewId,
        operationId: `${input.interviewId}:decide_readiness:${input.requestId}`,
        operationName: "decide_readiness", requestId: input.requestId,
        payload: { assessmentRuleVersion: input.assessmentRuleVersion, status: input.status,
          rationale: input.rationale, expectedVersion: input.expectedVersion }, workflow: updated });
      return guardWorkflow(updated);
    });
  }

  async reviewReport(input: {
    readonly orgId: OrgId; readonly actorId: string; readonly interviewId: string;
    readonly reportId: string; readonly status: "approved" | "changes_requested";
    readonly note: string | null; readonly expectedVersion: number; readonly requestId: string;
  }): Promise<Guarded<DigitalInterviewWorkflowView>> {
    return this.db.withTenant(input.orgId, async (session) => {
      await this.lockRequest(session, input.orgId, input.interviewId, "review_report", input.requestId);
      const current = await this.lockInterview(session, input.orgId, input.interviewId, input.actorId);
      if (Number(current.version) !== input.expectedVersion) throw new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION");
      const workflow = await this.requireWorkflow(session, input.orgId, input.interviewId);
      if (workflow.report?.reportId !== input.reportId) throw new DigitalInterviewWorkflowError("REPORT_REVIEW_BLOCKED");
      const sourceReferencesValid = workflow.report.findings.every((finding) => workflow.expertRuns.some((run) =>
        run.expertId === finding.expertId && run.answers.some((answer) => answer.questionId === finding.questionId)));
      const approval = canApproveReport({ legacy: workflow.researchBrief === null,
        evidenceCoverage: workflow.quality.evidenceCoverage, sourceReferencesValid });
      if (input.status === "approved" && !approval.allowed) {
        throw new DigitalInterviewWorkflowError("REPORT_REVIEW_BLOCKED");
      }
      await session.query(
        `INSERT INTO digital_interview_report_reviews
           (org_id,id,interview_id,revision_id,report_id,status,note,request_id,reviewed_by,reviewed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
         ON CONFLICT (org_id,interview_id,revision_id,report_id) DO UPDATE
           SET status=excluded.status,note=excluded.note,request_id=excluded.request_id,
               reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at`,
        [input.orgId, this.ids.next("itv-review"), input.interviewId, workflow.revisionId,
          input.reportId, input.status, input.note, input.requestId, input.actorId],
      );
      await session.query("UPDATE interview_sessions SET version=version+1,updated_at=now() WHERE org_id=$1 AND id=$2",
        [input.orgId, input.interviewId]);
      return guardWorkflow(await this.requireWorkflow(session, input.orgId, input.interviewId));
    });
  }

  async generateReport(input: {
    readonly orgId: OrgId; readonly actorId: string; readonly interviewId: string;
    readonly expectedVersion: number; readonly requestId: string; readonly operationId: string;
    readonly onProgress?: (workflow: Guarded<DigitalInterviewWorkflowView>) => Promise<void>;
  }): Promise<Guarded<DigitalInterviewWorkflowView>> {
    const payload = { expectedVersion: input.expectedVersion };
    const replay = await this.findReceipt({ ...input, operationName: "generate_report", payload });
    if (replay) return replay;
    const snapshot = await this.db.withTenant(input.orgId, async (session) => {
      const workflow = await this.requireWorkflow(session, input.orgId, input.interviewId);
      if (workflow.version !== input.expectedVersion) throw new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION");
      if (!workflow.expertRuns.length || workflow.expertRuns.some((run) => run.status === "running")) {
        throw new DigitalInterviewWorkflowError("DIGITAL_REPORT_NOT_READY");
      }
      const completed = workflow.expertRuns.filter((run) => run.status === "completed" && run.answers.length);
      if (!completed.length) throw new DigitalInterviewWorkflowError("DIGITAL_REPORT_NOT_READY");
      return { workflow, completed };
    });
    if (!this.modelProvider || !this.modelId) throw new DigitalInterviewWorkflowError("AI_GENERATION_UNAVAILABLE");
    const proposedReportId = this.ids.next("itv-report");
    const started = await this.db.withTenant(input.orgId, async (session) => {
      await this.lockRequest(session, input.orgId, input.interviewId, "generate_report", input.requestId);
      const current = await this.lockInterview(session, input.orgId, input.interviewId, input.actorId);
      if (Number(current.version) !== input.expectedVersion) throw new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION");
      const existing = await session.query<{ report_id: string; generation_status: "running" | "completed" | "failed"; stale: boolean; request_id: string }>(
        `SELECT report_id,generation_status,request_id,(${DIGITAL_REPORT_STALE_SQL}) AS stale
           FROM digital_interview_reports
          WHERE org_id=$1 AND interview_id=$2 AND revision_id=$3
          FOR UPDATE`,
        [input.orgId, input.interviewId, current.revision_id],
      );
      const existingReport = existing.rows[0];
      if (existingReport && existingReport.generation_status === "running" && (!existingReport.stale || existingReport.request_id === input.requestId)) {
        throw new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION");
      }
      const reportId = existingReport?.report_id ?? proposedReportId;
      if (existingReport) {
        await session.query(
          `UPDATE digital_interview_reports
              SET previous_report=CASE WHEN generation_status='completed' THEN $5::jsonb ELSE previous_report END,
                  title=NULL,executive_summary=NULL,markdown='',findings='[]'::jsonb,
                  generation_status='running',request_id=$4,error_code=NULL,updated_at=now()
            WHERE org_id=$1 AND interview_id=$2 AND report_id=$3`,
          [input.orgId, input.interviewId, reportId, input.requestId, JSON.stringify(snapshot.workflow.report)],
        );
      } else {
        await session.query(
          `INSERT INTO digital_interview_reports
             (org_id,report_id,interview_id,revision_id,title,executive_summary,markdown,findings,
              generation_status,request_id,error_code)
           VALUES ($1,$2,$3,$4,NULL,NULL,'','[]'::jsonb,'running',$5,NULL)`,
          [input.orgId, reportId, input.interviewId, current.revision_id, input.requestId],
        );
      }
      await session.query(
        `UPDATE interview_sessions
            SET report_id=$3,digital_status='report_pending',version=version+1,updated_at=now()
          WHERE org_id=$1 AND id=$2`,
        [input.orgId, input.interviewId, reportId],
      );
      return { reportId, workflow: guardWorkflow(await this.requireWorkflow(session, input.orgId, input.interviewId)) };
    });
    const reportId = started.reportId;
    // Restore from the durable backup; a superseded attempt cannot alter its replacement.
    const failGeneration = async (code: string) => this.db.withTenant(input.orgId, async (session) => {
      await session.query("SELECT id FROM interview_sessions WHERE org_id=$1 AND id=$2 FOR UPDATE", [input.orgId, input.interviewId]);
      const backup = await session.query<{ previous_report: DigitalInterviewWorkflowView["report"] }>(
        `SELECT previous_report FROM digital_interview_reports
          WHERE org_id=$1 AND interview_id=$2 AND report_id=$3 AND request_id=$4 AND generation_status='running' FOR UPDATE`,
        [input.orgId,input.interviewId,reportId,input.requestId],
      );
      const previous = backup.rows[0]?.previous_report;
      if (previous) {
        const restored = await session.query(
          `UPDATE digital_interview_reports
              SET title=$5,executive_summary=$6,markdown=$7,findings=$8,generated_at=$9,
                  generation_status='completed',error_code=$10,previous_report=NULL,updated_at=now()
            WHERE org_id=$1 AND interview_id=$2 AND report_id=$3 AND request_id=$4
              AND generation_status='running' RETURNING report_id`,
          [input.orgId,input.interviewId,reportId,input.requestId,previous.title,previous.executiveSummary,
            previous.markdown,JSON.stringify(previous.findings),previous.generatedAt,code],
        );
        if (restored.rows.length) await session.query(
          `UPDATE interview_sessions SET digital_status='completed',version=version+1,updated_at=now()
            WHERE org_id=$1 AND id=$2 AND report_id=$3 AND digital_status='report_pending'`,
          [input.orgId,input.interviewId,reportId],
        );
      } else {
        await session.query(
          `UPDATE digital_interview_reports SET generation_status='failed',error_code=$5,updated_at=now()
            WHERE org_id=$1 AND interview_id=$2 AND report_id=$3 AND request_id=$4 AND generation_status='running'`,
          [input.orgId,input.interviewId,reportId,input.requestId,code],
        );
      }
      return guardWorkflow(await this.requireWorkflow(session, input.orgId, input.interviewId));
    });

    const validSources = new Set(snapshot.completed.flatMap((run) => run.answers.map((answer) => `${run.expertId}:${answer.questionId}`)));
    const goalIdsBySource = new Map(snapshot.workflow.questions.map((question) => [
      `${question.expertId}:${question.questionId}`, question.goalIds,
    ]));
    const sourceAnswers: ReportSourceAnswer[] = snapshot.completed.flatMap((run) => run.answers.map((answer) => ({
      expertId: run.expertId,
      displayName: run.displayName,
      questionId: answer.questionId,
      question: answer.question,
      answer: answer.answer,
    })));
    const decoder = new DigitalReportNdjsonDecoder();
    let sawDelta = false;
    let metaCount = 0;
    let sectionCount = 0;
    let findingCount = 0;
    const reportSections: string[] = [];
    const reportFindings: Array<{ title: string; summary: string; expertId: string; questionId: string }> = [];
    const findingSources = new Set<string>();
    const persistEvent = async (event: ParsedDigitalReportStreamEvent): Promise<void> => {
      if (event.type === "finding") {
        try { assertFindingSources(snapshot.completed, [event]); }
        catch { throw new DigitalInterviewWorkflowError("DIGITAL_REPORT_SOURCE_INVALID"); }
      }
      const progress = await this.db.withTenant(input.orgId, async (session) => {
        // Reuse the write transaction's complete actor-visibility predicate, not merely
        // organization membership: collaborator/project access may be revoked mid-stream.
        await this.lockInterview(session, input.orgId, input.interviewId, input.actorId);
        const attempt = await session.query(
          `SELECT report_id FROM digital_interview_reports WHERE org_id=$1 AND report_id=$2
            AND request_id=$3 AND generation_status='running' AND NOT (${DIGITAL_REPORT_STALE_SQL}) FOR UPDATE`,
          [input.orgId, reportId, input.requestId],
        );
        if (attempt.rows.length !== 1) throw new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION");
        if (event.type === "meta") {
          await session.query(
            `UPDATE digital_interview_reports
                SET title=$4,executive_summary=$5,updated_at=now()
              WHERE org_id=$1 AND interview_id=$2 AND report_id=$3 AND generation_status='running'`,
            [input.orgId, input.interviewId, reportId, event.title, event.executiveSummary],
          );
        } else if (event.type === "section") {
          await session.query(
            `UPDATE digital_interview_reports
                SET markdown=concat_ws(E'\\n\\n',nullif(markdown,''),$4::text),updated_at=now()
              WHERE org_id=$1 AND interview_id=$2 AND report_id=$3 AND generation_status='running'`,
            [input.orgId, input.interviewId, reportId, event.markdown],
          );
        } else {
          const finding = {
            findingId: this.ids.next("itv-finding"), title: event.title, summary: event.summary,
            expertId: event.expertId, questionId: event.questionId,
            sourceAnswerId: `${event.expertId}:${event.questionId}`, exploratory: true as const,
            evidenceStatus: "exploratory" as const,
            evidenceRefs: [{
              sourceKind: "digital_expert" as const, sourceAnswerId: `${event.expertId}:${event.questionId}`,
              expertId: event.expertId, participantId: null, questionId: event.questionId,
              revisionId: snapshot.workflow.revisionId,
            }],
            counterEvidenceCount: 0,
            goalIds: goalIdsBySource.get(`${event.expertId}:${event.questionId}`) ?? [],
          };
          await session.query(
            `UPDATE digital_interview_reports
                SET findings=findings || $4::jsonb,updated_at=now()
              WHERE org_id=$1 AND interview_id=$2 AND report_id=$3 AND generation_status='running'`,
            [input.orgId, input.interviewId, reportId, JSON.stringify([finding])],
          );
        }
        return guardWorkflow(await this.requireWorkflow(session, input.orgId, input.interviewId));
      });
      if (event.type === "meta") metaCount += 1;
      else if (event.type === "section") {
        sectionCount += 1;
        reportSections.push(event.markdown);
      } else {
        findingCount += 1;
        findingSources.add(`${event.expertId}:${event.questionId}`);
        reportFindings.push({ title: event.title, summary: event.summary, expertId: event.expertId, questionId: event.questionId });
      }
      await input.onProgress?.(progress);
    };

    try {
      await input.onProgress?.(started.workflow);
      const modelInput = {
        modelProvider: this.modelProvider,
        modelId: this.modelId,
        system: buildDigitalInterviewReportSystemPrompt(Math.min(3, validSources.size)),
        user: JSON.stringify({
          operation: "generate_interview_report", topic: snapshot.workflow.topic,
          researchBrief: snapshot.workflow.researchBrief,
          evidenceCoverage: snapshot.workflow.quality.evidenceCoverage,
          evidenceBoundary: "digital_expert_simulation_requires_human_validation",
          experts: snapshot.completed.map((run) => ({
            ...snapshot.workflow.expertCandidates.find((candidate) => candidate.expertId === run.expertId),
            expertId: run.expertId,
            displayName: run.displayName,
            answers: run.answers,
          })),
        }),
        history: [],
      } as const;
      const completion = this.model.completeStream
        ? await this.model.completeStream(modelInput, async (delta) => {
          sawDelta = true;
          for (const event of decoder.push(delta)) await persistEvent(event);
        })
        : await this.model.complete(modelInput);
      if (!sawDelta) {
        for (const event of decoder.push(completion.text)) await persistEvent(event);
      }
      for (const event of decoder.finish()) await persistEvent(event);
      const minimumFindings = Math.min(3, validSources.size);
      if (metaCount === 1 && sectionCount >= 1 && findingSources.size < minimumFindings) {
        for (const answer of sourceAnswers) {
          if (findingSources.size >= minimumFindings) break;
          const sourceAnswerId = `${answer.expertId}:${answer.questionId}`;
          if (findingSources.has(sourceAnswerId)) continue;
          await persistEvent({
            type: "finding",
            title: `补充发现：${excerpt(answer.question, 32)}`,
            summary: `${answer.displayName}回答：“${excerpt(answer.answer)}”。该发现由已确认回答直接生成，用于补齐报告的可追溯发现，仍需真人研究验证。`,
            expertId: answer.expertId,
            questionId: answer.questionId,
          });
        }
      }
      const reportMarkdown = reportSections.join("\n\n");
      let headingCursor = 0;
      const hasRequiredStructure = DIGITAL_REPORT_REQUIRED_HEADINGS.every((heading) => {
        const index = reportMarkdown.indexOf(heading, headingCursor);
        if (index < 0) return false;
        headingCursor = index + heading.length;
        return true;
      });
      if (metaCount !== 1 || sectionCount < 1
        || findingCount < minimumFindings
        || findingSources.size < minimumFindings) {
        throw new SyntaxError("incomplete streamed report");
      }
      if (!hasRequiredStructure) {
        const normalizedMarkdown = buildFallbackReportMarkdown({
          topic: snapshot.workflow.topic ?? "未命名研究主题",
          answers: sourceAnswers,
          sections: reportSections,
          findings: reportFindings,
        });
        await this.db.withTenant(input.orgId, async (session) => {
          const attempt = await session.query(
            `UPDATE digital_interview_reports
                SET markdown=$5,updated_at=now()
              WHERE org_id=$1 AND interview_id=$2 AND report_id=$3 AND request_id=$4
                AND generation_status='running' AND NOT (${DIGITAL_REPORT_STALE_SQL})
              RETURNING report_id`,
            [input.orgId, input.interviewId, reportId, input.requestId, normalizedMarkdown],
          );
          if (attempt.rows.length !== 1) throw new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION");
        });
      }
    } catch (error) {
      console.error("[digital-interview-report] streaming generation failed", error);
      const code = error instanceof DigitalInterviewWorkflowError
        ? error.code
        : error instanceof ModelCallError || error instanceof SyntaxError
          ? "AI_GENERATION_UNAVAILABLE"
          : "DEPENDENCY_UNAVAILABLE";
      const failed = await failGeneration(code);
      if (!snapshot.workflow.report) await input.onProgress?.(failed);
      throw new DigitalInterviewWorkflowError(code);
    }
    try {
      return await this.db.withTenant(input.orgId, async (session) => {
        const existing = await this.readReceipt(session, input.orgId, input.interviewId, "generate_report", input.requestId);
        if (existing) { this.assertMatchingReceipt(existing, payload); return guardWorkflow(existing.response_body); }
        const current = await this.lockInterview(session, input.orgId, input.interviewId, input.actorId);
        if (Number(current.version) !== input.expectedVersion + 1) throw new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION");
        const shape = await session.query<{ valid: boolean }>(
          `SELECT title IS NOT NULL AND executive_summary IS NOT NULL AND length(btrim(markdown)) > 0
                  AND jsonb_array_length(findings) > 0 AS valid
             FROM digital_interview_reports WHERE org_id=$1 AND report_id=$2
              AND request_id=$3 AND generation_status='running' AND NOT (${DIGITAL_REPORT_STALE_SQL}) FOR UPDATE`,
          [input.orgId, reportId, input.requestId],
        );
        if (!shape.rows.length) throw new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION");
        if (!shape.rows[0]?.valid) throw new DigitalInterviewWorkflowError("AI_GENERATION_UNAVAILABLE");
        const workflowBeforeCompletion = await this.requireWorkflow(session, input.orgId, input.interviewId);
        const review = deriveApprovalEligibility({
          mode: workflowBeforeCompletion.studyEvidenceMode,
          findings: workflowBeforeCompletion.reportGeneration?.findings ?? [],
          hasUnreviewedQualityFlag: false,
        });
        await session.query(
          `UPDATE digital_interview_reports
              SET generation_status='completed',error_code=NULL,review_state=$3::jsonb,previous_report=NULL,generated_at=now(),updated_at=now()
            WHERE org_id=$1 AND report_id=$2`,
          [input.orgId, reportId, JSON.stringify(review)],
        );
        await session.query(
          `UPDATE interview_sessions SET report_id=$3,digital_status='completed',version=version+1,updated_at=now()
            WHERE org_id=$1 AND id=$2`,
          [input.orgId, input.interviewId, reportId],
        );
        const workflow = await this.requireWorkflow(session, input.orgId, input.interviewId);
        await this.writeReceipt(session, { ...input, operationName: "generate_report", payload, workflow });
        return guardWorkflow(workflow);
      });
    } catch (error) {
      console.error("[digital-interview-report] finalization failed", error);
      const code = error instanceof DigitalInterviewWorkflowError ? error.code : "DEPENDENCY_UNAVAILABLE";
      const failed = await failGeneration(code);
      if (!snapshot.workflow.report) await input.onProgress?.(failed);
      throw error;
    }
  }

  private async persistRun(
    input: { readonly orgId: OrgId; readonly actorId: string; readonly interviewId: string; readonly revisionId: string },
    expert: { readonly expert_id: string; readonly display_name: string; readonly ordinal: number },
    totalQuestions: number,
    status: "running" | "completed" | "failed",
    answers: readonly { readonly questionId: string; readonly question: string; readonly answer: string }[],
    errorCode: string | null,
  ): Promise<void> {
    await this.db.withTenant(input.orgId, async (session) => {
      const membership = await session.query<{ allowed: boolean }>(
        "SELECT EXISTS(SELECT 1 FROM org_memberships WHERE org_id=$1 AND user_id=$2) AS allowed",
        [input.orgId, input.actorId],
      );
      if (!membership.rows[0]?.allowed) throw new DigitalInterviewWorkflowError("PERMISSION_REVOKED_MIDWAY");
      await session.query(
        `INSERT INTO digital_interview_expert_runs
           (org_id,interview_id,revision_id,expert_id,display_name,ordinal,status,total_questions,answers,error_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (org_id,revision_id,expert_id) DO UPDATE SET
           status=EXCLUDED.status,total_questions=EXCLUDED.total_questions,answers=EXCLUDED.answers,
           error_code=EXCLUDED.error_code,updated_at=now()`,
        [input.orgId,input.interviewId,input.revisionId,expert.expert_id,expert.display_name,
          expert.ordinal,status,totalQuestions,JSON.stringify(answers),errorCode],
      );
    });
  }

  async generateQuestions(input: GenerateDigitalInterviewDraftInput): Promise<void> {
    const payload = { expectedVersion: input.expectedVersion };
    const replayed = await this.db.withTenant(toOrgId(input.orgId), async (session) => {
      const replay = await this.readReceipt(
        session, toOrgId(input.orgId), input.interviewId, "generate_questions", input.requestId,
      );
      if (!replay) return false;
      this.assertMatchingReceipt(replay, payload);
      return true;
    });
    if (replayed) return;

    // Authorize and freeze the inputs before any Persona leaves the database boundary. The
    // tenant session ends before model.complete(), so no transaction remains open during a
    // potentially slow external call. Persistence performs the same visibility check again.
    const context = await this.db.withTenant(toOrgId(input.orgId), async (session) =>
      this.readAuthorizedQuestionContext(session, input));
    if (!context.topic || !context.selected.length) {
      throw new DigitalInterviewWorkflowError("DIGITAL_INTERVIEW_INPUT_INVALID");
    }
    const missingProfiles = context.selected.filter((expert) => expert.existingQuestionCount === 0);
    let generated = new Map<string, readonly GeneratedInterviewQuestion[]>();
    if (missingProfiles.length) {
      if (!this.modelProvider || !this.modelId) throw new DigitalInterviewWorkflowError("AI_GENERATION_UNAVAILABLE");
      try {
        const response = await this.model.complete({
          modelProvider: this.modelProvider,
          modelId: this.modelId,
          system: "你是资深访谈研究员。请根据访谈主题和每位专家的完整 Persona，分别设计恰好 3 个高度针对性、开放式、非诱导的问题。问题必须体现该专家独有的专业身份、目标、兴趣、痛点、动机、影响来源、性格特征、服务价值或典型建议，不能只替换姓名，也不能让不同专家共用同一模板。只返回 JSON：{\"experts\":[{\"expertId\":\"原样返回输入 ID\",\"questions\":[{\"text\":\"问题\",\"purpose\":\"提问目的\"}]}]}。",
          user: JSON.stringify({
            operation: "generate_interview_questions",
            topic: context.topic,
            experts: missingProfiles.map(({ existingQuestionCount: _count, ...profile }) => profile),
          }),
        });
        generated = new Map(parseGeneratedInterviewQuestions(
          response.text,
          missingProfiles.map((expert) => expert.expertId),
        ));
      } catch (error) {
        if (!(error instanceof ModelCallError || error instanceof SyntaxError)) throw error;
        throw new DigitalInterviewWorkflowError("AI_GENERATION_UNAVAILABLE");
      }
    }

    await this.db.withTenant(toOrgId(input.orgId), async (session) => {
      await this.lockRequest(
        session, toOrgId(input.orgId), input.interviewId, "generate_questions", input.requestId,
      );
      const replay = await this.readReceipt(
        session, toOrgId(input.orgId), input.interviewId, "generate_questions", input.requestId,
      );
      if (replay) { this.assertMatchingReceipt(replay, payload); return; }
      const current = await this.lockInterview(session, toOrgId(input.orgId), input.interviewId, input.actorId);
      if (Number(current.version) !== input.expectedVersion || current.revision_id !== input.revisionId
        || current.revision_number !== input.revisionNumber) {
        throw new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION");
      }
      const selected = await this.readQuestionExpertProfiles(session, input);
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
      const brief = await session.query<{ brief: { learningGoals?: Array<{ goalId?: string }> } }>(
        `SELECT brief FROM digital_interview_research_briefs WHERE org_id=$1 AND revision_id=$2`,
        [input.orgId, input.revisionId],
      );
      const goalIds = (brief.rows[0]?.brief.learningGoals ?? []).flatMap((goal) => goal.goalId ? [goal.goalId] : []);
      for (const expert of selected) {
        if (expert.existingQuestionCount > 0) continue;
        const questions = generated.get(expert.expertId);
        if (!questions) throw new DigitalInterviewWorkflowError("AI_GENERATION_UNAVAILABLE");
        for (const [questionIndex, question] of questions.entries()) {
          ordinal += 1;
          await session.query(
            `INSERT INTO digital_interview_question_candidates
               (org_id,revision_id,question_id,expert_id,ordinal,body,purpose,section,goal_ids)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [input.orgId, input.revisionId, this.ids.next("itv-question-draft"), expert.expertId,
              ordinal, question.text, question.purpose, questionIndex === 2 ? "counterexample" : "core",
              goalIds.length ? [goalIds[questionIndex % goalIds.length]!] : []],
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

  private async readQuestionExpertProfiles(
    session: TenantSession,
    input: GenerateDigitalInterviewDraftInput,
  ): Promise<InterviewQuestionExpertProfile[]> {
    const selected = await session.query<{
      expert_id: string; display_name: string; role: string; domains: string[]; category: string;
      bio: string; location: string; typical_advice: string; age: number; occupation: string;
      goals: string[]; interests: string[]; pain_points: string[]; motivations: string[];
      influences: string[];
      personality_traits: { introvertExtrovert: number; analyticalCreative: number; busyTimeRich: number };
      service_value: string; existing_question_count: string;
    }>(
      `SELECT c.expert_id,c.display_name,c.role,c.domains,c.category,c.bio,c.location,c.typical_advice,
              c.age,c.occupation,c.goals,c.interests,c.pain_points,c.motivations,c.influences,
              c.personality_traits,c.service_value,count(q.question_id)::text AS existing_question_count
         FROM digital_interview_expert_candidates c
         JOIN interview_sessions s ON s.org_id=c.org_id AND s.id=$3
         LEFT JOIN digital_interview_question_candidates q
           ON q.org_id=c.org_id AND q.revision_id=c.revision_id AND q.expert_id=c.expert_id
        WHERE c.org_id=$1 AND c.revision_id=$2 AND c.expert_id=ANY(s.selected_expert_ids)
        GROUP BY c.expert_id,c.display_name,c.role,c.domains,c.category,c.bio,c.location,c.typical_advice,
                 c.age,c.occupation,c.goals,c.interests,c.pain_points,c.motivations,c.influences,
                 c.personality_traits,c.service_value,c.ordinal
        ORDER BY c.ordinal`,
      [input.orgId, input.revisionId, input.interviewId],
    );
    return selected.rows.map((expert) => ({
      expertId: expert.expert_id,
      displayName: expert.display_name,
      role: expert.role,
      domains: expert.domains,
      category: expert.category,
      bio: expert.bio,
      location: expert.location,
      typicalAdvice: expert.typical_advice,
      age: expert.age,
      occupation: expert.occupation,
      goals: expert.goals,
      interests: expert.interests,
      painPoints: expert.pain_points,
      motivations: expert.motivations,
      influences: expert.influences,
      personalityTraits: expert.personality_traits,
      serviceValue: expert.service_value,
      existingQuestionCount: Number(expert.existing_question_count),
    }));
  }

  private async readAuthorizedQuestionContext(
    session: TenantSession,
    input: GenerateDigitalInterviewDraftInput,
  ): Promise<{ readonly topic: string; readonly selected: readonly InterviewQuestionExpertProfile[] }> {
    const snapshot = await session.query<{
      topic: string | null; version: string; revision_id: string; revision_number: number;
      expert_id: string; display_name: string; role: string; domains: string[]; category: string;
      bio: string; location: string; typical_advice: string; age: number; occupation: string;
      goals: string[]; interests: string[]; pain_points: string[]; motivations: string[];
      influences: string[];
      personality_traits: { introvertExtrovert: number; analyticalCreative: number; busyTimeRich: number };
      service_value: string; existing_question_count: string;
    }>(
      `SELECT s.topic,s.version,r.id AS revision_id,r.revision_number,
              c.expert_id,c.display_name,c.role,c.domains,c.category,c.bio,c.location,c.typical_advice,
              c.age,c.occupation,c.goals,c.interests,c.pain_points,c.motivations,c.influences,
              c.personality_traits,c.service_value,
              (SELECT count(*)::text FROM digital_interview_question_candidates q
                WHERE q.org_id=c.org_id AND q.revision_id=c.revision_id
                  AND q.expert_id=c.expert_id) AS existing_question_count
         FROM interview_sessions s
         JOIN digital_interview_revisions r
           ON r.org_id=s.org_id AND r.interview_id=s.id AND r.is_current
         JOIN digital_interview_expert_candidates c
           ON c.org_id=s.org_id AND c.revision_id=r.id AND c.expert_id=ANY(s.selected_expert_ids)
        WHERE s.org_id=$1 AND s.id=$2
          AND ${DIGITAL_INTERVIEW_ACTOR_VISIBILITY}
        ORDER BY c.ordinal`,
      [input.orgId, input.interviewId, input.actorId],
    );
    const current = snapshot.rows[0];
    if (!current) throw new DigitalInterviewWorkflowError("PERMISSION_REVOKED_MIDWAY");
    if (Number(current.version) !== input.expectedVersion || current.revision_id !== input.revisionId
      || current.revision_number !== input.revisionNumber) {
      throw new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION");
    }
    return {
      topic: current.topic?.trim() ?? "",
      selected: snapshot.rows.map((expert) => ({
        expertId: expert.expert_id,
        displayName: expert.display_name,
        role: expert.role,
        domains: expert.domains,
        category: expert.category,
        bio: expert.bio,
        location: expert.location,
        typicalAdvice: expert.typical_advice,
        age: expert.age,
        occupation: expert.occupation,
        goals: expert.goals,
        interests: expert.interests,
        painPoints: expert.pain_points,
        motivations: expert.motivations,
        influences: expert.influences,
        personalityTraits: expert.personality_traits,
        serviceValue: expert.service_value,
        existingQuestionCount: Number(expert.existing_question_count),
      })),
    };
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
      category: string; bio: string; location: string; typical_advice: string;
      age: number; occupation: string; goals: string[]; interests: string[]; pain_points: string[];
      motivations: string[]; influences: string[];
      personality_traits: GeneratedInterviewExpert["personalityTraits"]; service_value: string;
    }>(
      `SELECT s.expert_id,s.agent_definition_id,s.agent_version,s.ordinal,s.initials,
              s.display_name,s.role,s.domains,s.material_context_pack_id,s.material_version,
              s.category,s.bio,s.location,s.typical_advice,s.age,s.occupation,s.goals,s.interests,
              s.pain_points,s.motivations,s.influences,s.personality_traits,s.service_value
         FROM digital_interview_expert_snapshots s
         JOIN digital_interview_expert_snapshot_versions v
           ON v.org_id=s.org_id AND v.id=s.version_id
        WHERE v.org_id=$1 AND v.revision_id=$2 AND v.is_current
        ORDER BY s.ordinal`,
      [input.orgId, current.revision_id],
    );
    const previousQuestions = await session.query<{
      question_id: string; expert_id: string; ordinal: number; body: string; purpose: string;
      section: string; goal_ids: string[];
    }>(
      `SELECT q.question_id,q.expert_id,q.ordinal,q.body,q.purpose,q.section,q.goal_ids
         FROM digital_interview_questions q
         JOIN digital_interview_question_versions v
           ON v.org_id=q.org_id AND v.id=q.version_id
        WHERE v.org_id=$1 AND v.revision_id=$2 AND v.is_current
        ORDER BY q.ordinal`,
      [input.orgId, current.revision_id],
    );
    const previousArtifacts = await session.query<{
      step: "intake" | "analysis" | "experts" | "outline" | "runs" | "report";
      version_number: number; title: string; markdown: string;
      status: "draft" | "confirmed" | "generating" | "failed" | "completed";
      generated_at: Date | string | null; failure: { code: string; retryable: boolean } | null;
      evidence_mode: "simulated" | "participant" | "mixed";
    }>(
      `SELECT step,version_number,title,markdown,status,generated_at,failure,evidence_mode
         FROM digital_interview_artifact_versions
        WHERE org_id=$1 AND interview_id=$2 AND revision_id=$3`,
      [input.orgId, input.interviewId, current.revision_id],
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
          material_context_pack_id,material_version,category,bio,location,typical_advice,
          age,occupation,goals,interests,pain_points,motivations,influences,personality_traits,service_value)
       SELECT org_id,$3,expert_id,agent_definition_id,agent_version,ordinal,initials,display_name,role,domains,
              material_context_pack_id,material_version,category,bio,location,typical_advice,
              age,occupation,goals,interests,pain_points,motivations,influences,personality_traits,service_value
         FROM digital_interview_expert_candidates
        WHERE org_id=$1 AND revision_id=$2`,
      [input.orgId, current.revision_id, revisionId],
    );

    if (input.nodeName !== "confirm_brief" && input.nodeName !== "confirm_topic") {
      const topic = previousTopic.rows[0]?.topic;
      if (!topic) throw new DigitalInterviewWorkflowError("DIGITAL_INTERVIEW_STEP_INVALID");
      await session.query(
        `INSERT INTO digital_interview_topic_versions
           (org_id,id,interview_id,revision_id,version_number,topic,is_current,created_by)
         VALUES ($1,$2,$3,$4,1,$5,true,$6)`,
        [input.orgId, this.ids.next("itv-topic"), input.interviewId, revisionId, topic, input.actorId],
      );
      await session.query(
        `INSERT INTO digital_interview_research_briefs
           (org_id,id,interview_id,revision_id,brief,rule_version,request_id,created_by)
         SELECT org_id,$4,interview_id,$3,brief,rule_version,$5,$6
           FROM digital_interview_research_briefs WHERE org_id=$1 AND revision_id=$2`,
        [input.orgId, current.revision_id, revisionId, this.ids.next("itv-brief"),
          `${input.command.requestId}:branch-brief`, input.actorId],
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
             (org_id,revision_id,question_id,expert_id,ordinal,body,purpose,section,goal_ids)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [input.orgId, revisionId, question.question_id, question.expert_id,
            ordinal, question.body, question.purpose, question.section, question.goal_ids],
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
              initials,display_name,role,domains,material_context_pack_id,material_version,
              category,bio,location,typical_advice,age,occupation,goals,interests,pain_points,
              motivations,influences,personality_traits,service_value)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
          [input.orgId, expertVersionId, expert.expert_id, expert.agent_definition_id,
            expert.agent_version, expert.ordinal, expert.initials, expert.display_name,
            expert.role, expert.domains, expert.material_context_pack_id, expert.material_version,
            expert.category, expert.bio, expert.location, expert.typical_advice, expert.age, expert.occupation,
            expert.goals, expert.interests, expert.pain_points, expert.motivations, expert.influences,
            expert.personality_traits, expert.service_value],
        );
      }
    }
    const inheritedSteps = input.nodeName === "confirm_experts"
      ? new Set(["intake", "analysis"])
      : input.nodeName === "confirm_questions"
        ? new Set(["intake", "analysis", "experts"])
        : new Set<string>();
    for (const artifact of previousArtifacts.rows.filter((candidate) => inheritedSteps.has(candidate.step))) {
      await session.query(
        `INSERT INTO digital_interview_artifact_versions
           (org_id,artifact_id,interview_id,revision_id,step,version_number,title,markdown,status,generated_at,failure,evidence_mode)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [input.orgId, this.ids.next("itv-artifact"), input.interviewId, revisionId, artifact.step,
          artifact.version_number, artifact.title, artifact.markdown, artifact.status,
          artifact.generated_at, artifact.failure, artifact.evidence_mode],
      );
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
    const submittedPatch = command.kind === "confirm_brief" || command.kind === "confirm_topic"
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
          AND ${DIGITAL_INTERVIEW_ACTOR_VISIBILITY}
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

  private async appendConfirmedArtifact(session: TenantSession, input: {
    readonly orgId: OrgId; readonly interviewId: string; readonly revisionId: string; readonly actorId: string;
    readonly nodeName: ConfirmationNodeName;
    readonly command: CommitDigitalInterviewStepInput["command"];
  }): Promise<void> {
    const artifacts = input.command.kind === "confirm_brief"
      ? [
        { step: "intake", title: "需求说明.md", markdown: `# 需求说明\n\n${input.command.topic}` },
        { step: "analysis", title: "分析建议.md", markdown: `# 分析建议\n\n## 决策\n\n${input.command.researchBrief.decision}\n\n## 学习目标\n\n${input.command.researchBrief.learningGoals.map((goal) => `- ${goal.statement}`).join("\n")}\n\n## 目标角色\n\n${input.command.researchBrief.targetRoles.map((role) => `- ${role}`).join("\n")}` },
      ]
      : input.command.kind === "confirm_topic"
        ? [{ step: "intake", title: "需求说明.md", markdown: `# 需求说明\n\n${input.command.topic}` }]
        : input.command.kind === "confirm_experts"
          ? [{ step: "experts", title: "专家建议.md", markdown: `# 专家建议\n\n${input.command.expertIds.map((id) => `- ${id}`).join("\n")}` }]
          : [{ step: "outline", title: "访谈提纲.md", markdown: `# 访谈提纲\n\n${input.command.questions.map((question) => `- ${question.text}`).join("\n")}` }];
    for (const artifact of artifacts) await session.query(
      `INSERT INTO digital_interview_artifact_versions
         (org_id,artifact_id,interview_id,revision_id,step,version_number,title,markdown,status,generated_at,failure,evidence_mode)
       SELECT $1,$2,$3,$4,$5,coalesce(max(version_number),0)+1,$6,$7,'confirmed',now(),NULL,'simulated'
         FROM digital_interview_artifact_versions
        WHERE org_id=$1 AND interview_id=$3 AND revision_id=$4 AND step=$5`,
      [input.orgId, this.ids.next("itv-artifact"), input.interviewId, input.revisionId, artifact.step, artifact.title, artifact.markdown],
    );
  }
}
