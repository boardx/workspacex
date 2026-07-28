/**
 * 七态的类型与纯函数 —— **刻意不带 `"use client"`**。
 *
 * 原因：标了 `"use client"` 的模块，其**全部导出**都会变成客户端引用，
 * 服务端组件 import 进来的是代理而非函数，调用即 `is not a function`。
 * 所以「组件」放 components/state/state-shell.tsx，「类型与纯函数」放这里。
 */
export type UiState =
  | "default" | "loading" | "empty" | "invalid" | "dep-failed" | "denied" | "success";

export const UI_STATES: UiState[] = [
  "default", "loading", "empty", "invalid", "dep-failed", "denied", "success",
];

export const UI_STATE_LABEL: Record<UiState, string> = {
  default: "默认态",
  loading: "加载态",
  empty: "空态",
  invalid: "校验失败态",
  "dep-failed": "依赖失败态",
  denied: "无权限态",
  success: "成功态",
};

/** 从 URL query 读预览状态；生产环境恒为 default（预览开关不可达，UC-0.4 R12 V8）*/
export function resolvePreviewState(raw: string | string[] | undefined): UiState {
  if (process.env.NODE_ENV === "production") return "default";
  const v = Array.isArray(raw) ? raw[0] : raw;
  return UI_STATES.includes(v as UiState) ? (v as UiState) : "default";
}
