/**
 * Ad-hoc（issue #4181）—— `decisionLike` 纯函数：正例命中决定性动词，负例逐条钉住
 * （问句 / 假设 / 转述 / 否定 / 过短），风格与覆盖面对齐 `memory-intent.ts` 自己的测试习惯。
 */
import { describe, expect, it } from "vitest";
import { decisionLike, DECISION_RECALL_LIMIT } from "../../src/domain/knowledge-graph/decision-claim";

describe("decisionLike：正例（决定性动词，且没有落进任何排除规则）", () => {
  it.each([
    "张三决定下周一上线 v2",
    "我决定关注在 211 高校",
    "团队选定了 A 方案",
    "本轮聚焦成本控制",
    "范围已经确定为三个城市",
    "上线时间改为下周三",
    "供应商改成了另一家",
    "预算定为 500 万",
    "会上敲定了排期",
    "这件事张三拍板了",
  ])("%s ⇒ true", (statement) => {
    expect(decisionLike(statement)).toBe(true);
  });
});

describe("decisionLike：负例——问句", () => {
  it.each([
    "这个方向确定了吗？",
    "范围定为三个城市了吗",
    "聚焦哪个方向确定了呢",
    "决定权归谁",
    "谁拍板的这件事",
    "预算到底定为多少",
    "是不是已经选定了 A 方案",
  ])("%s ⇒ false（在问，不是在陈述）", (statement) => {
    expect(decisionLike(statement)).toBe(false);
  });
});

describe("decisionLike：负例——假设 / 条件句", () => {
  it.each([
    "如果决定关注 211 高校，预算要重新算",
    "假如选定了 A 方案，时间就得提前",
    "假设我们确定了范围，下一步就是排期",
    "要是改为下周三，场地要重订",
    "万一决定换供应商，合同要重签",
  ])("%s ⇒ false（还没发生的条件，不是已经拍板的决定）", (statement) => {
    expect(decisionLike(statement)).toBe(false);
  });
});

describe("decisionLike：负例——转述他人说法", () => {
  it.each([
    '张三说"决定换方案"，但还没最终定',
    "李四说决定关注 211 高校",
    "他表示已经选定了 A 方案",
    "对方声称范围定为三个城市",
    "王五说「聚焦成本控制」",
  ])("%s ⇒ false（在转述别人的话，不是本条结论自己在断言）", (statement) => {
    expect(decisionLike(statement)).toBe(false);
  });
});

describe("decisionLike：负例——否定", () => {
  it.each([
    "v2 上线时间还没决定",
    "范围没有确定",
    "供应商还不确定",
    "预算尚未定为具体数字",
    "方案选不定，还在讨论",
    "这件事决定不了，需要再等等",
    "排期确定不了",
    "时间定不下来",
  ])("%s ⇒ false（明确说的是「没有」决定）", (statement) => {
    expect(decisionLike(statement)).toBe(false);
  });
});

describe("decisionLike：负例——过短 / 不含决定性动词", () => {
  it.each([
    "",
    "定",
    "决定",
    "v2 上线由测试组负责",
    "测试环境不稳定会拖慢 v2",
    "季度预算已经批下来了",
  ])("%s ⇒ false", (statement) => {
    expect(decisionLike(statement)).toBe(false);
  });
});

describe("decisionLike：负例——名词 / 形容词用法（评审 2026-09-25 发现的真实误判）", () => {
  it.each([
    "决定权归属尚待明确",
    "价格是这次谈判的决定性因素",
    "这是一个确定性很高的估算",
  ])("%s ⇒ false（裸子串匹配没有词边界意识，会误判成 true）", (statement) => {
    expect(decisionLike(statement)).toBe(false);
  });
});

describe("DECISION_RECALL_LIMIT", () => {
  it("是一个保守的小上限（issue 建议 3–5，这里取 3）", () => {
    expect(DECISION_RECALL_LIMIT).toBe(3);
  });
});
