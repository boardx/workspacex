/**
 * 把「两种投影」变成一个 `PermissionDecision` —— 供 `discloseDecided` 使用。
 *
 * ## 为什么要有这一步，明明 SQL 已经过滤过了
 *
 * 因为那条 SQL 谓词和 `canRead` 是**同一条规则的两次声明**。
 * 两份声明必然漂移，这是本项目栽过五次的事。测试能在 CI 里发现漂移，
 * 但运行时不会 —— 除非运行时也拿另一份声明再判一次。
 *
 * 所以流程是：SQL 过滤（服务端过滤，V2 的要求）→ 回来的每一行连同**判定所需的事实**
 * 一起被 `guard()` 包住 → 在这里用纯函数 `canRead` **重新判一次** → 只有两次都说可见的
 * 才被 `discloseDecided` 解开。SQL 若哪天漏掉一条，那一行会被这里扣下而不是发出去。
 *
 * 这不是重复劳动，是「唯一的门」这条架构约束的落点：
 * `lint-permission-paths` 要求任何披露租户内容的仓储都经 `permission-filter`，
 * 而 `permission-filter` 的 `disclose()` 走 `acl_bindings` —— 访谈没有绑定行，
 * 走那条路会对全组织放行（见 `toAclRef` 的 interview 分支）。
 * 于是走的是「一道门、两个判定来源」里的第二个来源。
 *
 * ## ⚠ `reasonCode` 是本文件唯一一处将就（已在报告里列为契约缺口）
 *
 * `identity.PermissionReason` 是封闭八值，**没有**「不是这场访谈的创建者也不是协作者」
 * 这个成员。这里取 `NO_PROJECT_ROLE` —— usecases.md 明写它「是正常状态不是异常」，
 * 语义上最接近「你不持有能够到这场访谈的角色」。
 *
 * 它**不会到达调用方**：控制器把 `NO_INTERVIEW_ACCESS` 映成不带 reasonCode 的裸 404
 * （否则「无权」与「不存在」就可分辨了）。所以这是一个纯内部标签。
 * 即便如此也不该编一个新字符串塞进封闭枚举 —— 那正是那个枚举存在的理由。
 */
import type { PermissionDecision } from "../identity/permission-decision";
import type { OrgRole } from "../identity/roles";
import { canRead, type InterviewVisibilityFacts, type ViewerFacts } from "./scope";

export interface InterviewDecisionInput {
  readonly decisionId: string;
  readonly interview: InterviewVisibilityFacts;
  readonly viewer: ViewerFacts;
  /** 看的人在该组织的角色。null = 不是成员（此时无论如何都看不见）。 */
  readonly orgRole: OrgRole | null;
  readonly viewerTeamId: string | null;
}

export function decideInterviewVisibility(input: InterviewDecisionInput): PermissionDecision {
  const orgPassed = input.orgRole !== null;
  const visible = orgPassed && canRead(input.interview, input.viewer);

  return {
    allowed: visible,
    orgLayer: { role: input.orgRole, teamId: input.viewerTeamId, passed: orgPassed },
    /**
     * ⚠ `projectLayer === null` 与 `projectLayer.role === null` 含义不同，这里正好用上：
     * · 访谈无项目 ⇒ **没有项目上下文**（I-11）⇒ 整个 projectLayer 为 null。
     * · 访谈有项目 ⇒ 有上下文；`passed` 表示「看的人是不是该项目成员」。
     *   注意 `role` 恒为 null —— 本判定只需要「是不是成员」，不需要是哪一种角色
     *   （R5：项目负责人不因职位获得额外读权，所以四种角色在这里**同权**）。
     *   编一个角色填进去会让人以为这里做了角色区分。
     */
    projectLayer:
      input.interview.projectId === null
        ? null
        : {
            role: null,
            groupId: null,
            passed: input.viewer.projectIds.includes(input.interview.projectId),
          },
    /**
     * 访谈没有 `acl_bindings` 行，所以可见性范围这一层不适用。
     * `org-wide` 是 `authorize.ts` 对「无绑定行对象」的同一个既定默认（`DEFAULT_SCOPE`），
     * 取同一个值是为了不引入第二套默认；`passed: orgPassed` 而不是恒 true，
     * 是因为不是组织成员时这一层同样没过。
     */
    scopeLayer: { scope: "org-wide", passed: orgPassed },
    reasonCode: visible ? null : orgPassed ? "NO_PROJECT_ROLE" : "NO_ORG_MEMBERSHIP",
    decisionId: input.decisionId,
  };
}
