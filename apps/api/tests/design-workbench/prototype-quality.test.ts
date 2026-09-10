import { describe, expect, it } from "vitest";
import type { designPrototype } from "@repo/contracts";
import {
  scorePrototypeScreen,
  PROTOTYPE_QUALITY_THRESHOLD,
} from "../../src/application/design-workbench/prototype-quality";

/**
 * 运行期结构自审（issue #3340 的后一半：「界面质量很差，感觉没有迭代就提交了」）。
 *
 * ⚠ 每条指标两个方向都断言。一条永远给高分的指标等于没有这条指标——而这道门要真的
 * 触发重试（多花一次模型调用），误伤和漏判的代价都是实的。
 *
 * ⚠ 阈值不是拍的：用**真实夹具**（`design-loop-fixtures.mjs` 里三页已发布的原型）标定过，
 * 分别是 86 / 87 / 100，都在 70 线之上——门不误伤已知的好页。下面「合格的一页」这条
 * 就是照那三页的形状写的。
 */
type N = designPrototype.PrototypeNode;
const text = (content: string, variant?: string): N =>
  ({ type: "text", props: { content, ...(variant === undefined ? {} : { variant }) } }) as unknown as N;
const stack = (children: N[]): N => ({ type: "stack", children }) as unknown as N;

describe("M1 内容量", () => {
  it("十几个元素的一页 ⇒ 满分", () => {
    const page = stack(Array.from({ length: 14 }, (_, i) => text(`第 ${String(i)} 行`, i === 0 ? "title" : "body")));
    expect(scorePrototypeScreen(page).parts.find((p) => p.metric === "substance")?.score).toBe(1);
  });
  it("只有两个元素 ⇒ 低分，且反馈说得出「几乎是空的」", () => {
    const r = scorePrototypeScreen(stack([text("标题", "title")]));
    const part = r.parts.find((p) => p.metric === "substance")!;
    expect(part.score).toBeLessThan(0.3);
    expect(part.hint).toContain("几乎是空的");
  });
});

describe("M2 层次 —— 用户点名的「标题正文一样大」", () => {
  it("title / body / caption 三档 ⇒ 满分", () => {
    const page = stack([text("标题", "title"), text("正文", "body"), text("注解", "caption")]);
    expect(scorePrototypeScreen(page).parts.find((p) => p.metric === "hierarchy")?.score).toBe(1);
  });
  it("全页一档 ⇒ 重扣，且反馈里给出可照做的改法", () => {
    const page = stack([text("一"), text("二"), text("三")]);
    const part = scorePrototypeScreen(page).parts.find((p) => p.metric === "hierarchy")!;
    expect(part.score).toBeLessThan(0.5);
    expect(part.hint).toContain('variant:"title"');
  });
});

describe("M3 空容器", () => {
  it("没有空容器 ⇒ 满分", () => {
    expect(scorePrototypeScreen(stack([text("有内容")])).parts.find((p) => p.metric === "emptyContainers")?.score).toBe(1);
  });
  it("两个空容器 ⇒ 扣分，且数得出几个", () => {
    const page = stack([text("x"), stack([]), stack([])]);
    const part = scorePrototypeScreen(page).parts.find((p) => p.metric === "emptyContainers")!;
    expect(part.score).toBeLessThan(0.4);
    expect(part.hint).toContain("2 个容器是空的");
  });
});

describe("M4 可操作性", () => {
  it("有按钮 ⇒ 满分", () => {
    const page = stack([text("标题", "title"), { type: "button", props: { label: "确定" } } as unknown as N]);
    expect(scorePrototypeScreen(page).parts.find((p) => p.metric === "affordance")?.score).toBe(1);
  });
  it("一个控件都没有 ⇒ 判 0，反馈里说破「那是一张海报」", () => {
    const part = scorePrototypeScreen(stack([text("只有文字")])).parts.find((p) => p.metric === "affordance")!;
    expect(part.score).toBe(0);
    expect(part.hint).toContain("海报");
  });
});

describe("M5 重复文案", () => {
  it("两次重复还不算填充物 ⇒ 满分", () => {
    const page = stack([text("同一句"), text("同一句"), text("别的")]);
    expect(scorePrototypeScreen(page).parts.find((p) => p.metric === "duplicateCopy")?.score).toBe(1);
  });
  it("四次重复 ⇒ 扣分，且把那句话引出来", () => {
    const page = stack([text("占位文案"), text("占位文案"), text("占位文案"), text("占位文案")]);
    const part = scorePrototypeScreen(page).parts.find((p) => p.metric === "duplicateCopy")!;
    expect(part.score).toBeLessThan(1);
    expect(part.hint).toContain("占位文案");
  });
});

describe("总分与反馈", () => {
  it("合格的一页 ⇒ 过线，且 feedback 为空（没话要对模型说）", () => {
    const page = stack([
      { type: "navbar", props: { title: "设置" } } as unknown as N,
      text("账户", "title"), text("管理你的登录方式与安全选项", "body"), text("上次更新 3 天前", "caption"),
      { type: "list", props: { items: ["手机号", "邮箱", "密码"] } } as unknown as N,
      { type: "switch", props: { label: "两步验证", checked: true } } as unknown as N,
      { type: "button", props: { label: "保存", variant: "primary" } } as unknown as N,
      { type: "divider" } as unknown as N,
      text("危险操作", "subtitle"), text("注销后数据不可恢复", "caption"),
      { type: "button", props: { label: "注销账户", variant: "danger" } } as unknown as N,
      { type: "bottomnav", props: { items: ["首页", "消息", "我的"], active: 2 } } as unknown as N,
    ]);
    const r = scorePrototypeScreen(page);
    expect(r.total).toBeGreaterThanOrEqual(PROTOTYPE_QUALITY_THRESHOLD);
    expect(r.feedback).toBe("");
  });

  /** ⚠ 这条是整道门的验收：用户 #3340 那种「几乎空、无层次、没控件」的页必须判不合格。 */
  it("空壳一页 ⇒ 不合格，且 feedback 逐条告诉模型缺什么", () => {
    const r = scorePrototypeScreen(stack([text("禅学入门"), stack([])]));
    expect(r.total).toBeLessThan(PROTOTYPE_QUALITY_THRESHOLD);
    expect(r.feedback).toContain("元素");
    expect(r.feedback).toContain("字号");
    expect(r.feedback).toContain("海报");
  });

  it("空集防线：树里一个节点都没有 ⇒ 判 0，拒绝下判断", () => {
    // 走不到的形状，但门控不许因为「没发现问题」而判绿（本仓九次全绿空转）。
    const r = scorePrototypeScreen({ type: "stack", children: [] } as unknown as N);
    expect(r.total).toBeLessThan(PROTOTYPE_QUALITY_THRESHOLD);
  });
});
