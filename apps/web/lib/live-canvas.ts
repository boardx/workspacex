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
 * ## 后端**仍然没有**给的东西（缺口，已报出，不在这里发明）
 *
 * · **编辑模板 / 开新版**：契约里仍然没有 update，也没有「基于既有模板开 v2」，
 *   所以 `createTemplate.out.version` 是 `z.literal(1)`。`template-editor` 那一屏
 *   （分区结构、设计对话、版本历史、回滚）因此**仍是 mock 原型**——它要的是改，不是建。
 *   登记在 `canvas.KNOWN_CONTRACT_GAPS.C_CANVAS_8`。
 * · **`ownerTeamId`**：`visibility: "team-only"` 需要「归哪个团队」，契约没有这一栏。
 *   服务端取创建者自己的团队；创建者无团队时那一行对**所有人不可见**（fail-closed）。
 *   前端**不**替它挑一个团队，也不把这个后果藏起来——界面上如实提示。
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
export type ArchiveTemplateOut = z.infer<typeof canvas.operations.archiveTemplate.out>;
export type RestoreTemplateOut = z.infer<typeof canvas.operations.restoreTemplate.out>;
export type PublishTemplateOut = z.infer<typeof canvas.operations.publishTemplate.out>;
export type TrialTemplateOut = z.infer<typeof canvas.operations.trialTemplate.out>;

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
    },
  });
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
