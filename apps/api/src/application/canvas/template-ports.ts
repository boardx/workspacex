/**
 * canvas 模板注册表的仓储端口（#463）。由 application 定义，`infrastructure` 实现（依赖倒置）。
 *
 * ## 一行为什么回来两半
 *
 * `CanvasTemplateScopeFacts` 是**判定所依据的**（`visibility` + 哪个团队拥有它）；
 * `Guarded<CanvasTemplateListing>` 是判定放行之后**才可以拿出来看的**。同
 * `capability-ports.ts` 的 `GuardedCapability` 拆法，理由也相同：一个囫囵的行对象，
 * 是「一个只想要判定结果的响应体里混进了一个字段」的发生方式。
 *
 * ⚠ 契约 `listTemplates.out` 有 `visibility` 却**没有**「哪个团队」这一栏，所以
 *   `ownerTeamId` 只在 facts 里、永不进响应体——与 `CapabilityListing` 的缺口同型
 *   （已记在 `capability-ports.ts` 文件头），同样是报出来而不是发明一个字段。
 *
 * ## 这里没有什么
 *
 * **没有 `create()`。** 签核过的 `canvas.ts` 契约里没有任何一个创建模板的操作：五个
 * 注册表操作是 list / publish / trial / archive / restore，而 `publishTemplate.in` 是
 * `{key, version, visibility}`——不带 `displayName` / `sections` / `underlyingType`，
 * 且它的 `err` 里有 `TEMPLATE_NOT_FOUND`，说明它读一行已存在的、而不是造一行。
 * 给一个契约里不存在的能力先留个端口，下一个人会以为它只是还没被调用（同
 * `application/project/ports.ts` 里不留 `grantProjectRole` 的理由）。缺口报在 #463。
 *
 * **没有 `delete()`。** 归档是置位（O-10），迁移也没有 GRANT DELETE。
 */
import type { canvas } from "@repo/contracts";
import type { z } from "zod";
import type { TemplateStatus, TemplateVersionState } from "../../domain/canvas/template-lifecycle";
import type { VisibilityScope } from "../../domain/identity/roles";
import type { OrgId } from "../../domain/org-id";
import type { Guarded } from "../security/permission-filter";

/** 契约 `listTemplates.out.templates[]` 的元素，逐字派生 —— 不在这里重述一遍字段。 */
export type CanvasTemplateListing = z.infer<
  typeof canvas.operations.listTemplates.out
>["templates"][number];

/** 判定所需，永不披露。 */
export interface CanvasTemplateScopeFacts {
  readonly key: string;
  readonly version: number;
  readonly scope: VisibilityScope;
  /** `team-only` 归哪个团队。null ⇒ 谁都对不上 ⇒ 对所有人不可见（fail-closed）。 */
  readonly ownerTeamId: string | null;
}

export interface GuardedCanvasTemplate {
  readonly facts: CanvasTemplateScopeFacts;
  readonly listing: Guarded<CanvasTemplateListing>;
}

/**
 * 一个具体版本的生命周期事实。
 *
 * 与列表行**不是同一个类型**：列表行是要给人看的（过完可见性判定），这个是给状态机用的，
 * 里面的 `builtin` 与 `archivedFrom` 都不是展示字段，而是转移是否合法的判据。
 */
export interface CanvasTemplateVersionFacts {
  readonly key: string;
  readonly version: number;
  readonly state: TemplateVersionState;
  readonly builtin: boolean;
}

export interface ListCanvasTemplatesQuery {
  readonly orgId: OrgId;
  /**
   * 要哪些状态。**由用例算好传进来**，仓储不自己解释 `filter` / `forBinding`——
   * 那两个参数怎么映射到状态集合是一条业务判断（I-5 的过滤规则），两处各写一遍
   * 就是两份判据，而后台模板库与绑定选择器共用这一个端口的全部理由正是不要两份。
   */
  readonly statuses: readonly TemplateStatus[];
}

export interface PublishOutcome {
  /** 本次发布顺带归档掉的同 key 旧版（I-4 前半）。 */
  readonly archivedVersions: readonly { readonly key: string; readonly version: number }[];
}

export interface CanvasTemplateRepository {
  /** `usageCount` 由仓储现查 `COUNT(*)` 得出 —— 库里没有可写的计数列，见迁移文件头。 */
  list(query: ListCanvasTemplatesQuery): Promise<readonly GuardedCanvasTemplate[]>;

