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
 * ## `create()` 于 #496 补上，**该契约面待人类补签**
 *
 * #463 时这里逐字写着「没有 `create()`」，因为签核过的契约里没有任何创建操作。#496 把
 * `createTemplate` 作为 design-delta 加进契约（coord-main 代裁「先做」+ 登记待补签，
 * 见 `packages/contracts/src/canvas.ts` 该操作的文件头），端口随之补上。
 *
 * ⚠ 人类若推翻 #496，`create()` 与它的实现一并回退——它不是一个「反正已经有了」的既成事实。
 *
 * ## `mintVersion()` 于 #988 补上，人类已签核
 *
 * 契约的 `mintTemplateVersion`（「基于既有模板开新版」，C_CANVAS_8②）已由人类在
 * `design-signoff.md` 签核确认（2026-08-17）。`create()` 仍然只铸 v1（`createTemplate`
 * 本身未改动），铸 v2 及以后走这个新端口。
 *
 * ## `updateDraft()` 于 2026-08-23 补上，**该契约面待人类补签**——但不是「原来那句话错了」
 *
 * 上一段的历史版本写着「没有 `update()`……已发布/已归档版本永远是不可变快照」。
 * 这条不变量**没有被推翻**：`updateDraft()` 只对 `status === 'draft'` 的行生效，
 * 已发布/已归档仍然只能通过 `mintTemplateVersion` 开新版去"改"。收窄的是另一半——
 * "草稿本身在被发布之前是不是也不可变"。人类原话「新建画布……不要在这里放分区设计……
 * 所有的内容进入编辑的界面来管理」：新建时只给名字，意味着新建出来的草稿必须能在
 * 发布前被反复改，编辑界面才有内容可编——否则一个空分区的草稿只能被发布，不能被填。
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

/**
 * 一行**刚被造出来**的模板，逐字派生自契约 —— 不在这里重述一遍字段。
 *
 * ⚠ 与 `CanvasTemplateListing` 不是同一个类型，也**不该**合并：列表行有 `usageCount`
 *   （一次 `COUNT(*)`），新建行没有——它的绑定数恒为 0，但「恒为 0」与「数过是 0」
 *   在类型上同形，而契约那句「usageCount 必须真实统计」正是要防这种同形。
 *   契约给这两个操作的 out 就是两个形状，端口照抄它，不自作主张收敛。
 */
export type CreatedCanvasTemplate = z.infer<typeof canvas.operations.createTemplate.out>;

/**
 * `create()` 的结果。**不用 `null` 表示冲突**：`findVersion()` 里 null 的含义是「没找到」，
 * 同一个仓储上两个方法的 null 表示两件不同的事，是下一个人读错它的方式。
 */
export type CreateTemplateOutcome =
  | { readonly created: true; readonly template: CreatedCanvasTemplate }
  | { readonly created: false; readonly reason: "key-taken" };

/**
 * `mintTemplateVersion.out` 逐字派生 —— 不在这里重述一遍字段。
 *
 * ⚠ 与 `CreatedCanvasTemplate` 不是同一个类型（虽然字段集合目前相同）：`version` 的
 *   契约类型不同（`z.number().int().positive()` vs `z.literal(1)`），两者复用同一个
 *   TS 类型会掩盖这处差异——哪天其中一个 `out` 长出专属字段，这里就会显出来是哪一个。
 */
export type MintedCanvasTemplateVersion = z.infer<
  typeof canvas.operations.mintTemplateVersion.out
>;

/**
 * `mintVersion()` 的结果。`{minted: false}` 覆盖两种「不能铸」的前置条件——调用方
 * （用例层）按 `reason` 翻成对应的 `CanvasError`，仓储只报事实。
 */
export type MintTemplateVersionOutcome =
  | { readonly minted: true; readonly template: MintedCanvasTemplateVersion }
  | { readonly minted: false; readonly reason: "key-not-found" };

/** `updateTemplateDraft.out` 逐字派生——见该操作契约文件头。 */
export type UpdatedCanvasTemplateDraft = z.infer<
  typeof canvas.operations.updateTemplateDraft.out
>;

/**
 * `updateDraft()` 的结果。两种「没改成」用不同 reason——用例层按 reason 翻成
 * `TEMPLATE_NOT_FOUND`（key/version 压根不存在）或 `TEMPLATE_NOT_DRAFT`
 * （存在，但不是 draft）。合并成一种会让「这个 key 我打错了」与「这一版已经发布了、
 * 内容改不了」在响应上无法区分——它们是使用者要采取的两种不同行动。
 */
export type UpdateDraftOutcome =
  | { readonly updated: true; readonly template: UpdatedCanvasTemplateDraft }
  | { readonly updated: false; readonly reason: "not-found" | "not-draft" };

