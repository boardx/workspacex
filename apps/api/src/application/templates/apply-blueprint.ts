/**
 * 用例：套用蓝本新建项目（F23 / `uc-2-2` R3 / 契约 `templates.applyBlueprint`）。
 *
 * 洋葱：application → domain，仓储端口见 `apply-blueprint-ports.ts`。
 *
 * ## 编排顺序：先判「能不能看」，再判「能不能建」，最后才算「建什么」
 *
 * 1. 组织角色（`NO_ORG_ROLE` / `ROLE_INSUFFICIENT`）—— 复用 F17 `createProject` 的判断
 *    （**只有 `lead`**，`admin` 也不能）：套用蓝本的终点就是建一个项目容器，两处判的是
 *    同一条边，写两份判断只会让「谁能建」在某一天只改对一处。
 * 2. 可见性（`BLUEPRINT_NOT_VISIBLE`）—— team-only 蓝本对非该 team 成员不可见。
 * 3. 版本状态（`BLUEPRINT_NOT_PUBLISHED` / `BLUEPRINT_VERSION_ARCHIVED`）—— 复用 F17
 *    `canBindNewProject`（I-7）：`resolvedVersion === null` 意味着这个蓝本从未发布过任何
 *    版本，`resolvedVersion.state !== "published"` 意味着调用方显式选中了一个已归档版本
 *    去**新增绑定**（I-7 只允许存量绑定继续实例化，不允许新绑定挂在归档版本上）。
 * 4. 六类写入计划（`domain/templates/apply-blueprint-init.ts`）—— 纯函数，不消耗任何 I/O。
 * 5. 仓储事务（`ApplyBlueprintRepository.apply`）—— 幂等 + 原子性由仓储保证，
 *    失败时仓储抛 `BlueprintInitializationFailedError`，本用例把它翻译成契约错误码。
 *
 * ⚠ `blueprintVersionId` 全程只被当作**不透明的字符串引用**传递——本用例从不读取
 * `BlueprintVersion.content`，这正是 I-1「快照不漂移」在用例层的落点：没有内容可抄，
 * 就没有「抄错」或「抄了一半」这回事。
 */
import { templates } from "@repo/contracts";
import type { z } from "zod";
import {
  canBindNewProject,
  type BlueprintVersion,
} from "../../domain/templates/blueprint-version";
import {
  planSixCategoryInit,
  type DurationTier,
} from "../../domain/templates/apply-blueprint-init";
import { DESIGN_FACET_DEFINITIONS, type DesignFacetRow } from "../../domain/templates/design-facet-table";
import { AGENDA_SEGMENT_DEFINITIONS, type AgendaSegmentRow } from "../../domain/templates/agenda-segment-table";
import { parseFlowAgendaDurations } from "../../domain/templates/flow-agenda-durations";
import type { OrgRole } from "../../domain/identity/roles";
import type { OrgId } from "../../domain/org-id";
import {
  BlueprintInitializationFailedError,
  type AppliedAgendaSegmentRef,
  type AppliedProject,
  type ApplyBlueprintRepository,
} from "./apply-blueprint-ports";
import type { BlueprintAuditWriter } from "./blueprint-audit-ports";

export type ApplyBlueprintOutput = z.infer<typeof templates.operations.applyBlueprint.out>;
export type ApplyBlueprintErrorCode = z.infer<typeof templates.TemplateError>;

/**
 * 一个类携带契约里的一个错误码，同 `TemplateOperationError` / `ProjectError` 的形状。
 * ⚠ `failedCategory` 仅在 `INITIALIZATION_FAILED` 时非 null——契约注释逐字要求
 * detail 指明失败的类别名。
 */
export class ApplyBlueprintError extends Error {
  readonly reasonCode: ApplyBlueprintErrorCode;
  readonly failedCategory: z.infer<typeof templates.InitializationCategory> | null;

  constructor(
    reasonCode: ApplyBlueprintErrorCode,
    failedCategory: z.infer<typeof templates.InitializationCategory> | null = null,
  ) {
    super(reasonCode);
    this.reasonCode = reasonCode;
    this.failedCategory = failedCategory;
    this.name = "ApplyBlueprintError";
  }
}