  findVersion(
    orgId: OrgId,
    key: string,
    version: number,
  ): Promise<CanvasTemplateVersionFacts | null>;

  /**
   * **一个事务**：把同 key 的其它 published 版本归档 + 把本版本置为 published。
   *
   * 拆成「归档旧版」「发布新版」两个方法，原子性就变成调用方的自觉，而 I-4 想排除的
   * 「两个 published 同时存在」的中间态在那种端口形状下**表达得出来**——同
   * `ProjectRepository.create` 那条「一个方法 = 事务边界属于实现」的理由。
   */
  publish(cmd: {
    readonly orgId: OrgId;
    readonly key: string;
    readonly version: number;
    readonly visibility: VisibilityScope;
  }): Promise<PublishOutcome>;

  /** 把一个版本置为给定状态（含 `archivedFrom` 的写入/清除）。 */
  setState(
    orgId: OrgId,
    key: string,
    version: number,
    next: TemplateVersionState,
  ): Promise<void>;

  /**
   * 仍绑定着这个版本的议程环节 **id 列表**。契约要求 `stillBoundSegmentCount` 是真实计数，
   * 返回 0 与不返回是两回事。
   *
   * ⚠ 返回 id 而不是一个数：数它的是 `domain/canvas/template-lifecycle.ts` 的
   *   `previewArchiveImpact(boundAgendaSegmentIds)`，它收的就是 id 列表。端口若只回一个数，
   *   用例就得**造一个等长的假数组**去喂那个函数——一段除了满足签名之外不表示任何东西的
   *   数据，而它长得和真数据一模一样。让端口回真东西，假数据就没有存在的位置。
   */
  listBoundSegmentIds(orgId: OrgId, key: string, version: number): Promise<readonly string[]>;

  /* ─────────────────── #493：`bindTemplateToSegment` 的写入面 ─────────────────── */

  /**
   * 这个议程环节属于哪个工作坊；环节不存在（或不在本组织）⇒ `null`。
   *
   * ⚠ 回的是 `workshopId` 而不是一个布尔「存在吗」：`canvas_template_bindings` 的复合外键
   *   是 `(agenda_segment_id, workshop_id, org_id)`，插入时**必须**带上工作坊。让调用方
   *   从别处再查一次 workshop，就有了两条各自决定「这个环节属于谁」的路径，而插入用的那条
   *   与鉴权用的那条一旦分叉，权限就是对着另一个项目判的。
   * ⚠ 它同时是鉴权的输入：`authorize` 判的是**工作坊项目**上的项目角色，判据必须与写入
   *   落点来自同一次查询。
   */
  findSegmentWorkshopId(orgId: OrgId, agendaSegmentId: string): Promise<string | null>;

  /** 该议程环节现有的模板绑定。I-6 的上限由 `domain/canvas/segment-binding.ts` 数，不在这里判。 */
  listSegmentBindings(orgId: OrgId, agendaSegmentId: string): Promise<readonly SegmentBindingRow[]>;

  /**
   * 写入一条绑定。
   *
   * ⚠ 返回 `"conflict"` 而不是抛：同一环节重复绑同一个 key 由**唯一约束**
   *   `canvas_template_bindings_segment_key_uniq` 判定，不是先 `SELECT` 再决定要不要写——
   *   先查后写在并发下就是两条都插进去（同 `advance-agenda-segment.ts` 那条
   *   `SEGMENT_ALREADY_ACTIVE` 由部分唯一索引产生、应用层只翻译的纪律）。
   */
  insertSegmentBinding(cmd: {
    readonly orgId: OrgId;
    readonly bindingId: string;
    readonly agendaSegmentId: string;
    readonly workshopId: string;
    readonly templateKey: string;
    readonly templateVersion: number;
  }): Promise<"inserted" | "conflict">;
}

/** 一行绑定。字段名对齐 `domain/canvas/segment-binding.ts` 的 `SegmentTemplateBinding`。 */
export interface SegmentBindingRow {
  readonly bindingId: string;
  readonly agendaSegmentId: string;
  readonly templateKey: string;
  readonly boundTemplateVersion: number;
}

export const CANVAS_TEMPLATE_REPOSITORY = Symbol("CanvasTemplateRepository");
