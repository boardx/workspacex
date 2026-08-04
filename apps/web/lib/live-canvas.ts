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
 * ## 后端**没有**给的东西（缺口，已在 issue #464 报出，不在这里发明）
 *
 * · **创建 / 编辑模板**：签核过的 `canvas.ts` 契约里根本没有创建操作，
 *   `publishTemplate.in` 是 `{key, version, visibility}`——它读一行已存在的，不造一行。
 *   所以「新增模板 → 保存 → 刷新仍在」这条闭环目前**做不出来**，
 *   `template-editor` 屏因此仍是 mock 原型。
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
