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

/**
 * 七态的**固定保留 testid**（2026-07-28 收敛，web-kernel 契约束的 G-1）
 *
 * ⚠ 此前这份映射声明在**两处**：`state-shell.tsx` 的 JSX 里硬编码，
 * `verify-ui-states.sh` 又用 `case $st in invalid) want="err-" ...` 重列一遍。
 * 这是本项目第六次「同一事实声明在两处」的候选——前五次（设计 token / 字号档位 /
 * 丢弃原因枚举 / 撤回链 SLA / 估点）**每一次都真的漂移了**。故提前收敛。
 *
 * 契约本身：**屏处于某态时，该态的保留 testid 必须可被选中**。
 * ⚠ 与**降级粒度无关**——`/tasks` 做的是分区级降级（③ 区失败、其余三区照常），
 *   它仍必须挂 `dep-failed` 这个保留名，否则在七态矩阵里会被判为漏做异常态。
 *
 * 消费者：
 *   · `components/state/state-shell.tsx` —— 渲染时用它
 *   · `scripts/verify-ui-states.sh` —— 用 sed 读本文件（照 lint-design.sh 读 font-scale.ts 的成例）
 *
 * `invalid` 的保留名是**前缀** `err-`（真实 testid 形如 `err-email`），故单列。
 */
export const RESERVED_STATE_TESTID: Record<Exclude<UiState, "default">, string> = {
  loading: "loading",
  empty: "empty",
  invalid: "err-",      // 前缀；实际形如 err-<字段名>
  "dep-failed": "dep-failed",
  denied: "denied",
  success: "saved",
};

/** 默认态没有保留名——它渲染的是正常内容，由各屏自己的 testid 承担 */
export const RESERVED_STATE_TESTID_ENTRIES = Object.entries(RESERVED_STATE_TESTID) as [
  Exclude<UiState, "default">,
  string,
][];
