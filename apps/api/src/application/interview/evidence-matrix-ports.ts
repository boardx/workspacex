/**
 * Ports for F02（phase-11）—— `getEvidenceMatrix` 读路径 + 观察者脱敏投影。
 *
 * ⚠ 与 `insight-ports.ts` 分开成独立文件：那个文件是 F01 写路径的端口集，这里是
 * F02 只读投影专用的两个端口，互不修改对方的形状——`InsightRepository` 只管
 * `confirm`/`getById` 两个写路径动词，不天然长出"跨很多 interviewId 批量取证据"
 * 这个读端形状，硬塞进去会让写端口背上一个只有读端需要的方法。
 */
import type { OrgId } from "../../domain/org-id";
import type { Guarded } from "../security/permission-filter";

/* ─────────────────────────── 证据行（getEvidenceMatrix 的读端组装原料） ─────────────────────────── */

/**
 * 一条已确认洞察、经它固化的来源快照，展开成的一行证据事实。
 *
 * ⚠ `rqId` 在这里被借用为 `themeId` 的代理键——F01 的持久化表没有独立的「主题」实体
 * （`mergeThemes`/`splitThemes` 留给 F04，本阶段不提前发明一张 `themes` 表）；
 * `generateCandidateInsights` 默认实现本就按 `rqId` 分组候选（见 `insight-ports.ts`
 * `CandidateInsightGenerator` 头注「确定性启发式，按 rqId 分组」），复用同一个维度
 * 作矩阵的行键是这份数据里唯一现成的「主题状分组」，不是凭空发明。`rqId === null`
 * 时用 `UNTHEMED_ROW_ID`（见 `get-evidence-matrix.ts`）兜底成一个显式的字符串键。
 *
 * `strong` 取自这条证据所属洞察的 `interview_insights.strong`——**不是**逐条证据自己
 * 的强度；一条洞察标强，它名下全部证据在矩阵里都按 `strong` 计（F03 `markStrongInsight`
 * 落地前，新入库洞察恒 `strong=false`，矩阵因此恒显示 `weak`，这是如实反映现状，
 * 不是本读端自己压低了它）。
 */
export interface EvidenceQuoteRow {
  readonly interviewId: string;
  /** `null` = 该引述抽取时没能解析出说话人；矩阵按受访者分列，这类行无法落入任何格子。 */
  readonly subjectId: string | null;
  readonly rqId: string | null;
  readonly quoteId: string;
  readonly strong: boolean;
}

export interface EvidenceMatrixReader {
  /**
   * 给定一批（已经过调用方可见性过滤的）`interviewId`，取它们名下全部**已确认洞察**
   * 的证据行。`interviewIds` 为空数组时约定返回空数组（调用方在拿到空 scope 时应先
   * 短路，不依赖这里再判一次）。
   *
   * ⚠ 返回 `Guarded<EvidenceQuoteRow>`，不是裸行——`interview_insights`/
   * `interview_insight_source_snapshots` 都是租户表，`lint-permission-paths.mjs` 要求
   * `infrastructure/` 下任何读它们的文件走 `permission-filter` 这道正门
   * （`pg-interview-insight-repository.ts` 豁免条目的原话「F02 落地时若接到真实读接口，
   * 必须改走 guard()/discloseDecided()」）。`ref.kind: "interview"` 与
   * `pg-interview-scope-repository.ts` 的 `toGuarded` 同型：这个 ACL kind 没有
   * `acl_bindings` 行，不能走通用 `authorize()`（`toAclRef` 对它显式 throw），调用方必须
   * 用 `decideInterviewVisibility` 现判、`discloseDecided` 取出载荷——`get-evidence-matrix.ts`
   * 复用的正是收集 `interviewIds` 那一遍已经算出的同一份事实，不重新查一次。
   */
  listConfirmedEvidence(
    orgId: OrgId,
    interviewIds: readonly string[],
  ): Promise<readonly Guarded<EvidenceQuoteRow>[]>;
}

export const EVIDENCE_MATRIX_READER = Symbol("EvidenceMatrixReader");

/* ─────────────────────────── 观察者脱敏所需的项目角色 ─────────────────────────── */

/**
 * 看的人在给定项目里的角色；不是该项目成员则为 `null`。
 *
 * 与 `pg-interview-subject-repository.ts` 的 `viewerContextForGroup` 是同一份事实
 * （`project_memberships.project_role`）的第二次读取入口，而不是重新声明——那个方法
 * 按 `groupId` 查，本端口按 `getEvidenceMatrix` 唯一持有的 `scope.projectId` 直查，
 * 两者查的是同一张表、同一批行，只是 join 的起点不同。
 */
export interface ProjectRoleReader {
  roleOf(
    orgId: OrgId,
    userId: string,
    projectId: string,
  ): Promise<"facilitator" | "groupLead" | "member" | "observer" | null>;
}

export const PROJECT_ROLE_READER = Symbol("ProjectRoleReader");
