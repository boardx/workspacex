/**
 * #464 —— 画布模板注册表的前端薄封装（#463 落地的五条真实路由）。
 *
 * 形状与路径**全部**从 `@repo/contracts` 的 `canvas` 束取。手抄一份路径字面量或手写一个
 * `interface TemplateRow`，就是本仓 AGENTS.md 点名过五次的「同一事实两处声明」，
 * 且路径漂移时没有任何东西会红。所以本文件里**一个** URL 字面量都不许出现，
 * 由 `tests/session/canvas-template-routes-no-mock.test.ts` 机械钉住。
 *
 * ## 这个文件不做判断
 *
 * 没有「是不是管理员」的分支，也不把 403 翻译成「按钮置灰」。裁决在服务端
 * （`application/canvas/*`），这里只把契约形状原样送出去、把失败原样带回来
 * （`ApiError` 直抛，不吞）。吞掉 403 再返回空数组，会让「被拒绝」和「一个模板都没有」
 * 在类型上无法区分，而界面正要把这两者显示成不同的东西。
 *
 * ## 🟡 `createTemplate` 于 #496 补上，**该契约面待人类补签**
 *
 * #464 时这里逐字写着「契约里根本没有创建操作 ⇒ 新增模板 → 保存 → 刷新仍在这条闭环
 * 做不出来」。#496 把 `createTemplate` 作为 design-delta 加进契约（coord-main 代裁「先做」
 * + 登记待补签，见 `packages/contracts/src/canvas.ts` 该操作的文件头），本文件随之补上
 * `createCanvasTemplate`。人类若推翻 #496，它与调用它的界面一并回退。
 *
 * ⚠ 新建出来的是**草稿**，不是「建完就能用」。要能用还得走 `publishCanvasTemplate`——
 *   前端不代替服务端做这一步，也不在界面上把两者画成一个动作。
 *
 * ## 「编辑 = 开新版」已由 #988 补上
 *
 * `mintTemplateVersion`（`mintCanvasTemplateVersion`，下方）是本束「编辑」的真实语义——
 * 分区结构改不了的是**已存在的那个版本**，不是这个 key 从此定型。人类已在
 * `design-signoff.md` 签核确认（2026-08-17）。`template-editor` 那一屏（mermaid 图、
 * 设计对话、版本历史、回滚）**仍是 mock 原型**——那部分对应的是签核材料第二节
 * （`MermaidDiagramType` / `diagramSkeleton`），人类裁定为后续独立 feature，不在本次范围。
 *
 * ## 后端**仍然没有**给的东西（缺口，已报出，不在这里发明）
 *
 * · **`createTemplate` 的 `ownerTeamId`**：`visibility: "team-only"` 需要「归哪个团队」，
 *   `createTemplate.in` 没有这一栏（人类签核时**明确保留**这个现状，不是遗漏）。
 *   服务端取创建者自己的团队；创建者无团队时那一行对**所有人不可见**（fail-closed）。
 *   ⚠ `mintTemplateVersion.in` **不是**这个缺口——它有 `ownerTeamId` 且是显式拒绝语义，
 *     两个操作在这一栏上**故意不同**，见 `canvas.KNOWN_CONTRACT_GAPS.C_CANVAS_8`。
 * · **mermaid 白名单**：契约里有 `setMermaidWhitelist`，但 #463 的 controller
 *   没有挂这条路由。原先模板库屏底部那块白名单开关是纯 mock（点了不落库），
 *   已随本次去 mock 一并撤下，而不是留一块「点了像是生效了」的假开关。
 */
import { canvas } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type TemplateStatus = z.infer<typeof canvas.TemplateStatus>;
export type TemplateVisibility = z.infer<typeof canvas.TemplateVisibility>;
export type ListTemplatesOut = z.infer<typeof canvas.operations.listTemplates.out>;
export type CanvasTemplate = ListTemplatesOut["templates"][number];
export type ListTemplatesFilter = NonNullable<
  z.infer<typeof canvas.operations.listTemplates.in>["filter"]
