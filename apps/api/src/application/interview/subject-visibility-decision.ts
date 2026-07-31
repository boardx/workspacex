/**
 * 把 `canReadSubject` 变成一个 `PermissionDecision`，供 `discloseDecided` 使用。
 *
 * 与 `interview` 束的 `visibility-decision.ts` 同一手法、同一理由：一个访谈对象
 * 没有 `acl_bindings` 行（它不是项目/产出/切片三者之一），所以它走的是「一道门、
 * 两个判定来源」里绕开 `authorize()` 的那一条——`toAclRef` 对 `subject` 这个
 * `ObjectRef.kind` 直接抛错，逼着调用方走这里。
 *
 * ⚠ 与 F80 的访谈可见性不同，本判定还需要**项目层**（R5「观察者不可读对象表」
 * 只有项目成员才谈得上是不是观察者），所以 `projectLayer` 在对象已归组时非空。
 */
import type { PermissionDecision } from "../../domain/identity/permission-decision";
import type { OrgRole, ProjectRole } from "../../domain/identity/roles";
import {
  canReadSubject,
  type SubjectViewerFacts,
  type SubjectVisibilityFacts,
} from "../../domain/interview/subject-visibility";

export interface SubjectDecisionInput {
  readonly decisionId: string;
  readonly subject: SubjectVisibilityFacts;
  readonly viewer: SubjectViewerFacts;
  /** 看的人在该组织的角色。null = 不是成员（此时无论如何都看不见）。 */
  readonly orgRole: OrgRole | null;
  readonly viewerTeamId: string | null;
}

export function decideSubjectVisibility(input: SubjectDecisionInput): PermissionDecision {
  const orgPassed = input.orgRole !== null;
  const visible = orgPassed && canReadSubject(input.subject, input.viewer);

  return {
    allowed: visible,
    orgLayer: { role: input.orgRole, teamId: input.viewerTeamId, passed: orgPassed },
    projectLayer:
      input.subject.groupId === null
        ? null
        : {
            role: input.viewer.projectRole as ProjectRole | null,
            groupId: input.subject.groupId,
            passed: input.viewer.projectRole !== null && input.viewer.projectRole !== "observer",
          },
    // 对象没有 `acl_bindings` 行（与 `interview` 同型），取同一个既定默认 `org-wide`。
    scopeLayer: { scope: "org-wide", passed: orgPassed },
    reasonCode: visible ? null : orgPassed ? "NO_PROJECT_ROLE" : "NO_ORG_MEMBERSHIP",
    decisionId: input.decisionId,
  };
}
