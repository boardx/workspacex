/**
 * Ports for the interview scope model (F80).
 *
 * ## 端口形状本身就是那条不变量
 *
 * `listVisible` 收的是 `viewerUserId`，**不收「先取全量再交给我过滤」的余地**：
 * 它没有一个「取全部」的重载，也没有一个返回未过滤集合的方法。
 * 这是刻意的 —— V2 的验收线索是「列表不返回再前端过滤」，
 * 而让实现有办法拿到全量，就是让下一个人有办法在 JS 里过滤。
 *
 * 计数同理：`counts` 由**实现方**在同一次过滤后的查询里算出来，不是把行拉回来 `filter().length`。
 * 若 counts 走内存，那么「真人 N / 虚拟 M」这两个数就依赖于分页有没有把行取全 ——
 * 第二页之后它会静默地变小，而没有任何东西会红。
 */
import type { OrgId } from "../../domain/org-id";
import type {
  InterviewSourceKindName,
  InterviewVisibilityFacts,
  ScopeSelector,
} from "../../domain/interview/scope";
import type { Guarded } from "../security/permission-filter";

/** 一行访谈的存储形态。字段是 `interview.InterviewRow` 的来源，但不重声明那个契约类型。 */
export interface StoredInterviewRow {
  readonly interviewId: string;
  readonly title: string;
  readonly sourceKind: InterviewSourceKindName;
  readonly projectId: string | null;
  readonly researchProjectId: string | null;
  readonly tags: readonly string[];
  readonly archived: boolean;
  readonly whenAt: string | null;
}

export interface ListVisibleInput {
  readonly orgId: OrgId;
  readonly viewerUserId: string;
  readonly scope: ScopeSelector;
  readonly filters?: { readonly tags?: readonly string[] | null; readonly archived?: boolean | null };
  readonly limit: number;
  readonly cursor?: string;
}

/**
 * 一行「已从库里取出、但还没对任何人解封」的访谈。
 *
 * `item` 是 `Guarded<T>` —— 拿不到载荷，除非经 `discloseDecided` 给出一个判定。
 * `facts` 是**做那个判定所需的输入**，不是内容：它只随着已经通过 SQL 过滤的行一起回来，
 * 所以它本身不构成第二条泄露路径。
 *
 * 两者分开而不是把 facts 塞进载荷里：facts 必须在解封**之前**可读，
 * 否则判定就得先解封再判，那正好是这道门要杜绝的顺序。
 */
export interface GuardedInterviewRow {
  readonly item: Guarded<StoredInterviewRow>;
  readonly facts: InterviewVisibilityFacts;
}

export interface ListVisiblePage {
  readonly rows: readonly GuardedInterviewRow[];
  readonly nextCursor: string | null;
  /** ⚠ 两个独立字段，不得合并（D-25 / V5）。在**过滤后**的集合上统计，且不受分页影响。 */
  readonly counts: { readonly human: number; readonly virtual: number };
}

export interface InterviewScopeRepository {
  /** 服务端过滤：可见性谓词在 SQL 里，返回的每一行都是调用者有权看的。 */
  listVisible(input: ListVisibleInput): Promise<ListVisiblePage>;

  /**
   * 按 ID 直读，**同样只在可见时返回**。
   *
   * 返回 `null` 同时表示「不存在」与「无权」—— 调用方因此无法把两者做成两种响应，
   * 而这正是 uc-6-0/E3 要的：拒绝响应不得泄露资源是否存在。
   * 若这里返回 `{ exists: true, allowed: false }` 之类的结构，那个枚举探测面就重新打开了。
   */
  findVisibleById(orgId: OrgId, viewerUserId: string, interviewId: string): Promise<GuardedInterviewRow | null>;

  /** 该组织内此人有成员身份的项目 id。供第二种投影与 `SCOPE_NOT_VISIBLE` 判定使用。 */
  projectIdsOf(orgId: OrgId, userId: string): Promise<string[]>;

  /** 该组织角色 + 团队。判定的组织层输入，不是内容。 */
  orgMembershipOf(
    orgId: OrgId,
    userId: string,
  ): Promise<{ orgRole: string | null; teamId: string | null }>;
}

export const INTERVIEW_SCOPE_REPOSITORY = Symbol("InterviewScopeRepository");