>;
export type CreateTemplateIn = z.infer<typeof canvas.operations.createTemplate.in>;
export type CreateTemplateOut = z.infer<typeof canvas.operations.createTemplate.out>;
export type TemplateSection = CreateTemplateOut["sections"][number];
export type MintTemplateVersionIn = z.infer<typeof canvas.operations.mintTemplateVersion.in>;
export type MintTemplateVersionOut = z.infer<typeof canvas.operations.mintTemplateVersion.out>;
export type ArchiveTemplateOut = z.infer<typeof canvas.operations.archiveTemplate.out>;
export type RestoreTemplateOut = z.infer<typeof canvas.operations.restoreTemplate.out>;
export type PublishTemplateOut = z.infer<typeof canvas.operations.publishTemplate.out>;
export type TrialTemplateOut = z.infer<typeof canvas.operations.trialTemplate.out>;
export type SuggestTemplateSectionsOut = z.infer<typeof canvas.operations.suggestTemplateSections.out>;
export type UpdateTemplateDraftIn = z.infer<typeof canvas.operations.updateTemplateDraft.in>;
export type UpdateTemplateDraftOut = z.infer<typeof canvas.operations.updateTemplateDraft.out>;
export type UpdateTemplateMetadataIn = z.infer<typeof canvas.operations.updateTemplateMetadata.in>;
export type UpdateTemplateMetadataOut = z.infer<typeof canvas.operations.updateTemplateMetadata.out>;
/** #493：「使用一个模板」的返回。`boundTemplateVersion` 是**绑定那一刻**的版本，见用例文件头。 */
export type BindTemplateToSegmentOut = z.infer<
  typeof canvas.operations.bindTemplateToSegment.out
>;

/** 展示文案的单一事实源。状态枚举本身来自契约，这里只给它中文标签。 */
export const TEMPLATE_STATUS_LABEL: Record<TemplateStatus, string> = {
  draft: "草稿",
  trial: "试跑",
  published: "已发布",
  archived: "已归档",
};

export const TEMPLATE_VISIBILITY_LABEL: Record<TemplateVisibility, string> = {
  "org-wide": "全体成员",
  "team-only": "仅某组",
};

/** `filter` 档位也来自契约的 enum，不在界面里另列一份。 */
export const TEMPLATE_FILTERS = canvas.operations.listTemplates.in.shape.filter.unwrap().options;

/** 可见范围档位同理：来自契约的 enum，新建表单不另列一份。 */
export const TEMPLATE_VISIBILITY_OPTIONS = canvas.TemplateVisibility.options;

function templatePath(op: { path: string }, key: string): string {
  return op.path.replace(":key", encodeURIComponent(key));
}

/**
 * 后台模板库与绑定选择器**共用**这一个端口（I-5）。`forBinding` 由调用方说明用途，
 * 服务端据此决定过滤掉 `draft` / `archived`——前端不自己再过滤一遍，
 * 那会变成第二份过滤规则。
 */
export async function listCanvasTemplates(input: {
  readonly orgId: string;
  readonly filter?: ListTemplatesFilter;
  readonly forBinding?: boolean;
}): Promise<ListTemplatesOut> {
  return apiRequest<ListTemplatesOut>(canvas.operations.listTemplates.path, {
    method: "GET",
    query: {
      orgId: input.orgId,
      filter: input.filter,
      forBinding: input.forBinding === undefined ? undefined : String(input.forBinding),
    },
  });
}

/**
 * 🟡 #496，**该契约面待人类补签**（见文件头）。
 *
 * 造出来的是**草稿**：服务端恒回 `status: "draft"` / `version: 1` / `builtin: false`，
 * 三者都不由这里传。⚠ 不要在这里顺手接一个「建完就发布」的复合动作——那会把已签核的
 * 三段发布流程在前端合成一步，而服务端那三段还在原地，两边对同一件事有了两种说法。
 *
 * 冲突（key 已被占用）是 409 + `reasonCode: "TEMPLATE_KEY_CONFLICT"`，原样抛给调用方：
 * 这里不把它翻译成「保存失败」，界面要把它显示成一件用户能自己解决的事。
 */
