/**
 * F23 补实现（#1667）：`templates.applyBlueprint` 的**只读**解析端口——给控制器
 * 拼出 `ApplyBlueprintInput` 所需的全部事实（蓝本存不存在 / 可见性 / 目标版本 /
 * 当前时长档位 / 该版本已填的设计配置项 / `flow-agenda` facet 原始内容）。
 *
 * ## 为什么不是加进 `ApplyBlueprintRepository`
 *
 * `ApplyBlueprintRepository` 的方法名集合被 `no-writeback-to-blueprint.test.ts` 断言
 * **恒等于 `{apply}`**（F28 的白名单）——加一个 `resolve` 方法会让那条断言的字面意思
 * 不再成立。两个端口分别对应「读」与「写」两件事，同 `BlueprintReferenceRepository`
 * （project 束，BP-08）与 `PgProjectRepository`（写）分离的先例。
 *
 * ## 为什么不是直接复用 `BlueprintReferenceRepository`
 *
 * 那个端口的入参是**已经确定的** `blueprintVersionId`（project 束的 `createProject`
 * 调用方总是先经由前端选好一个具体版本）。`templates.applyBlueprint` 的契约允许
 * `versionId: null`（= 当前已发布版本，由服务端解析），且需要多带出 `flowAgendaContent`
 * （F23 补实现新增的读取面）——形状不同，不必为了复用硬凑一个都满足的签名。
 */
import type { OrgId } from "../../domain/org-id";
import type { OrgRole } from "../../domain/identity/roles";
import type { BlueprintVersion } from "../../domain/templates/blueprint-version";
import type { DurationTier } from "../../domain/templates/apply-blueprint-init";

export interface ResolveApplyBlueprintOutcome {
  readonly blueprintExists: boolean;
  readonly visibleToActor: boolean;
  /** null = 该蓝本从未发布过任何版本 / 指定的 `versionId` 不存在——`applyBlueprintUseCase` 自己判 BLUEPRINT_NOT_PUBLISHED */
  readonly resolvedVersion: BlueprintVersion | null;
  /** 蓝本**活表**当前档位，不是版本快照里的档位（同 `create-project.ts` BP-08 的既有口径） */
  readonly tier: DurationTier;
  readonly filledFacetKeys: readonly string[];
  /** `resolvedVersion.content['flow-agenda']` 的原始字符串；version 为 null 或该项未填时为 null */
  readonly flowAgendaContent: string | null;
}

export interface ApplyBlueprintResolverPort {
  resolve(
    orgId: OrgId,
    blueprintId: string,
    versionId: string | null,
    actorOrgRole: OrgRole | null,
    actorTeamId: string | null,
  ): Promise<ResolveApplyBlueprintOutcome>;
}

export const APPLY_BLUEPRINT_RESOLVER_PORT = Symbol("ApplyBlueprintResolverPort");
