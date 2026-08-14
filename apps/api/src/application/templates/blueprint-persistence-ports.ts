/**
 * F175（BP-01）：蓝本落库与列出的存储端口。
 *
 * 纯用例 `create-blueprint.ts` 只做编排、不碰存储（它的头注逐字说明「`blueprintId` 由
 * 调用方生成并传入」「本层不读存储」）。本文件补的就是它缺的那一侧：谁去写、谁去读。
 *
 * ## 为什么 `list` 返回的不是契约的 `BlueprintRow`
 *
 * 契约 `BlueprintRow` 里有两个字段**不是存储事实**：
 * · `completeness` —— 分母来自运行时读设计环节定义表（F17 行为契约：**禁止硬编码 15/16**）；
 * · `availableActions` —— 服务端派生（契约逐字「前端不得自行决定能不能删」）。
 *
 * 若让仓储直接拼出 `BlueprintRow`，这两个派生规则就住进了 SQL 层，
 * 而定义表在 TS 里 —— 那是「同一事实两处声明」。所以仓储只回**存储事实**
 * （`BlueprintRecord`），派生留在控制器/用例层对着定义表算。
 */
import type { z } from "zod";
import type { templates } from "@repo/contracts";
import type { OrgId } from "../../domain/org-id";
import type { Guarded } from "../security/permission-filter";
import type { VisibilityScope } from "../../domain/identity/roles";

export type BlueprintOrigin = z.infer<typeof templates.BlueprintOrigin>;
export type BlueprintState = z.infer<typeof templates.BlueprintState>;
export type DurationTier = z.infer<typeof templates.DurationTier>;

/** 落库一个新蓝本。`designFacets` 为已填内容（blank 时为空、copy 时来自源蓝本）。 */
export interface CreateBlueprintCommand {
  readonly blueprintId: string;
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly name: string;
  readonly origin: BlueprintOrigin;
  readonly sourceId: string | null;
  readonly machineGenerated: boolean;
  /** designFacetKey → 已填内容。**空串的项不写行**（未填就不该有行，迁移里有 CHECK） */
  readonly designFacets: ReadonlyMap<string, string>;
}

/** 存储事实。派生字段（完成度、可用动作）不在这里，见文件头注。 */
export interface BlueprintRecord {
  readonly blueprintId: string;
  readonly name: string;
  readonly state: BlueprintState;
  readonly versionNumber: number;
  readonly durationTier: DurationTier;
  /** 已填的设计环节数（分子）。分母由调用方读定义表得出 */
  readonly filledDesignFacetCount: number;
  /** 已套用它的项目数。BP-08 之前恒 0——那时才会有项目引用蓝本版本 */
  readonly appliedProjectCount: number;
  readonly agendaSegmentCount: number;
}

/**
 * 出门必须是 `Guarded<T>`（`lint-permission-paths` 的结构性要求）。
 *
 * 蓝本是**租户内容**（名称即内容），所以读它必须走 `permission-filter` 这道唯一的门：
 * payload 除了 `discloseDecided()` 拿不出来 —— **忘了判定是类型错误，不是一次疏漏**。
 * `facts` 是判定所需的输入（不披露），`listing` 是要判定后才拿得到的内容。
 *
 * ⚠ ref 用 `kind: "capability"`：蓝本是六类 AssetKind 之一（F132 已把它纳入后台
 *   「AI 能力」组的双向相等门控），与画布模板同类——可见性判定共用
 *   `decideCapabilityVisibility`，不另造一套。
 */
export interface GuardedBlueprint {
  readonly facts: {
    readonly blueprintId: string;
    readonly scope: VisibilityScope;
    readonly ownerTeamId: string | null;
  };
  readonly listing: Guarded<BlueprintRecord>;
}

export interface BlueprintPersistencePort {
  updateDesignFacet(cmd: UpdateDesignFacetCommand): Promise<UpdateDesignFacetOutcome>;
  create(cmd: CreateBlueprintCommand): Promise<void>;
  /** 读一个蓝本已填的设计环节内容（`origin = copy` 时用来带上源蓝本内容） */
  readDesignFacets(orgId: OrgId, blueprintId: string): Promise<ReadonlyMap<string, string>>;
  /** 该蓝本是否存在于这个组织下（copy 的源必须可见，否则 BLUEPRINT_NOT_FOUND） */
  exists(orgId: OrgId, blueprintId: string): Promise<boolean>;
  list(orgId: OrgId, state: BlueprintState | null): Promise<readonly GuardedBlueprint[]>;
  setDurationTier(cmd: SetDurationTierCommand): Promise<SetDurationTierOutcome>;
}

/**
 * F174（BP-02）：设计环节逐项写入的结果 —— compare-and-swap，判据在仓储层做
 * （`SELECT ... FOR UPDATE` 读到的行与 `expectedItemRevision` 比对），不是这里。
 * 仓储只回三种结局，调用方（控制器）把它们映射成契约的 err 枚举。
 */
export type UpdateDesignFacetOutcome =
  | { readonly kind: "ok"; readonly itemRevision: string; readonly filledDesignFacetCount: number }
  | { readonly kind: "blueprint-not-found" }
  | { readonly kind: "version-changed" };

export interface UpdateDesignFacetCommand {
  readonly orgId: OrgId;
  readonly blueprintId: string;
  readonly designFacetKey: string;
  readonly value: string;
  /** 哨兵 `''` = 「我以为这一项还没人填过」（见迁移文件头注） */
  readonly expectedItemRevision: string;
}

/**
 * F177（BP-03）：换时长档位的仓储结果 —— 同 BP-02 的 compare-and-swap 惯例，
 * 判据（`revision` 是否匹配 `expectedVersion`）在仓储层的 `SELECT ... FOR UPDATE` 之后做，
 * 不在这里。领域纯函数 `planDurationTierChange` 的判定结果（是否需要确认、
 * `custom` 档规则未定）由仓储在版本比对**通过之后**再调用——
 * 顺序是：先判「你拿的版本号是不是最新的」，再判「这次改动本身是否合法/需要确认」，
 * 这样两种失败不会互相掩盖（版本冲突不会被误判成「需要确认」，反之亦然）。
 */
export type SetDurationTierOutcome =
  | {
      readonly kind: "applied";
      readonly newRevision: string;
      readonly agendaSegmentCount: number;
      readonly added: readonly { readonly agendaSegmentId: string; readonly title: string; readonly addedBy: string | null; readonly optional: boolean }[];
      readonly removed: readonly { readonly agendaSegmentId: string; readonly title: string; readonly addedBy: string | null; readonly optional: boolean }[];
      readonly recoverable: readonly { readonly agendaSegmentId: string; readonly title: string; readonly addedBy: string | null; readonly optional: boolean }[];
    }
  | {
      readonly kind: "confirmation-required";
      readonly added: readonly { readonly agendaSegmentId: string; readonly title: string; readonly addedBy: string | null; readonly optional: boolean }[];
      readonly removed: readonly { readonly agendaSegmentId: string; readonly title: string; readonly addedBy: string | null; readonly optional: boolean }[];
    }
  | { readonly kind: "custom-tier-undefined" }
  | { readonly kind: "blueprint-not-found" }
  | { readonly kind: "version-changed" };

export interface SetDurationTierCommand {
  readonly orgId: OrgId;
  readonly blueprintId: string;
  readonly tier: DurationTier;
  readonly confirmed: boolean;
  readonly expectedVersion: string;
}

export const BLUEPRINT_PERSISTENCE_PORT = Symbol("BlueprintPersistencePort");
