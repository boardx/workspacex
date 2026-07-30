/**
 * 反证夹具（`lint-design-facet-single-source.mjs`）—— **每一行都必须被抓到**。
 *
 * 断言「脚本退出 0」在空目录下永远为真。这个目录的存在是为了断言脚本**抓到了什么**。
 */

/* 规则 1：谈论分母的行上出现字面量 16 */
export const facetDenominator = 16;

/* 规则 3：第二份五组清单 */
export const groups = ["basic", "pre-input", "onsite", "ai", "output"];

/* 规则 2：一行里塞两个槽位 key */
export const twoOnOneLine = ["topic-and-background", "flow-agenda"];

/* 规则 2b：每行一个 key 的第二份表——第一版规则对它完全沉默 */
export const table = [
  { key: "topic-and-background", label: "主题与背景" },
  { key: "flow-agenda", label: "流程 Agenda" },
  { key: "grouping-rule", label: "分组规则" },
  { key: "roles-and-perms", label: "角色与权限" },
];