/**
 * **只有 `lead`**。⚠ 有意不 import `canCreateProject`：`templates` 与 `project` 是两个
 * 独立契约束，各自的仓储/测试边界不应因为共享一行判断而产生跨束依赖；两处各自维护、
 * 改动各自评审。
 *
 * ## 🔴 2026-08-06 起两处**不再逻辑相同** —— 这是已知分歧，不是遗漏
 *
 * 人类裁决（#608）把 `project` 束的 `canCreateProject` 放宽为「`lead` 或 `admin`」，
 * 理由是「组织里的第一个人永远是 `admin`，否则永远建不了第一个项目」。
 * 而「套用蓝本新建项目**就是**新建项目」——同一个动作，本函数却仍然只放行 `lead`。
 *
 * ⚠ **本次没有跟着改**，因为：
 *   ① 裁决原文只点名 `canCreateProject`（#608 要求第 1 条逐字），本束不在其范围内；
 *   ② 本文件头注立的规矩正是「两处各自评审」——顺手同步就是替 `templates` 束的
 *      签核人做了一个没人评审过的判断；
 *   ③ 实测 `applyBlueprint` **尚未挂任何 controller 路由**（全仓 `apps/api/src/interface`
 *      下零命中，正样本 `createProject` 同一把尺子有命中）⇒ 这条分歧**当前用户不可达**，
 *      不构成 #608 要解的那个体验断点。
 *
 * ⇒ 已在 #608 的 PR 正文作为「需人裁的遗留分歧」列出。谁来接：把这里改成
 *   `orgRole === "lead" || orgRole === "admin"` 是一行的事，但要走 `templates` 束的评审。
 *   分歧本身由 `tests/tpl/apply-blueprint-admin-divergence.test.ts` 钉住——**那条测试锁的是
 *   「今天是什么样」，不是「应该是什么样」**：分歧被消除时它会红，提醒来人删掉它。
 */
export function canApplyBlueprint(orgRole: OrgRole | null): boolean {
  return orgRole === "lead";
}

export interface ApplyBlueprintInput {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly actorOrgRole: OrgRole | null;
  readonly blueprintId: string;
  /** null = 该蓝本不存在或对调用者不可见 —— 由调用方（未来的 controller）先行解析 */
  readonly blueprintExists: boolean;
  /** false = team-only 蓝本且调用者不在该 team */
  readonly visibleToActor: boolean;
  /**
   * 待绑定的版本：`versionId` 为 null 时是「当前已发布版本」，非 null 时是调用方按
   * `versionId` 查到的那一条。两种情况下都可能是 `null`（从未发布过 / 版本号不存在）。
   */
  readonly resolvedVersion: BlueprintVersion | null;
  readonly filledFacetKeys: Iterable<string>;
  readonly tier: DurationTier;
  readonly projectName: string;
  readonly idempotencyKey: string;
  /**
   * 蓝本「流程 Agenda」（`flow-agenda`）facet 在**这一版**（`resolvedVersion.content`）里
   * 的原始 JSON 字符串——由调用方（controller）从已解析出的版本内容里取出这一项传入，
   * 本用例**自己不读** `BlueprintVersion.content`（同头注「blueprintVersionId 全程只被
   * 当作不透明引用传递」的同一条纪律：`filledFacetKeys` 早已是同类的「调用方从 content
   * 派生出的摘要」，本字段与它同一处置，不是新开的口子）。
   * null = 该版本没有这一项内容（蓝本创建者没填过「流程 Agenda」）。
   */
  readonly flowAgendaContent: string | null;
}

export interface ApplyBlueprintDeps {
  readonly repo: ApplyBlueprintRepository;
  /**
   * F28：套用成功写 `套用`，权限/可见性判定被拒写 `越权尝试`（`uc-2-2` R6）。
   * ⚠ 可选——见 `blueprint-audit-ports.ts` 头注：本束尚无落地的审计持久化实现，
   * 调用点先接好，真实落库随 controller 一起装配。缺省时本用例的判断逻辑不变。
   */
  readonly auditWriter?: BlueprintAuditWriter;
}

