/**
 * Ports for the interview subject model (F97).
 *
 * ## 为什么仓储接口把「同意位」与「对象记录」拆成两个方法族
 *
 * `SubjectRepository` 只管六列中能落盘的五列；`ConsentSubmissionStore` 只管同意书事实。
 * 两者故意不揉进同一个方法里——如果 `SubjectRepository.findById` 顺手把「当前状态」
 * 也算出来一起返回，下一个人很容易在某个调用点缓存这个返回值再传来传去，
 * 状态就从「每次现算」退化成「曾经算过一次的快照」。派生必须发生在读的那一刻，
 * 所以调用方（两处投影的 use case）总是分别拿 record 与 bits，再各自调
 * `deriveConsentStatus`——同一个纯函数，两处投影因此不可能算出两种答案。
 *
 * ## 为什么三个多人可读的方法返回 `Guarded<T>`，`create`/`update` 不返回
 *
 * `listByGroup` / `listByInterviewSession` / `findById` 是「别人也可能读到这一行」的
 * 路径，必须经 `permission-filter` 那道唯一的门（R5：观察者不可读对象表）。
 * `create` / `update` 只把**调用者刚写下的那一行**原样回显给他自己——与
 * `pg-project-repository.ts`（F117）的豁免同型：向 `disclose()` 问「这个人能不能读
 * 他这一刻正在写的行」没有答案，所以这两个方法直接返回 `SubjectRecord`。
 */
import type { OrgId } from "../../domain/org-id";
import type { ConsentBits, SubjectMode, SubjectRecord } from "../../domain/interview/subject";
import type { SubjectVisibilityFacts } from "../../domain/interview/subject-visibility";
import type { SealedContact } from "../../domain/interview/contact-vault";
import type { Guarded } from "../security/permission-filter";

export interface CreateSubjectInput {
  readonly orgId: OrgId;
  readonly displayName: string;
  readonly roleTitle: string;
  readonly orgName: string | null;
  readonly groupId: string | null;
  /** 明文，仅供写入时算掩码/密文；仓储实现绝不应把它原样回显。 */
  readonly contact: string | null;
  readonly sourceKind: "human" | "virtual";
  readonly mode?: SubjectMode;
  readonly backgroundAndQuestions?: string;
  readonly createdBy: string;
}

export interface UpdateSubjectInput {
  readonly orgId: OrgId;
  readonly subjectId: string;
  readonly displayName: string | null;
  readonly roleTitle: string | null;
  readonly orgName: string | null;
  readonly groupId: string | null;
  readonly contact: string | null;
  readonly backgroundAndQuestions?: string | null;
  readonly mode?: SubjectMode | null;
}

/** 一行「已从库里取出、但还没对任何人解封」的对象。见文件头。 */
export interface GuardedSubjectRow {
  readonly item: Guarded<SubjectRecord>;
  readonly facts: SubjectVisibilityFacts;
}

export interface SubjectRepository {
  create(input: CreateSubjectInput): Promise<SubjectRecord>;

  /**
   * ⚠ `null` 字段＝「这次不改这一列」，不是「把这一列清空」——与契约的
   * `updateSubject.in` 逐字段可空是同一个约定（`orgName`/`groupId`/`contact` 例外，
   * 它们的契约类型本就允许写 `null` 来清空；`displayName`/`roleTitle` 的 `null`
   * 只表示不改，因为这两列有 `NOT NULL` 约束，契约也没给它们提供清空的语义）。
   */
  update(input: UpdateSubjectInput): Promise<SubjectRecord>;

  findGuardedById(orgId: OrgId, subjectId: string): Promise<GuardedSubjectRow | null>;

  /** 项目侧组卡投影：按 `groupId` 取。 */
  listByGroup(orgId: OrgId, groupId: string): Promise<GuardedSubjectRow[]>;

  /**
   * 访谈侧受访者名单投影：按 `interviewSessionId` 经 `interview_session_subjects` 取。
   * 与 `listByGroup` 走的是**同一张 `interview_subjects` 表**，不是各自查询一份数据。
   */
  listByInterviewSession(orgId: OrgId, interviewSessionId: string): Promise<GuardedSubjectRow[]>;

  /**
   * 把对象排进某场访谈的名单（对应 domain.md `InterviewSession.requiredSubjectIds`）。
   * ⚠ 这不是一个公开契约操作——UC-6.2 三步向导（F84）建成后，「选对象」这一步
   * 会调这个方法；F97 只把它需要的关联结构建出来，不建向导本身。
   */
  attachToSession(orgId: OrgId, interviewSessionId: string, subjectId: string, addedBy: string): Promise<void>;