export async function createCanvasTemplate(input: CreateTemplateIn): Promise<CreateTemplateOut> {
  return apiRequest<CreateTemplateOut>(canvas.operations.createTemplate.path, {
    method: "POST",
    body: {
      key: input.key,
      displayName: input.displayName,
      underlyingType: input.underlyingType,
      sections: input.sections,
      visibility: input.visibility,
      // ⚠ R2：这里逐字段拼 body（不是 `...input`），所以契约每加一栏都必须在这里也加
      //   一次——漏掉的那一栏会**静默丢失**：请求合法、服务端落一个空值、界面显示
      //   使用者填过的东西，三者看起来都对。`tags` 就这么丢过一次，被真栈 e2e 抓到
      //   （前端弹窗里标签胶囊在，落库回来是 `[]`）。
      tags: input.tags ?? [],
    },
  });
}

/**
 * 2026-08-23，**该契约面待人类补签**（同 `createTemplate` 的先例）。
 *
 * 原地改写一个**仍是 draft** 的版本——`displayName`/`sections`/`visibility` 全量替换。
 * 已发布/已归档版本调用它恒被拒（409 `TEMPLATE_NOT_DRAFT`，不变量原样保留），要改
 * 只能走 `mintCanvasTemplateVersion` 开新版。人类原话「新建画布……所有的内容进入编辑的
 * 界面来管理」——这条就是那个编辑界面唯一的写入口。
 */
export async function updateCanvasTemplateDraft(input: UpdateTemplateDraftIn): Promise<UpdateTemplateDraftOut> {
  return apiRequest<UpdateTemplateDraftOut>(templatePath(canvas.operations.updateTemplateDraft, input.key), {
    method: "POST",
    body: {
      key: input.key,
      version: input.version,
      displayName: input.displayName,
      sections: input.sections,
      visibility: input.visibility,
      tags: input.tags ?? [],
    },
  });
}

/**
 * 2026-08-25（R2），**该契约面待人类补签**（同 `updateTemplateDraft` 的先例）。
 *
 * 改名 / 换标签——**任意状态**都能改（不像 `updateCanvasTemplateDraft` 只对 draft
 * 生效）。`sections` 不在入参里：这条路由物理上碰不到内容，「已发布/已归档版本
 * 内容不可变」那条不变量原样保留，见契约操作文件头。
 *
 * ⚠ 路径带两个占位符（`:key` 与 `:version`），所以**不复用** `templatePath`——
 *   那个函数只换 `:key`，漏掉 `:version` 会打到一条不存在的路由上。
 */
export async function updateCanvasTemplateMetadata(
  input: UpdateTemplateMetadataIn,
): Promise<UpdateTemplateMetadataOut> {
  const path = canvas.operations.updateTemplateMetadata.path
    .replace(":key", encodeURIComponent(input.key))
    .replace(":version", String(input.version));
  return apiRequest<UpdateTemplateMetadataOut>(path, {
    method: "POST",
    body: {
      key: input.key,
      version: input.version,
      displayName: input.displayName,
      tags: input.tags ?? [],
    },
  });
}

/**
 * 2026-08-23，**该契约面待人类补签**（同 `createTemplate` 的先例）。
 *
 * 只读——不写模板注册表。`prompt` 是使用者打的模板名字（如「商业模式画布」），返回值
 * **只用来回填新建表单**：使用者仍要看一眼、能改、再调 `createCanvasTemplate` 才真的
 * 建出一行草稿。见契约里 `suggestTemplateSections` 操作的文件头「为什么不直接写库」。
 */
export async function suggestCanvasTemplateSections(
  input: { readonly prompt: string },
): Promise<SuggestTemplateSectionsOut> {
  return apiRequest<SuggestTemplateSectionsOut>(canvas.operations.suggestTemplateSections.path, {
    method: "POST",
    body: { prompt: input.prompt },
  });
}

/**
 * 「基于既有模板开新版」——本束「编辑」的真实语义（#988，人类已签核）。
 *
 * ⚠ `key` 不可改（那是同一条谱系的下一个版本，不是另建一行），`version` 由服务端
 *   算（`max(version)+1`），不接受入参——同 `createTemplate` 恒回 `version: 1` 的理由，
 *   服务端说了算的事不该有一个前端也能填的入参。
 */
