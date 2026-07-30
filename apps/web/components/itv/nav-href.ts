import type { ItvScreen, ScopeId, ItvView } from "@/lib/mock/itv";
import type { UiState } from "@/lib/ui-state";

/**
 * 统一拼 `/itv` 的预览 URL —— 四个维度全带上，任何跳转都不丢预览上下文：
 *   ?screen= 链路屏 ｜ ?scope= 范围 ｜ ?view= 角色视角 ｜ ?state= 七态
 * scope 默认「研究项目」档（UC-6.0 R8 说默认值需产品确认，此处先取第一档，见 README §待确认）。
 */
export function navHref(opts: {
  screen: ItvScreen;
  view: ItvView;
  state: UiState | string;
  scope?: ScopeId;
}): string {
  const scope = opts.scope ?? "rp-procurement";
  return `?screen=${opts.screen}&scope=${scope}&view=${opts.view}&state=${opts.state}`;
}