  /**
   * 看的人在某个组所属项目里的角色 + 组织角色。判定的输入，不是内容
   * （与 `InterviewScopeRepository.orgMembershipOf`/`projectIdsOf` 同一类方法）。
   * `groupId === null` 时调用方不应调用本方法——未归组对象的可见性只看创建者。
   */
  viewerContextForGroup(
    orgId: OrgId,
    userId: string,
    groupId: string,
  ): Promise<{
    readonly orgRole: string | null;
    readonly teamId: string | null;
    readonly projectRole: "facilitator" | "groupLead" | "member" | "observer" | null;
  }>;

  /** 看的人在该组织的角色 + 团队（未归组对象走这个，不查项目角色）。 */
  orgMembershipOf(orgId: OrgId, userId: string): Promise<{ orgRole: string | null; teamId: string | null }>;

  /**
   * 按机构名（`orgName`）在**整个组织**范围内查历史对象（F98，`[AI 建议人选]`
   * 的启发式种子——见 `in-memory-candidate-store.ts` 的 `HistoryBasedCandidateSuggester`
   * 文件头）。⚠ 与 `listByGroup`/`listByInterviewSession` 一样必须经 `guard()` 出门——
   * 这是"别人也可能读到这一行"的第三条路径，不能因为它服务于生成建议就绕过 R5。
   */
  listByOrgName(orgId: OrgId, orgName: string): Promise<GuardedSubjectRow[]>;

  /**
   * 按项目取该项目**所有组**的对象（F98，`exportSubjects`）。经 `groups.project_id`
   * 关联——对象表本身没有 `project_id` 列（R3-9：对象只挂 `group_id`，项目归属是
   * 经组间接的），所以这是一次 JOIN，不是在 `interview_subjects` 上加一列重复声明
   * 项目归属（那会是"同一事实两处"的第六次）。
   */
  listByProjectScope(orgId: OrgId, projectId: string): Promise<GuardedSubjectRow[]>;

  /**
   * 取一行的**已加密**联系方式，供 `revealContact`（F98）判定后解密。
   *
   * ⚠ 与 `findGuardedById` 分开而不是复用：那个方法的 `SubjectRecord` 恒返回
   * `contactMask`（掩码），从不带 `SealedContact`——多一条从「读对象行」到「拿到密文」
   * 的旁路，`contactMask` 恒等于遮盖这条不变量就不再是接口形状能保证的了，得靠人记得
   * 不要在别处解构 `sealedContact`。拆成单独方法，调用方只有 `reveal-contact.ts` 一处。
   * `sealed === null` ＝ 该对象从未录入过联系方式。
   */
  findContactForReveal(
    orgId: OrgId,
    subjectId: string,
  ): Promise<{ readonly facts: SubjectVisibilityFacts; readonly sealed: SealedContact | null } | null>;
}

export const SUBJECT_REPOSITORY = Symbol("SubjectRepository");

export interface ConsentSubmissionStore {
  /**
   * 该 (interviewSessionId, subjectId) 组合下**最新一次**提交；从未提交则载荷为 `null`。
   * ⚠ 返回 `Guarded<...>` 而不是裸值——同意位揭示的是这个人对 AI 分析/署名的选择，
   * 与对象记录本身同等敏感。调用方（`subject-projections.ts`）必须复用**同一个**
   * 已经对该 `subjectId` 算过的 `PermissionDecision` 来解封，而不是另起一次判定：
   * 同一条对象记录、同一个人，可见性只应该被判一次。
   */
  latestFor(orgId: OrgId, interviewSessionId: string, subjectId: string): Promise<Guarded<ConsentBits | null>>;

  /**
   * 同 `latestFor`，另加**提交时间**（F87 / 只读镜像需要展示"本人选择 + 提交时间"，
   * uc-6-3 R6）。拆成第二个方法而不是改 `latestFor` 的返回形状——`latestFor` 已被
   * `subject-projections.ts` 的两处投影调用并有回归测试锁住其返回类型
   * （`consent-status-single-source.test.ts`），改签名会牵连与本 feature 无关的代码。
   */
  latestSubmissionMeta(
    orgId: OrgId,
    interviewSessionId: string,
    subjectId: string,
  ): Promise<Guarded<{ readonly bits: ConsentBits; readonly submittedAt: Date } | null>>;

  /**
   * 追加一条提交（I-16 append-only）。
   * ⚠ 同样不是公开契约操作——签署令牌、门户、渲染快照（F86/F87）建成后，
   * `submitConsent` 会调这个方法；F97 只钉死「同意位事实存在这一张表」，
   * 不建完整的授权分发流程。
   */
  submit(orgId: OrgId, interviewSessionId: string, subjectId: string, bits: ConsentBits): Promise<void>;
}

export const CONSENT_SUBMISSION_STORE = Symbol("ConsentSubmissionStore");
