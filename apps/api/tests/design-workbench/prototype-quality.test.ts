import { describe, expect, it } from "vitest";
import type { designPrototype } from "@repo/contracts";
import {
  scorePrototypeScreen,
  PROTOTYPE_QUALITY_THRESHOLD,
  PROTOTYPE_QUALITY_RETRY_CAP,
  qualityRetryBudget,
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

/* ───────────────── 迭代 16（#3773 R1）：新加的三条 + 预算 ───────────────── */

const button = (label: string, variant?: string): N =>
  ({ type: "button", props: { label, ...(variant === undefined ? {} : { variant }) } }) as unknown as N;

describe("M2 层次：整页没有文字（#3773 R1-①）", () => {
  it("一个 text 节点都没有 ⇒ 判低分，不是满分", () => {
    // 回归钉：原来 `variants.size === 0` 直接判 1——「没有文字」被当成「没有层次问题」。
    const page = stack([button("开始", "primary"), button("跳过", "ghost")]);
    const part = scorePrototypeScreen(page).parts.find((p) => p.metric === "hierarchy")!;
    expect(part.score).toBeLessThan(0.5);
    expect(part.hint).toContain("没有任何文字节点");
  });
});

describe("M6 主操作（#3773 R1-②）", () => {
  it("恰好一个 primary ⇒ 满分", () => {
    const page = stack([text("标题", "title"), button("保存修改", "primary"), button("取消", "ghost")]);
    expect(scorePrototypeScreen(page).parts.find((p) => p.metric === "primaryFocus")?.score).toBe(1);
  });
  it("三个 primary ⇒ 扣分，且反馈说得出有几个", () => {
    const page = stack([text("标题", "title"), button("A", "primary"), button("B", "primary"), button("C", "primary")]);
    const part = scorePrototypeScreen(page).parts.find((p) => p.metric === "primaryFocus")!;
    expect(part.score).toBeLessThan(0.5);
    expect(part.hint).toContain("3 个 primary");
  });
  it("一个按钮都没有的纯展示页 ⇒ 不扣（主操作可能在 bottomnav 上）", () => {
    const page = stack([text("标题", "title"), text("正文说明", "body")]);
    expect(scorePrototypeScreen(page).parts.find((p) => p.metric === "primaryFocus")?.score).toBe(1);
  });
});

describe("M7 占位文案（#3773 R1-③）", () => {
  it("真实文案 ⇒ 满分", () => {
    const page = stack([text("今天", "title"), button("新增待办", "primary")]);
    expect(scorePrototypeScreen(page).parts.find((p) => p.metric === "placeholderCopy")?.score).toBe(1);
  });
  it("「标题1」「示例文本」这种 ⇒ 扣分并点名", () => {
    const page = stack([text("标题1", "title"), text("示例文本", "body")]);
    const part = scorePrototypeScreen(page).parts.find((p) => p.metric === "placeholderCopy")!;
    expect(part.score).toBeLessThan(1);
    expect(part.hint).toContain("占位文案");
  });
  it("误判防线：文案里**含有**「示例」但不是占位 ⇒ 不扣", () => {
    const page = stack([text("看三个示例问题", "body"), text("标题党检测", "title")]);
    expect(scorePrototypeScreen(page).parts.find((p) => p.metric === "placeholderCopy")?.score).toBe(1);
  });
});

describe("重试预算按页数给（#3773 R1-④）", () => {
  it("页数少时至少给到基础预算", () => {
    expect(qualityRetryBudget(1)).toBeGreaterThanOrEqual(3);
  });
  it("常见的 3–6 页项目 ⇒ 每页各有一次机会", () => {
    expect(qualityRetryBudget(5)).toBe(5);
    expect(qualityRetryBudget(6)).toBe(6);
  });
  it("页数再多也不超过硬顶 ⇒ 用户不会等到翻倍", () => {
    expect(qualityRetryBudget(20)).toBe(PROTOTYPE_QUALITY_RETRY_CAP);
  });
});

describe("门不误伤合格的一页（阈值回归）", () => {
  it("十几个节点、三档字号、唯一 primary、真实文案 ⇒ 过线", () => {
    const page = stack([
      text("我的待办", "title"), text("3 件没做完", "caption"), text("今天", "label"),
      text("买牛奶", "body"), text("写周报", "body"), text("订机票", "body"),
      text("已完成", "label"), text("交房租", "body"), text("回复邮件", "body"),
      button("新增待办", "primary"), button("筛选", "ghost"),
      { type: "input", props: { placeholder: "搜索待办" } } as unknown as N,
    ]);
    expect(scorePrototypeScreen(page).total).toBeGreaterThanOrEqual(PROTOTYPE_QUALITY_THRESHOLD);
  });
});

describe("M8 死路（#3773 R6）", () => {
  const primary = (id?: string): N =>
    ({ ...(id === undefined ? {} : { id }), type: "button", props: { label: "去结算", variant: "primary" } }) as unknown as N;

  it("多页项目里主操作连了线 ⇒ 满分", () => {
    const page = stack([text("购物车", "title"), primary("go")]);
    const part = scorePrototypeScreen(page, { links: [{ from: "go", to: 1 }], screenCount: 3 })
      .parts.find((p) => p.metric === "deadEnds")!;
    expect(part.score).toBe(1);
  });

  it("主操作没有去处 ⇒ 扣分，且反馈点名是哪个按钮", () => {
    // ⭐ 反证锚点：删掉 M8 ⇒ 这条红。「每页的主操作都要有去处」此前只写在提示词里，
    // 表现是用户点进预览按遍所有按钮都没反应。
    const page = stack([text("购物车", "title"), primary("go")]);
    const part = scorePrototypeScreen(page, { links: [], screenCount: 3 })
      .parts.find((p) => p.metric === "deadEnds")!;
    expect(part.score).toBeLessThan(1);
    expect(part.hint).toContain("去结算");
  });

  it("模型没给节点写 id ⇒ 同样判死路（指不到它就连不了线）", () => {
    const part = scorePrototypeScreen(stack([text("购物车", "title"), primary()]), { links: [], screenCount: 3 })
      .parts.find((p) => p.metric === "deadEnds")!;
    expect(part.score).toBeLessThan(1);
    expect(part.hint).toContain("自己给那个节点写 id");
  });

  it("单页项目 ⇒ 不判（没有地方可去，那不是死路）", () => {
    const page = stack([text("购物车", "title"), primary("go")]);
    expect(scorePrototypeScreen(page, { links: [], screenCount: 1 }).parts.find((p) => p.metric === "deadEnds")?.score).toBe(1);
    // 不给 context 时按单页看待——拿不到跳转表就不该凭空判它有死路。
    expect(scorePrototypeScreen(page).parts.find((p) => p.metric === "deadEnds")?.score).toBe(1);
  });

  it("「取消」这种次要按钮没连线 ⇒ 不判（只判主操作与底部导航）", () => {
    const page = stack([
      text("购物车", "title"), primary("go"),
      { type: "button", id: "c", props: { label: "取消", variant: "ghost" } } as unknown as N,
    ]);
    expect(
      scorePrototypeScreen(page, { links: [{ from: "go", to: 1 }], screenCount: 3 })
        .parts.find((p) => p.metric === "deadEnds")?.score,
    ).toBe(1);
  });
});
