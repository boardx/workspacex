/**
 * F23 的仓储端口 —— `applyBlueprint` 事务边界（由 `application` 定义，`infrastructure` 实现）。
 *
 * ## 为什么是一个方法，而不是「先建项目再逐类写入」
 *
 * 同 `application/project/ports.ts` 里 `ProjectRepository.create` 的理由——若端口长成
 * 「建容器」+「写六类」两个（或七个）方法，「要么全成功要么整体回滚」（E2/V12）就变成了
 * **调用方的自觉**：调用方是一段能被下一个人重排的代码，中间态（有议程没分组）在那种
 * 端口形状下表达得出来，迟早会出现。一个方法 = 事务边界属于实现，调用方连拆开的语法都没有。
 *
 * ## 幂等由实现负责，不是「先查后写」
 *
 * 同 `ProjectRepository` 头注的先例：`idempotencyKey` 的去重必须落在唯一约束/主键冲突上，
 * 不能是「先查一次这个 key 有没有出现过，没有再写」——那在并发下两路都会读到「没有」，
 * 然后都写。本端口把 `idempotencyKey` 收进 `ApplyBlueprintCommand`，由实现选择存储层去重策略，
 * 应用层不替它决定「怎么去重」。
 */
import type { InitializationCategory } from "../../domain/templates/initialization-preview";
import type { CategoryInitCount } from "../../domain/templates/apply-blueprint-init";
import type { AgendaSegmentRefLike } from "../../domain/templates/duration-tier";
import type { OrgId } from "../../domain/org-id";

/**
 * `AgendaSegmentRefLike` + 真实时长（F23 补实现 / #1667）。
 *
 * ⚠ `durationMinutes` 不是 `AgendaSegmentRefLike` 本身的字段——那个类型也被
 * `duration-tier.ts`（换档位，与「这一行时长多少」无关）共用，往共享类型上加一个
 * 只有 `applyBlueprint` 才用得上的字段，会让「换档位」的调用方也要决定这个字段填什么。
 * 这里单开一个扩展类型，只在本仓储端口的边界上存在。
 */
export interface AppliedAgendaSegmentRef extends AgendaSegmentRefLike {
  /** null = 蓝本「流程 Agenda」facet 未填这一行的时长，或该行超出 facet 记录范围——如实未填，不编造默认值 */
  readonly durationMinutes: number | null;
}

export interface ApplyBlueprintCommand {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly blueprintId: string;
  /** ⚠ 写入的是**引用**，不是深拷贝（I-1/I-4）——本命令不携带 `content` */
  readonly blueprintVersionId: string;
  readonly projectName: string;
  readonly idempotencyKey: string;
  /** 六类写入计划：由 `domain/templates/apply-blueprint-init.ts` 算出，仓储不自己判定 */
  readonly initialized: readonly CategoryInitCount[];
  readonly agendaSegments: readonly AppliedAgendaSegmentRef[];
}

export interface AppliedProject {
  readonly projectId: string;
  /** ⚠ 引用，回显调用方传入的版本 id——不得被仓储改写或替换成别的版本 */
  readonly blueprintVersionId: string;
  readonly initialized: readonly CategoryInitCount[];
  /**
   * false = 这一次是重放（同一 `idempotencyKey` 命中已建成的项目），返回先前那个项目。
   * 同 `CreatedProject.created` 的理由——存在的唯一目的是让幂等在测试里可断言，
   * 契约 `applyBlueprint.out` 没有对应字段（`.strict()` 三个字段里没有它）。
   */
  readonly created: boolean;
}

/**
 * 六类写入过程中任一类失败时，仓储抛出的错误——**必须**指明失败的类别名（契约
 * `INITIALIZATION_FAILED` 的 detail 逐字要求），且抛出即代表整体已回滚（E2/V12），
 * 不存在「已经写了三类，剩下三类没写」的持久态。
 */
export class BlueprintInitializationFailedError extends Error {
  readonly failedCategory: InitializationCategory;

  constructor(failedCategory: InitializationCategory) {
    super(`six-category initialization failed at "${failedCategory}"; rolled back as a whole`);
    this.failedCategory = failedCategory;
    this.name = "BlueprintInitializationFailedError";
  }
}

export interface ApplyBlueprintRepository {
  /**
   * 一个事务：`projects` 一行 + 子类型表一行 + 六类写入 + 幂等记录一行。
   * 全部成功才提交；任一步失败，抛 `BlueprintInitializationFailedError` 且不留半成品。
   */
  apply(cmd: ApplyBlueprintCommand): Promise<AppliedProject>;
}

export const APPLY_BLUEPRINT_REPOSITORY = Symbol("ApplyBlueprintRepository");
