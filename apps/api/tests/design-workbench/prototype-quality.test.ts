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

describe("M6 主操作：破坏性动作也是主操作（迭代 18）", () => {
  const danger = (label: string): N =>
    ({ type: "button", props: { label, variant: "danger" } }) as unknown as N;

  it("生成中的对话页：唯一一个「停止」（danger）⇒ 满分，不判「没有主操作」", () => {
    /*
     * ⭐ 反证锚点：改回「没有 primary 就扣分」⇒ 这条红。
     * 把这类页判成"没有主操作"，等于逼着设计把破坏性动作画成普通主按钮——那才是坏设计。
     */
    const page = stack([text("对话助手", "title"), text("正在生成…", "caption"), danger("停止")]);
    expect(scorePrototypeScreen(page).parts.find((p) => p.metric === "primaryFocus")?.score).toBe(1);
  });

  it("两个 danger 且没有 primary ⇒ 仍然扣分（焦点还是被摊平了）", () => {
    const page = stack([text("设置", "title"), danger("删除账号"), danger("清空数据")]);
    expect(scorePrototypeScreen(page).parts.find((p) => p.metric === "primaryFocus")?.score).toBe(0.5);
  });

  it("有 primary 时 danger 不参与计数（保存 + 删除是正常的一页）", () => {
    const page = stack([
      text("编辑", "title"),
      { type: "button", props: { label: "保存修改", variant: "primary" } } as unknown as N,
      danger("删除"),
    ]);
    expect(scorePrototypeScreen(page).parts.find((p) => p.metric === "primaryFocus")?.score).toBe(1);
  });
});

/**
 * M9（#4327）—— 一排结构相同的内容卡片。形状全部取自真实模型生成（qwen3.8-max）的原样子树，
 * 两个方向各有真实样本：该判的（二手书的书卡）与不该判的（情绪选择的 emoji 格子）。
 */
describe("M9 一排结构相同的内容卡片（一票否决）", () => {
  const card = (children: N[]): N => ({ type: "card", children }) as unknown as N;
  const grid = (children: N[]): N => ({ type: "grid", props: { columns: 2 }, children }) as unknown as N;
  const image = (alt: string): N => ({ type: "image", props: { alt, kind: "photo" } }) as unknown as N;
  const badge = (label: string): N => ({ type: "badge", props: { label } }) as unknown as N;
  /** 一页别处都合格（过线），只看 M9 这一处。 */
  const goodPage = (extra: N): N => stack([
    text("二手书集市", "title"), text("本周新上架 24 本", "caption"), text("推荐", "label"),
    button("发布闲置", "primary"), button("筛选", "ghost"),
    { type: "input", props: { placeholder: "搜书名或作者" } } as unknown as N,
    text("说明", "body"), text("离你最近的卖家", "body"), text("价格", "body"), extra,
  ]);
  const bookCard = (title: string, price: string): N =>
    card([image(`${title}封面`), stack([text(title, "body"), text("九成新", "caption"), stack([text(price), badge("比新书省70%")])])]);
  const moodTile = (emoji: string, label: string): N => card([stack([text(emoji), text(label)])]);

  it("⭐ 反证锚点：4 张一样的书卡（真实样本形状）⇒ 判 0，总分压到线下，反馈给出 list 的改法", () => {
    const report = scorePrototypeScreen(goodPage(grid(["高等数学", "百年孤独", "考研词汇", "Python"].map((t) => bookCard(t, "¥12")))));
    expect(report.parts.find((p) => p.metric === "repeatedCards")?.score).toBe(0);
    expect(report.total).toBeLessThan(PROTOTYPE_QUALITY_THRESHOLD);
    expect(report.feedback).toContain("4 张结构相同的内容卡片");
    expect(report.feedback).toContain("list");
  });

  it("一票否决：同一页去掉那排卡片就过线——压分只来自 M9，不是别的指标", () => {
    expect(scorePrototypeScreen(goodPage(text("没有卡片", "body"))).total).toBeGreaterThanOrEqual(PROTOTYPE_QUALITY_THRESHOLD);
  });

  it("不误伤：「emoji + 一个词」的选项格子（真实样本：情绪选择 6 格）⇒ 满分", () => {
    const tiles = grid([["😊", "平静"], ["😟", "焦虑"], ["😢", "低落"], ["😠", "烦躁"], ["🥰", "开心"], ["😴", "疲惫"]].map(([e, l]) => moodTile(e!, l!)));
    expect(scorePrototypeScreen(goodPage(tiles)).parts.find((p) => p.metric === "repeatedCards")?.score).toBe(1);
  });

  it("不误伤：日历格「数字 + 留白 + 心情标签」（真实样本）⇒ spacer 不算内容，满分", () => {
    const spacer = { type: "spacer", props: { size: "sm" } } as unknown as N;
    const cells = grid([["1", "平静"], ["2", "开心"], ["3", "低落"], ["4", "焦虑"], ["5", "开心"]].map(([d, m]) => card([text(d!), spacer, badge(m!)])));
    expect(scorePrototypeScreen(goodPage(cells)).parts.find((p) => p.metric === "repeatedCards")?.score).toBe(1);
  });

  it("带配图的格子即使叶子少也算（用户截图那种：同一张配图配不同的字）", () => {
    const tiles = grid(["平静", "开心", "焦虑"].map((l) => card([image("心情配图"), text(l)])));
    expect(scorePrototypeScreen(goodPage(tiles)).parts.find((p) => p.metric === "repeatedCards")?.score).toBe(0);
  });

  it("两张一样的卡、或三张结构各不相同 ⇒ 不判", () => {
    const two = grid([bookCard("A", "¥1"), bookCard("B", "¥2")]);
    const mixed = stack([bookCard("A", "¥1"), card([text("a"), text("b"), text("c"), text("d")]), card([image("x"), text("y"), badge("z")])]);
    for (const extra of [two, mixed]) expect(scorePrototypeScreen(goodPage(extra)).parts.find((p) => p.metric === "repeatedCards")?.score).toBe(1);
  });
});

describe("M1 内容量把画布里的元素算进去（design-delta `prototype-board`）", () => {
  it("⭐ 导航栏 + 按钮 + 一块摆了 12 张便签的画布 ⇒ 内容量满分，不被判「几乎是空的」", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ kind: "sticky", text: `真实想法 ${String(i + 1)}`, x: 10 + (i % 4) * 25, y: 20 + Math.floor(i / 4) * 30 }));
    const page = stack([
      { type: "navbar", props: { title: "Q3 头脑风暴" } } as unknown as N,
      button("添加便签", "primary"),
      { type: "board", props: { items } } as unknown as N,
    ]);
    expect(scorePrototypeScreen(page).parts.find((p) => p.metric === "substance")?.score).toBe(1);
  });
  it("画布是空的 ⇒ 照样按节点数扣", () => {
    const page = stack([{ type: "navbar", props: { title: "空白板" } } as unknown as N, { type: "board", props: { items: [] } } as unknown as N]);
    expect(scorePrototypeScreen(page).parts.find((p) => p.metric === "substance")?.score).toBeLessThan(1);
  });
});