export async function applyBlueprintUseCase(
  deps: ApplyBlueprintDeps,
  input: ApplyBlueprintInput,
  facetTable: readonly DesignFacetRow[] = DESIGN_FACET_DEFINITIONS,
  agendaTable: readonly AgendaSegmentRow[] = AGENDA_SEGMENT_DEFINITIONS,
): Promise<ApplyBlueprintOutput> {
  // ① 谁能建——先于「这个蓝本存不存在」判断，同 F17 `create-project.ts` 的顺序理由：
  // kind/角色这类与「具体这条资源是谁」无关的门槛，不该等一次资源查询之后才拦。
  // ⚠ 三条越权判定都先写审计再抛错——「记录被拒」不能因为判断顺序被漏埋一半。
  if (input.actorOrgRole === null) {
    await recordUnauthorized(deps.auditWriter, input, "NO_ORG_ROLE");
    throw new ApplyBlueprintError("NO_ORG_ROLE");
  }
  if (!canApplyBlueprint(input.actorOrgRole)) {
    await recordUnauthorized(deps.auditWriter, input, "ROLE_INSUFFICIENT");
    throw new ApplyBlueprintError("ROLE_INSUFFICIENT");
  }

  if (!input.blueprintExists) throw new ApplyBlueprintError("BLUEPRINT_NOT_FOUND");
  if (!input.visibleToActor) {
    await recordUnauthorized(deps.auditWriter, input, "BLUEPRINT_NOT_VISIBLE");
    throw new ApplyBlueprintError("BLUEPRINT_NOT_VISIBLE");
  }

  // ③ 版本状态：`resolvedVersion === null` ⇒ 这个蓝本从未发布过任何版本可选；
  // 选中了但状态不是 published（只可能是 archived）⇒ 新增绑定被 I-7 拒绝。
  if (input.resolvedVersion === null) throw new ApplyBlueprintError("BLUEPRINT_NOT_PUBLISHED");
  if (!canBindNewProject(input.resolvedVersion)) throw new ApplyBlueprintError("BLUEPRINT_VERSION_ARCHIVED");

  const plan = planSixCategoryInit(input.filledFacetKeys, input.tier, facetTable, agendaTable);

  // 逐环节时长：按位置对齐 `flow-agenda` facet 里真实已存的 `min`（P10 已随 F202
  // 落地过期，见文件头引用与 `domain/templates/flow-agenda-durations.ts` 头注）。
  // 未填 / 解析失败 / 超出 facet 记录范围一律 `null`，不编造默认值。
  const durations = parseFlowAgendaDurations(input.flowAgendaContent);
  const agendaSegments: readonly AppliedAgendaSegmentRef[] = plan.agendaSegments.map((seg, i) => ({
    ...seg,
    durationMinutes: durations[i] ?? null,
  }));

  let applied: AppliedProject;
  try {
    applied = await deps.repo.apply({
      orgId: input.orgId,
      actorId: input.actorId,
      blueprintId: input.blueprintId,
      blueprintVersionId: input.resolvedVersion.id,
      projectName: input.projectName,
      idempotencyKey: input.idempotencyKey,
      initialized: plan.initialized,
      agendaSegments,
    });
  } catch (err) {
    if (err instanceof BlueprintInitializationFailedError) {
      throw new ApplyBlueprintError("INITIALIZATION_FAILED", err.failedCategory);
    }
    throw err;
  }

  // ⚠ 只在真正建成（含幂等重放）之后才写 `套用`——INITIALIZATION_FAILED 已在上面提前
  // 抛出，不会走到这里；失败的那次不产生审计记录，同 I-3「发布失败不占号」的同款理由。
  await deps.auditWriter?.record({
    orgId: input.orgId,
    blueprintId: input.blueprintId,
    actorId: input.actorId,
    action: "套用",
    detail: { projectId: applied.projectId, blueprintVersionId: applied.blueprintVersionId },
  });

  return {
    projectId: applied.projectId,
    blueprintVersionId: applied.blueprintVersionId,
    initialized: applied.initialized.map((c) => ({ category: c.category, count: c.count })),
  };
}

/**
 * `越权尝试` 写入的公共小尾巴（F28）——三处判定分支各自早退，抽成一个函数只是不让
 * `detail` 的字段名在三处各写一遍、某天改一处漏两处（同 `record-audit.ts` 头注的理由）。
 */
async function recordUnauthorized(
  auditWriter: BlueprintAuditWriter | undefined,
  input: ApplyBlueprintInput,
  reasonCode: ApplyBlueprintErrorCode,
): Promise<void> {
  await auditWriter?.record({
    orgId: input.orgId,
    blueprintId: input.blueprintId,
    actorId: input.actorId,
    action: "越权尝试",
    detail: { action: "templates.applyBlueprint", reasonCode },
  });
}
