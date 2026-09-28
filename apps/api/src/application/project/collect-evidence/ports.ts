/**
 * 项目中枢 B3-T1（#4495）—— 采集器的只读来源端口。
 *
 * 四个采集器（问卷 / 访谈 / 转写 / 深研）只读「挂在某项目上的资源」里的原材料，写成证据单元
 * （`ProjectEvidencePort.upsert`）。原材料是租户内容，所以每个读都回 `Guarded<T>`：采集用例拿着
 * 调用方交出的判定（挂载时是用户对项目的 `read.published`；B3-T2 入图时是它自己的项目主体判定）
 * `discloseDecided()` 之后才碰得到内容。
 *
 * 表与列名全部只在 `infrastructure/project/pg-evidence-sources.ts` 一处出现；这里只描述形状。
 */
import type { OrgId } from "../../../domain/org-id";
import type { Guarded } from "../../security/permission-filter";

export const EVIDENCE_SOURCE_REPOSITORY = Symbol("ProjectEvidenceSourceRepository");

/** 一份挂在项目上的问卷：标题 + 题目（id → 标题 / 序号）+ 答卷。答题人一律匿名（`speakerLabel` 为 null）。 */
export interface SurveySourceDoc {
  readonly surveyId: string;
  readonly title: string;
  readonly questions: readonly { readonly id: string; readonly title: string; readonly order: number }[];
  readonly responses: readonly {
    readonly id: string;
    /** `excluded` = 被排除出分析的答卷，不采。 */
    readonly analysis: "included" | "excluded";
    readonly answers: readonly { readonly questionId: string; readonly value: unknown }[];
  }[];
}

/** 一段转写：来自 `recording_segments`（个人转写与访谈共用同一形状）。 */
export interface TranscriptSegmentSource {
  readonly segmentId: string;
  readonly ordinal: number;
  readonly startMs: number | null;
  readonly endMs: number | null;
  readonly speakerLabel: string | null;
  readonly text: string;
}

export interface TranscriptionSourceDoc {
  readonly transcriptionId: string;
  readonly title: string;
  readonly segments: readonly TranscriptSegmentSource[];
}

/** 一场访谈：转写段（录音）+ 纪要引述（`interview_quotes`，带已解析的受访者名）。 */
export interface InterviewSourceDoc {
  readonly interviewId: string;
  readonly title: string;
  readonly segments: readonly TranscriptSegmentSource[];
  readonly quotes: readonly { readonly quoteId: string; readonly speakerLabel: string | null; readonly text: string }[];
}

/** 一个深研会话：已接受（`decision = accepted`）的来源。 */
export interface ResearchSourceDoc {
  readonly sessionId: string;
  readonly title: string;
  readonly sources: readonly {
    readonly sourceId: string;
    readonly title: string;
    readonly url: string;
    /** 优先取模型整理的一句摘要，没有就取正文开头。 */
    readonly summary: string;
  }[];
}

export interface ProjectEvidenceSourcePort {
  /** 经 `project_resource_links (kind = survey)` 挂在项目上的问卷。项目不存在 ⇒ `[]`（存在性由调用方另判）。 */
  surveysOf(orgId: OrgId, projectId: string): Promise<Guarded<readonly SurveySourceDoc[]>>;
  /** 经 `project_resource_links (kind = personal_transcription)` 挂在项目上的个人转写及其最终段。 */
  transcriptionsOf(orgId: OrgId, projectId: string): Promise<Guarded<readonly TranscriptionSourceDoc[]>>;
  /** `interview_sessions.project_id = projectId` 的访谈（含已归档）及其转写段与纪要引述。 */
  interviewsOf(orgId: OrgId, projectId: string): Promise<Guarded<readonly InterviewSourceDoc[]>>;
  /** 经 `project_resource_links (kind = guided_research)` 挂在项目上的深研会话及其已接受来源。 */
  researchSessionsOf(orgId: OrgId, projectId: string): Promise<Guarded<readonly ResearchSourceDoc[]>>;
  /**
   * chat 消息回填用：这个会话属于哪个项目（`chat_threads.project_id`）与它的标题。个人线程 ⇒ `null`。
   * 只回容器归属 + 线程标题，不回消息正文——正文已经在抽取批次里（由 `pg-kg-extraction.ts` 的豁免路径读出）。
   */
  chatThreadProject(orgId: OrgId, threadId: string): Promise<{ readonly projectId: string; readonly title: string } | null>;
}