export interface PublishOutcome {
  /** 本次发布顺带归档掉的同 key 旧版（I-4 前半）。 */
  readonly archivedVersions: readonly { readonly key: string; readonly version: number }[];
}

export interface CanvasTemplateRepository {
  /** `usageCount` 由仓储现查 `COUNT(*)` 得出 —— 库里没有可写的计数列，见迁移文件头。 */
  list(query: ListCanvasTemplatesQuery): Promise<readonly GuardedCanvasTemplate[]>;

  /**
   * 铸一行新的 `draft` 模板（#496）。key 在本组织已被**任何版本**占用时不写、回
   * `{created: false}`。
   *
   * ⚠ **占用判定必须与写入在同一条语句里**，不是用例先 `findVersion` 再 `create`。
   *   查完到写入之间是一个窗口，两个并发请求会双双通过检查；而这种失败只在真并发下出现，
   *   所有顺序执行的测试照样全绿。原子性属实现，所以边界在这一个方法里——同 `publish()`
   *   那条「一个方法 = 一个事务边界」的理由。
   *
   * ⚠ 判据是 **key**，不是 `(key, version)`：同一个 key 的两个版本是一条谱系上的两点，
   *   而本方法只铸 v1。只看 `(key, 1)` 会让「已有 v2、又建出一个不相干的 v1」成为可能。
   */
  create(cmd: {
    readonly orgId: OrgId;
    readonly key: string;
    readonly displayName: string;
    readonly underlyingType: string;
    readonly sections: CreatedCanvasTemplate["sections"];
    readonly visibility: VisibilityScope;
    /**
     * `team-only` 归哪个团队。契约的 `createTemplate.in` **没有**这一栏（C_CANVAS_8 ①），
     * 由用例填创建者自己的团队；创建者无团队时为 null，那一行对所有人不可见（fail-closed）。
     */
    readonly ownerTeamId: string | null;
  }): Promise<CreateTemplateOutcome>;

  /**
   * 铸「基于既有模板开新版」的下一个版本（#988，C_CANVAS_8②）。key 在本组织**不存在
   * 任何版本**时不写、回 `{minted: false, reason: "key-not-found"}`。
   *
   * ⚠ **版本号分配与写入必须在同一条语句里**，不是用例先 `SELECT max(version)` 再
   *   `INSERT`——理由与 `create()` 的占用判定同型：查完到写入之间的窗口在并发下会让
   *   两个请求算出同一个 `max+1`，同 key 撞出重复版本号。用
   *   `INSERT ... SELECT max(version)+1 FROM canvas_templates WHERE ...` 把这两步
   *   收进一条语句，由 `(org_id, key, version)` 主键的唯一性兜底并发下的第二次冲突。
   */
  mintVersion(cmd: {
    readonly orgId: OrgId;
    readonly key: string;
    readonly displayName: string;
    readonly underlyingType: string;
    readonly sections: CreatedCanvasTemplate["sections"];
    readonly visibility: VisibilityScope;
    /** `team-only` 时非空——契约层 `.refine` 已经挡过一次，这里是第二道防线。 */
    readonly ownerTeamId: string | null;
  }): Promise<MintTemplateVersionOutcome>;

  findVersion(
    orgId: OrgId,
    key: string,
    version: number,
  ): Promise<CanvasTemplateVersionFacts | null>;

  /**
   * 2026-08-23，**设计增量、待人类补签**——原地改写一个 **仍是 draft** 的版本的
   * `displayName`/`sections`/`visibility`（全量替换，见契约 `updateTemplateDraft`
   * 文件头）。目标不是 draft（已发布/已归档）时不写、回 `{updated:false,
   * reason:"not-draft"}`——那条「已发布/已归档版本永远是不可变快照」的不变量
   * 原样保留，本方法只是把它的边界从"创建那一刻起不可变"收紧到"发布那一刻起不可变"。
   *
   * ⚠ 状态判定必须与写入在同一条 `UPDATE ... WHERE status='draft'` 语句里，不是
   *   先 `findVersion` 再 `UPDATE`——理由与 `create()`/`mintVersion()` 的并发窗口
   *   同型：两个并发请求（一个在改草稿，一个在发布它）之间不该有能让"改了一个
   *   已经发布出去的版本"发生的窗口。
   */
  updateDraft(cmd: {
    readonly orgId: OrgId;
    readonly key: string;
    readonly version: number;
    readonly displayName: string;
    readonly sections: CreatedCanvasTemplate["sections"];
    readonly visibility: VisibilityScope;
  }): Promise<UpdateDraftOutcome>;

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
