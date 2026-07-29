/**
 * 字号档位 —— 唯一事实源（UC-0.4 R3 步骤 3 / uiux-standards §1.2 / ADR-013）
 *
 * ⚠ 这是全仓**唯一**允许定义字号档位的地方。
 *   - `tailwind.config.ts` 必须 `import { FONT_SCALE }`，不得手写 fontSize 对象；
 *   - `lib/utils.ts` 的 tailwind-merge 配置必须从 `FONT_SCALE_KEYS` 取值，不得手抄清单；
 *   - `lint-design.sh` §字号 会扫描全仓 `text-<数字>`，表外档位直接 exit 1。
 *
 * 为什么必须单源（uiux-standards §1.2 记录的两次真实事故）：
 * 字号表曾存在三份副本（tailwind fontSize / tailwind-merge 登记 / 代码实际用法）靠人肉对齐。
 * 2026-07-09 修复了其中两份，第三份 24 小时后复发——`text-12` 是表外档位却被实际用了
 * 64 处，tailwind-merge 把它当成文字颜色类、吞掉了 `text-primary-foreground`，
 * 造成"黑底黑字"。**新增字号 = 只改本文件一处。**
 *
 * 档位取值依据：对运行态原型 `WorkspaceX Standalone.html` 的实测统计
 * （16 / 13.33 / 10.5 / 11.5 / 9.5 / 10 / 9 / 11 / 12.5 / 12 / 14 / 8.5 px），
 * 归一到整数 px 台阶。这是一个**信息密度很高的专业工具**，所以低档位比通用产品多。
 */

/** key = 名义 px 值（类名 `text-<key>`），value = [size, { lineHeight, letterSpacing? }] */
export const FONT_SCALE = {
  9: ["0.5625rem", { lineHeight: "0.875rem", letterSpacing: "0.02em" }],
  10: ["0.625rem", { lineHeight: "0.9375rem", letterSpacing: "0.01em" }],
  11: ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.01em" }],
  12: ["0.75rem", { lineHeight: "1.125rem" }],
  13: ["0.8125rem", { lineHeight: "1.25rem" }],
  14: ["0.875rem", { lineHeight: "1.375rem" }],
  16: ["1rem", { lineHeight: "1.5rem" }],
  18: ["1.125rem", { lineHeight: "1.625rem" }],
  20: ["1.25rem", { lineHeight: "1.75rem", letterSpacing: "-0.01em" }],
  24: ["1.5rem", { lineHeight: "2rem", letterSpacing: "-0.015em" }],
  30: ["1.875rem", { lineHeight: "2.375rem", letterSpacing: "-0.02em" }],
} as const satisfies Record<number, [string, { lineHeight: string; letterSpacing?: string }]>;

export type FontScaleKey = keyof typeof FONT_SCALE;

/** 给 tailwind-merge 登记用；也是 lint-design.sh 的白名单来源 */
export const FONT_SCALE_KEYS: string[] = Object.keys(FONT_SCALE);
