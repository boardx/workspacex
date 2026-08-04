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
 * ## 这里仍然没有什么
 *
 * **没有 `update()` / `createVersion()`。** 契约里仍然没有「改模板」或「基于既有模板开新版」
 * 的操作，所以 `create()` 只铸 v1（契约 `createTemplate.out.version` 是 `z.literal(1)`）。
 * 给一个契约里不存在的能力先留个端口，下一个人会以为它只是还没被调用（同
 * `application/project/ports.ts` 里不留 `grantProjectRole` 的理由）。缺口登记在
 * `KNOWN_CONTRACT_GAPS.C_CANVAS_8`。
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
}

export const CANVAS_TEMPLATE_REPOSITORY = Symbol("CanvasTemplateRepository");
