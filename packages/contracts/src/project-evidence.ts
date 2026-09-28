/**
 * 项目中枢 B3-T1 —— 证据归一化（原十轮计划第 6 轮）。
 *
 * 五类来源（chat 消息 / 附件 / 问卷答卷 / 访谈片段 / 转写片段 / 深研来源）统一成**一种可追溯的证据单元**：
 * 谁说的、在哪一份材料的哪个位置、摘录多长、现在还在不在。项目大脑的结论只引用这种单元，
 * 不再直接引用「某条 chat 消息」。
 *
 * ## 单一事实源
 *   · `ProjectEvidenceSourceKind` 是**唯一**一处来源枚举——`chat-knowledge-graph.ts` 的 `KgEvidenceAnchor.sourceKind`
 *     从这里引用（不复述）；`project.ts` 的 `ProjectAiSourceKind`（设置页「AI 权限」五类开关）是它的**粗粒度投影**，
 *     `PROJECT_EVIDENCE_TO_AI_SOURCE` 把每种证据来源映射到一个开关，映射也只在这里一份。
 *   · 读端点只读：证据单元由各来源的写路径（B3-T2 的入图）产生，这里没有 create。
 */
import { z } from "zod";

export const ProjectEvidenceSourceKind = z.enum([
  "chat_message",
  "attachment",
  "survey_response",
  "interview_segment",
  "transcript_segment",
  "research_source",
]);
export type ProjectEvidenceSourceKind = z.infer<typeof ProjectEvidenceSourceKind>;

/** 每种证据来源落在设置页「AI 权限」的哪个开关（`project.ProjectAiSourceKind`）。只此一份。 */
export const PROJECT_EVIDENCE_TO_AI_SOURCE = {
  chat_message: "chat",
  attachment: "chat",
  survey_response: "survey",
  interview_segment: "interview",
  transcript_segment: "transcript",
  research_source: "research",
} as const satisfies Record<ProjectEvidenceSourceKind, "chat" | "transcript" | "survey" | "interview" | "research">;

export const PROJECT_EVIDENCE_SOURCE_LABEL_ZH: Record<ProjectEvidenceSourceKind, string> = {
  chat_message: "对话",
  attachment: "附件",
  survey_response: "问卷答卷",
  interview_segment: "访谈片段",
  transcript_segment: "转写片段",
  research_source: "深研来源",
};

/** 定位到材料内部的位置：只填有意义的字段；消息类为空对象。 */
export const ProjectEvidenceLocator = z.object({
  page: z.number().int().positive().optional(),
  startMs: z.number().int().nonnegative().optional(),
  endMs: z.number().int().nonnegative().optional(),
  /** 问卷题号 / 访谈问题序号 / 转写段序号 */
  ordinal: z.number().int().nonnegative().optional(),
}).strict();

export const ProjectEvidenceItem = z.object({
  /** 证据单元 id（`ev_…`），结论的 `KgEvidenceAnchor.evidenceId` 指向它 */
  id: z.string().min(1),
  projectId: z.string(),
  sourceKind: ProjectEvidenceSourceKind,
  /** 所属资源：chat_message → threadId；survey_response → surveyId；interview_segment → interviewSessionId；
   *  transcript_segment → transcriptionId；research_source → guidedResearchSessionId；attachment → artifactId */
  resourceId: z.string(),
  /** 来源内的具体引用：messageId / responseId / segmentId / sourceId / artifactVersionId */
  sourceRef: z.string(),
  /** 可读摘录（≤ 280 字），不是全文 */
  excerpt: z.string().max(280),
  locator: ProjectEvidenceLocator,
  /** 说这句话的人（受访者 / 答题人 / 发言人）；匿名答卷为 null */
  speakerLabel: z.string().nullable(),
  /** 材料的标题（线程标题 / 问卷标题 / 访谈标题 …），列表直接可读 */
  resourceTitle: z.string(),
  /** 源已删除 / 撤回时为 true——列表默认不含，`includeRevoked` 才带出 */
  revoked: z.boolean(),
  /** ISO 8601：证据单元建立时间（不是材料时间） */
  createdAt: z.string(),
}).strict();
export type ProjectEvidenceItem = z.infer<typeof ProjectEvidenceItem>;

export const ProjectEvidenceReason = z.enum(["NO_PROJECT_ROLE", "AUTH_SERVICE_UNAVAILABLE", "EVIDENCE_NOT_FOUND"]);

export const operations = {
  /**
   * 项目的证据库：五类来源归一后的单元，按时间倒序，可按来源过滤。任何项目成员（含观察者）可读；
   * 非成员 `NO_PROJECT_ROLE`（与容器不存在不可分辨）。
   */
  listProjectEvidence: {
    method: "GET",
    path: "/projects/:projectId/evidence",
    in: z.object({
      projectId: z.string(),
      sourceKind: ProjectEvidenceSourceKind.optional(),
      includeRevoked: z.boolean().optional(),
      limit: z.number().int().min(1).max(200).optional(),
      cursor: z.string().optional(),
    }).strict(),
    out: z.object({
      items: z.array(ProjectEvidenceItem),
      nextCursor: z.string().nullable(),
      /** 各来源计数（含被 AI 权限关掉的来源，界面据此标「已关闭」） */
      countsBySource: z.record(ProjectEvidenceSourceKind, z.number().int().nonnegative()),
    }).strict(),
    err: ["NO_PROJECT_ROLE", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },
  /** 单条证据回链：从结论的证据锚点跳回原材料时用；不存在或不可见同一个 `EVIDENCE_NOT_FOUND`。 */
  getProjectEvidence: {
    method: "GET",
    path: "/projects/:projectId/evidence/:evidenceId",
    in: z.object({ projectId: z.string(), evidenceId: z.string() }).strict(),
    out: ProjectEvidenceItem,
    err: ["NO_PROJECT_ROLE", "EVIDENCE_NOT_FOUND", "AUTH_SERVICE_UNAVAILABLE"] as const,
  },
} as const;
