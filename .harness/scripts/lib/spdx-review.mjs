/** SPDX 许可证表达式是否需要人工确认——oss-dependency-inventory 用，单独成文件以便单测。 */

/**
 * 需要人工确认才能随产品再分发的许可证族。列在这里不等于禁用，等于「必须有结论」。
 *
 * ⚠ 2026-09-24 更正：初版只有强 copyleft，且逐字匹配开头——`LGPL-3.0-or-later`（不以 GPL 开头）、
 * `MPL-2.0`、以及 `Apache-2.0 AND LGPL-3.0-or-later` 这类复合表达式全部漏过，报「0 个需确认」。
 * 实际随产品分发的依赖里就有 LGPL 的 libvips 二进制。弱 copyleft 同样有义务（保留声明、允许重链接、
 * 修改过的文件按原许可发布），所以一并列入；复合表达式按 SPDX 语义拆开判断（见 needsReview）。
 */
export const NEEDS_REVIEW = [
  /^AGPL/i, /^GPL-[23]/i, /^LGPL/i, /^MPL/i, /^EPL/i, /^CDDL/i, /^EUPL/i, /^OSL/i, /^CC-BY-SA/i,
  /^SSPL/i, /^BUSL/i, /^BSL/i, /^CC-BY-NC/i, /^Elastic/i, /^commercial/i, /^UNLICENSED$/i, /^SEE LICENSE/i,
];

/**
 * SPDX 表达式是否需要人工确认：`A OR B` 可以任选其一，只有**每个**选项都要确认才算；
 * `A AND B` 要同时满足，**任一**要确认就算。括号只做剥离，本仓实测没有更深的嵌套。
 */
export function needsReview(expr) {
  const flat = expr.replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
  return flat.split(/ OR /i).every((alt) =>
    alt.split(/ AND /i).some((term) => NEEDS_REVIEW.some((re) => re.test(term.trim()))));
}

