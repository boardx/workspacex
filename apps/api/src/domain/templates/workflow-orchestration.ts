/**
 * F26 —— 工作流编排：模板层（两级继承 + 换模板 + 另存为组织模板）+
 * 议程环节 × 三角色编排矩阵（`uc-2-2` R7 / 契约 `getWorkflowOrchestration` /
 * `switchWorkflowTemplate` / `saveAsOrgTemplate` / `updateMatrixCell`）。
 *
 * ## 两层结构（O-02）
 *
 * 蓝本 ⊃ 工作流模板：工作流模板是蓝本第 2 项（议程）+ 第 13 项（skill 绑定）的
 * **投影**，带 `sourceVersion`（界面「来自后台 v2」）。项目套用工作流模板时单向
 * 写入一份**实例编排**（环节链 + 矩阵），此后两者只通过快照版本号关联，互不改写
 * （domain.md I-17，同 F63 `orchestration.ts` 的「模板 → 实例」单向边）。
 *
 * ⚠ 本文件**不重复** `apps/api/src/domain/skill/orchestration.ts` 里已经建好的
 *   `ProjectOrchestration` / `RoleCell` / `applyTemplateToProject` 等——那是 UC-3.2
 *   （skill 束，F63/F64）的领域模型，形状是「role 枚举 + SegmentBinding」。本束
 *   （F26）的矩阵格形状是契约 `OrchestrationCell`（`roleKey: string` + 扁平的
 *   `canvasTemplateId`/`skillIds`），两束的路由与存储各自独立（`saveAsOrgTemplate`
 *   的接口唯一实现钉在本束，见契约头注），领域模型没有理由被迫共用同一个形状。
 *
 * ## 矩阵列集：角色表派生，不硬编码（O-03 / I-28）
 *
 * 「观察者只读故不入矩阵」——判据不是把 `"observer"` 写死排除，而是「过滤掉在
 * `PROJECT_ROLE_MATRIX` 里一个写动作都没有的角色」。角色表改了（哪怕未来第五个
 * 角色被裁定为只读），列集跟着变，不需要改本文件。
 */
import {
  PROJECT_ROLE_MATRIX,
  WRITE_ACTIONS,
} from "../identity/project-role-matrix";
import { PROJECT_ROLES, type ProjectRole } from "../identity/roles";
import type { AgendaSegmentRefLike } from "./duration-tier";

/** 契约 `OrchestrationCell` 同形状的纯 TS 接口（不重复 import zod schema）。 */
export interface MatrixCellLike {
  readonly cellId: string;
  readonly agendaSegmentId: string;
  readonly roleKey: string;
  readonly content: string;
  readonly canvasTemplateId: string | null;
  readonly skillIds: readonly string[];
}

/** 契约 `getWorkflowOrchestration.out.template` 同形状。 */
export interface WorkflowTemplateSummaryLike {
  readonly templateId: string;
  readonly name: string;
  readonly sourceVersion: number;
}

/** 一个项目此刻的完整编排快照：模板层信息 + 环节链 + 矩阵。 */
export interface WorkflowOrchestrationSnapshot {
  readonly template: WorkflowTemplateSummaryLike;
  readonly segments: readonly AgendaSegmentRefLike[];
  readonly matrix: readonly MatrixCellLike[];
  /** 乐观并发用的修订号（同 `expectedRevision` 惯例，见 `updateGrouping`）。 */
  readonly revision: string;
}

/**
 * 矩阵列集：`PROJECT_ROLES` 里在 `PROJECT_ROLE_MATRIX` 中持有至少一个写动作的角色。
 * ⚠ **这是唯一算出该列集的地方**——`updateMatrixCell` 与 `getWorkflowOrchestration`
 * 都调用它，不各自维护一份「三个角色」的字面量。
 */
export const ORCHESTRATION_ROLE_KEYS: readonly ProjectRole[] = PROJECT_ROLES.filter((role) =>
  PROJECT_ROLE_MATRIX[role].some((action) => (WRITE_ACTIONS as readonly string[]).includes(action)),
);

export function isOrchestrationRoleKey(key: string): key is ProjectRole {
  return (ORCHESTRATION_ROLE_KEYS as readonly string[]).includes(key);
}

/** 矩阵格的定位键：同一环节同一角色只有一格（换绑/改内容是「改这条」，不是「加一条」）。 */
function cellKey(c: Pick<MatrixCellLike, "agendaSegmentId" | "roleKey">): string {
  return `${c.agendaSegmentId}/${c.roleKey}`;
}

/**
 * 纯函数：把 `next` 写进矩阵（同键覆盖，否则追加），返回**新**矩阵。
 * ⚠ 不原地改——同 F63 `orchestration.ts` 头注「所有编辑函数都是纯函数」的同一条纪律。
 */
export function upsertMatrixCell(
  matrix: readonly MatrixCellLike[],
  next: MatrixCellLike,
): readonly MatrixCellLike[] {
  const key = cellKey(next);
  return [...matrix.filter((c) => cellKey(c) !== key), next];
}

export function findMatrixCell(
  matrix: readonly MatrixCellLike[],
  agendaSegmentId: string,
  roleKey: string,
): MatrixCellLike | null {
  return matrix.find((c) => c.agendaSegmentId === agendaSegmentId && c.roleKey === roleKey) ?? null;
}

/** 换工作流模板的影响面（契约 `switchWorkflowTemplate.out.impact`）。 */
export interface SwitchTemplateImpact {
  readonly droppedCells: number;
  readonly affectedTasks: number;
  readonly lostSegments: readonly AgendaSegmentRefLike[];
}

/**
 * 纯函数：给定当前编排与目标模板的环节链，算出「换过去会丢什么」。
 *
 * ⚠ **D-10 未裁决**（一格是一条待办还是可含多条）——`affectedTasks` 按「非空格 = 一条
 *   待办」的保守口径计（同 F63 `nonEmptyRoleCells` 的判据：空文案格没有对应待办，
 *   不该被算进「受影响的待办数」）。裁决落地后如果口径不同，只需要改本函数，
 *   `switchWorkflowTemplate` 的调用点不需要跟着动。
 */
export function computeSwitchTemplateImpact(
  current: {
    readonly segments: readonly AgendaSegmentRefLike[];
    readonly matrix: readonly MatrixCellLike[];
  },
  targetSegments: readonly AgendaSegmentRefLike[],
): SwitchTemplateImpact {
  const targetIds = new Set(targetSegments.map((s) => s.agendaSegmentId));
  const lostSegments = current.segments.filter((s) => !targetIds.has(s.agendaSegmentId));
  const lostIds = new Set(lostSegments.map((s) => s.agendaSegmentId));
  const droppedCellsList = current.matrix.filter((c) => lostIds.has(c.agendaSegmentId));
  const affectedTasks = droppedCellsList.filter((c) => c.content.trim().length > 0).length;
  return { droppedCells: droppedCellsList.length, affectedTasks, lostSegments };
}
