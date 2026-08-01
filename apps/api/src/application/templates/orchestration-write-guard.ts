/**
 * F26 三个写操作（`switchWorkflowTemplate` / `saveAsOrgTemplate` / `updateMatrixCell`）
 * 共用的「调用者对该项目有写权限」判定。
 *
 * `usecases.md` 三条 `pre` 逐字都是同一句「调用者对该项目有写权限」——不是巧合措辞，
 * 是同一道闸；写在一处，三处调用，同 `advance-agenda-segment.ts` 头注「四个动作词只对应
 * 一次权限判定」的同一条纪律。
 *
 * ⚠ 这道闸与矩阵**列集**（`ORCHESTRATION_ROLE_KEYS`）恰好是同一个角色子集——都是
 *   「在 `PROJECT_ROLE_MATRIX` 里持有至少一个写动作」——这不是巧合合并成一份判断，
 *   而是**同一条业务事实的两处引用**：能写编排的角色，恰是矩阵里有列的角色（观察者
 *   两边都缺席）。刻意从同一个 `ORCHESTRATION_ROLE_KEYS` 派生，不重复写一份角色枚举。
 */
import { isOrchestrationRoleKey } from "../../domain/templates/workflow-orchestration";
import type { ProjectRole } from "../../domain/identity/roles";

export function canWriteOrchestration(role: ProjectRole | null): role is ProjectRole {
  return role !== null && isOrchestrationRoleKey(role);
}