export async function mintCanvasTemplateVersion(
  input: MintTemplateVersionIn,
): Promise<MintTemplateVersionOut> {
  return apiRequest<MintTemplateVersionOut>(
    templatePath(canvas.operations.mintTemplateVersion, input.key),
    {
      method: "POST",
      body: {
        key: input.key,
        displayName: input.displayName,
        underlyingType: input.underlyingType,
        sections: input.sections,
        visibility: input.visibility,
        ownerTeamId: input.ownerTeamId,
        tags: input.tags ?? [],
      },
    },
  );
}

export async function publishCanvasTemplate(input: {
  readonly key: string;
  readonly version: number;
  readonly visibility: TemplateVisibility;
}): Promise<PublishTemplateOut> {
  return apiRequest<PublishTemplateOut>(templatePath(canvas.operations.publishTemplate, input.key), {
    method: "POST",
    body: { key: input.key, version: input.version, visibility: input.visibility },
  });
}

export async function trialCanvasTemplate(input: {
  readonly key: string;
  readonly version: number;
  readonly projectId: string;
}): Promise<TrialTemplateOut> {
  return apiRequest<TrialTemplateOut>(templatePath(canvas.operations.trialTemplate, input.key), {
    method: "POST",
    body: { key: input.key, version: input.version, projectId: input.projectId },
  });
}

/**
 * `confirmed: false` 是**预检**：不写库，只把 `stillBoundSegmentCount` 带回来给确认框。
 * 契约明说「返回 0 与不返回是两回事」，所以确认框上的那个数必须来自这次真实预检，
 * 不能在前端拿一个缺省值顶上。
 */
export async function archiveCanvasTemplate(input: {
  readonly key: string;
  readonly version: number;
  readonly confirmed: boolean;
}): Promise<ArchiveTemplateOut> {
  return apiRequest<ArchiveTemplateOut>(templatePath(canvas.operations.archiveTemplate, input.key), {
    method: "POST",
    body: { key: input.key, version: input.version, confirmed: input.confirmed },
  });
}

export async function restoreCanvasTemplate(input: {
  readonly key: string;
  readonly version: number;
}): Promise<RestoreTemplateOut> {
  return apiRequest<RestoreTemplateOut>(templatePath(canvas.operations.restoreTemplate, input.key), {
    method: "POST",
    body: { key: input.key, version: input.version },
  });
}

/**
 * #493 —— 「**使用**一个模板」的写入面：把它绑到一个议程环节。
 *
 * 上面那几个操作动的都是模板注册表**自己**（谁有哪些模板、它们各处在哪一态）；这一个是
 * 第一个把模板**用出去**的操作，也是 `usageCount` / `stillBoundSegmentCount` 两个契约字段的
 * 唯一写入方（`canvas_template_bindings`，见迁移 20260805030000 的文件头）。
 *
 * ⚠ 路径占位符是 `:agendaSegmentId` 而不是 `:key`，所以**不复用** `templatePath`。
 *   给它加一个「替换哪个占位符」的参数，等于让一个函数按调用点决定语义，而替错了
 *   只表现为 404。两个占位符 = 两个替换点，各自只认自己那一个。
 * ⚠ `agendaSegmentId` 路径与 body 都要给（契约 `in` 里有它）；两边不一致时服务端回 400
 *   `agenda_segment_id_mismatch`。这里两处取自同一个变量，前端制造不出那种不一致。
 * ⚠ 失败原样抛：`SEGMENT_TEMPLATE_LIMIT`（同一环节最多两个模板，I-6）与 `TEMPLATE_ARCHIVED`
 *   是用户看得懂、也能自己处理的两件事，糊成一句「绑定失败」就丢掉了这个区别。
 */
export async function bindCanvasTemplateToSegment(input: {
  readonly agendaSegmentId: string;
  readonly templateKey: string;
  readonly templateVersion: number;
}): Promise<BindTemplateToSegmentOut> {
  const op = canvas.operations.bindTemplateToSegment;
  return apiRequest<BindTemplateToSegmentOut>(
    op.path.replace(":agendaSegmentId", encodeURIComponent(input.agendaSegmentId)),
    {
      method: "POST",
      body: {
        agendaSegmentId: input.agendaSegmentId,
        templateKey: input.templateKey,
        templateVersion: input.templateVersion,
      },
    },
  );
}
