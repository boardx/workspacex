/**
 * 方向 C：整页 HTML 生成模式。fake port，不打真网络。
 * 覆盖：简报解析 / 输出解析与清洗 / 质量评分 / 分页生成整条链路（简报下发、跳转投影、截断降级、质量重问）。
 */
import { describe, expect, it, vi } from "vitest";
import { designPrototype } from "@repo/contracts";
import { ModelDesignChatReplier, type DesignChatContext } from "../../src/application/design-workbench/design-chat-model";
import {
  briefToText, htmlCanvasWidth, parseDesignBrief, parseHtmlPageOutput, pruneInvalidGotos, scoreHtmlPage,
} from "../../src/application/design-workbench/html-page-design";

const BRIEF_RAW = {
  palette: [
    { name: "墨", hex: "#1f2a44" }, { name: "纸", hex: "#f7f5f0" }, { name: "朱", hex: "#c8452c" },
    { name: "雾", hex: "#8a94a6" },
  ],
  type: "标题 Songti SC 28/700，正文 PingFang SC 15/400，说明 12/400",
  layout: "左对齐，单栏，区块之间留白大",
  signature: "所有金额用等宽数字",
};
const BRIEF = parseDesignBrief(BRIEF_RAW)!;

/** 一页过得了质量门的 HTML（三档字号、用了简报三个颜色、有可点、有跳转、文字够多）。 */
function goodPage(goto: number | null, extra = ""): string {
  return (
    `<style>.page{min-height:100vh;display:flex;flex-direction:column;background:#F7F5F0;color:#1F2A44;padding:16px}` +
    `h1{font-size:28px;margin:0 0 8px}p{font-size:15px}.meta{font-size:12px;color:#8A94A6}.cta{background:#C8452C;color:#fff;padding:12px;border:0}</style>` +
    `<div class="page"><h1>本月账单</h1><p>房租 3200 元已于 9 月 1 日扣款，水电费 186.4 元待支付，本月共有 12 笔支出，比上月少 8%。</p>` +
    `<p class="meta">最近同步：今天 09:41，来自工商银行尾号 6621 的账户</p>${extra}` +
    `<button class="cta"${goto === null ? "" : ` data-goto="${String(goto)}"`}>查看明细</button></div>`
  );
}
const wrap = (html: string, notes = "说明一下交互。") => `<notes>${notes}</notes>\n<page>\n${html}\n</page>`;

describe("parseDesignBrief / briefToText", () => {
  it("合法简报：色值统一大写，文字字段保留", () => {
    expect(BRIEF.palette.map((c) => c.hex)).toEqual(["#1F2A44", "#F7F5F0", "#C8452C", "#8A94A6"]);
    expect(briefToText(BRIEF)).toContain("#C8452C");
    expect(briefToText(BRIEF)).toContain("所有金额用等宽数字");
  });
  it("色值不合法的丢掉；合法的不到 3 个 ⇒ 整份不要（不猜不补）", () => {
    expect(parseDesignBrief({ palette: [{ hex: "red" }, { hex: "#12345" }, { hex: "#AABBCC" }] })).toBeUndefined();
    expect(parseDesignBrief("x")).toBeUndefined();
    expect(parseDesignBrief({})).toBeUndefined();
  });
});

describe("parseHtmlPageOutput", () => {
  it("取 <notes> 与 <page>，脚本与外链被清洗", () => {
    const out = parseHtmlPageOutput(wrap(goodPage(1, '<script>alert(1)</script><img src="https://evil.test/a.png">'), "点击去明细页"), { index: 0, screenCount: 2 })!;
    expect(out.notes).toBe("点击去明细页");
    expect(out.html).not.toMatch(/<script|evil\.test/);
    expect(out.removed.length).toBeGreaterThan(0);
  });
  it("<page> 没闭合 ⇒ null（当作截断）；没写标签但确实是 HTML ⇒ 宽容收下；一句大白话 ⇒ null", () => {
    expect(parseHtmlPageOutput("<notes>x</notes><page><div>没写完", { index: 0, screenCount: 1 })).toBeNull();
    expect(parseHtmlPageOutput("```html\n<div>你好，这是一页</div>\n```", { index: 0, screenCount: 1 })?.html).toContain("你好");
    expect(parseHtmlPageOutput("抱歉，我没法做这个", { index: 0, screenCount: 1 })).toBeNull();
  });
  it("指向自己 / 不存在的页的跳转被剪掉，合法的留着", () => {
    const html = '<button data-goto="0">自己</button><button data-goto="9">不存在</button><button data-goto="1">下一页</button>';
    const out = parseHtmlPageOutput(wrap(html), { index: 0, screenCount: 2 })!;
    expect(out.prunedGotos).toBe(2);
    expect(out.html.match(/data-goto="/g)).toHaveLength(1);
    expect(out.html).toContain('data-goto="1"');
    expect(pruneInvalidGotos(out.html, 0, 2).count).toBe(0); // 幂等
  });
});

describe("scoreHtmlPage", () => {
  const ctx = { screenCount: 2, canvasWidth: 393, brief: BRIEF } as const;
  it("好页过线，没有反馈", () => {
    const r = scoreHtmlPage(parseHtmlPageOutput(wrap(goodPage(1)), { index: 0, screenCount: 2 })!.html, ctx);
    expect(r.total).toBeGreaterThanOrEqual(70);
    expect(r.feedback).toBe("");
  });
  it("空壳页：字太少、字阶不足、没有可点、没有跳转 ⇒ 不过线，反馈逐条说缺什么", () => {
    const r = scoreHtmlPage("<style>.a{color:red}</style><div class='a'>你好</div>", ctx);
    expect(r.total).toBeLessThan(70);
    for (const s of ["可见文字只有", "档字号", "没有任何可操作", "data-goto"]) expect(r.feedback).toContain(s);
  });
  it("固定宽度超过画布 ⇒ 扣分并说出数字", () => {
    const r = scoreHtmlPage(goodPage(1).replace(".page{", ".page{width:900px;"), ctx);
    expect(r.parts.find((p) => p.metric === "overflow")?.score).toBe(0);
    expect(r.feedback).toContain("900px");
  });
  it("占位文案按片段判（不是对整页文字判）", () => {
    const r = scoreHtmlPage(goodPage(1, "<h2>标题1</h2>"), ctx);
    expect(r.parts.find((p) => p.metric === "placeholderCopy")?.score).toBeLessThan(1);
  });
  it("一排四张同样的卡片 ⇒ 一票否决", () => {
    const cards = '<div class="card">a项目</div>'.repeat(4);
    const r = scoreHtmlPage(goodPage(1, cards), ctx);
    expect(r.total).toBeLessThan(70);
    expect(r.feedback).toContain("卡片重复");
  });
  it("没有简报时不因色板扣分", () => {
    expect(scoreHtmlPage(goodPage(1), { screenCount: 2, canvasWidth: 393 }).parts.find((p) => p.metric === "palette")?.score).toBe(1);
  });
  it("画布宽度取真实设备宽", () => {
    expect([htmlCanvasWidth("mobile"), htmlCanvasWidth("wireframe"), htmlCanvasWidth("ui")]).toEqual([393, 820, 1280]);
  });
});

/* ───────────────────────── 整条链路 ───────────────────────── */

const CTX: DesignChatContext = {
  name: "记账", template: "mobile", problem: "", criteria: [], frames: [], prototype: [],
  chat: [{ role: "user", text: "做一个个人记账 app", at: "2026-09-30T00:00:00.000Z" }],
};
const OUTLINE = JSON.stringify({
  reply: "规划了两页。", tone: "面向月薪族、克制、以本月结余为视觉重点", accent: "blue",
  brief: BRIEF_RAW, outline: [{ frame: "账单", intent: "看本月账单" }, { frame: "明细", intent: "看每一笔" }],
});

function harness(pageReply: (user: string, n: number) => string | { text: string; truncated?: boolean } | Promise<{ text: string; truncated?: boolean }>) {
  let pageCalls = 0;
  const complete = vi.fn(async (input: { system: string; user: string }) => {
    if (input.system.includes("设计基调")) return { text: OUTLINE };
    pageCalls += 1;
    const r = await pageReply(input.user, pageCalls);
    return typeof r === "string" ? { text: r } : r;
  });
  const r = new ModelDesignChatReplier({ model: { complete } as never, chatModel: { provider: "p", modelId: "m" }, log: vi.fn(), htmlPages: true });
  return { r, complete };
}

describe("HTML 模式分页生成", () => {
  it("骨架轮要简报；每页轮带着简报与 HTML 提示词；产出是 html 节点，links 是 HTML 的投影", async () => {
    const { r, complete } = harness((user) => wrap(user.includes("「账单」") && user.includes("现在只画第 0 页") ? goodPage(1) : goodPage(0)));
    const out = await r.reply(CTX);
    expect(out.source).toBe("model");
    const outlineCall = complete.mock.calls.find((c) => c[0].system.includes("设计基调"))![0];
    expect(outlineCall.system).toContain("brief");
    expect(outlineCall.user).toContain("设计宽度 393px");
    const pageCalls = complete.mock.calls.map((c) => c[0]).filter((c) => !c.system.includes("设计基调"));
    expect(pageCalls).toHaveLength(2);
    for (const c of pageCalls) {
      expect(c.system).toContain("<page>");
      expect(c.user).toContain("#C8452C");
      expect(c.user).toContain("所有金额用等宽数字");
    }
    // 第二页的上下文里带着第一页的 CSS（风格锚）
    expect(pageCalls[1]!.user).toContain("font-size:28px");

    const screens = out.pagedScreens!;
    expect(screens.map((s) => s.frame)).toEqual(["账单", "明细"]);
    for (const s of screens) {
      expect(s.root?.type).toBe("html");
      expect(designPrototype.PrototypeScreen.safeParse({ frame: s.frame, root: s.root, notes: s.notes, links: s.links }).success).toBe(true);
    }
    expect(screens[0]!.links).toHaveLength(1);
    expect(screens[0]!.links![0]!.to).toBe(1);
    expect(designPrototype.validateLinks(screens.map((s) => ({ root: s.root, links: s.links }))).dropped).toEqual([]);
  });

  it("模型写了脚本与外链 ⇒ 落库的 HTML 里没有", async () => {
    const { r } = harness(() => wrap(goodPage(1, '<script>steal()</script><a href="https://evil.test">x</a>')));
    const out = await r.reply(CTX);
    expect(JSON.stringify(out.pagedScreens)).not.toMatch(/steal|evil\.test|<script/);
  });

  it("截断 ⇒ 同一页带「更精炼」再来一次，成了就收下", async () => {
    const { r, complete } = harness((_u, n) => (n === 1 ? { text: "<notes>x</notes><page><div>没写", truncated: true } : wrap(goodPage(0))));
    const out = await r.reply({ ...CTX });
    expect(out.pagedScreens!.every((s) => s.root !== undefined)).toBe(true);
    expect(complete.mock.calls.some((c) => c[0].user.includes("更精炼"))).toBe(true);
  });

  it("质量不过线 ⇒ 带着逐条反馈和上一版重问一次，只留更好的", async () => {
    const weak = "<style>.a{color:red}</style><div class='a'>你好</div>";
    const { r, complete } = harness((user, n) => (n === 1 ? wrap(weak) : user.includes("问题逐条如下") ? wrap(goodPage(1)) : wrap(goodPage(0))));
    const out = await r.reply(CTX);
    const retry = complete.mock.calls.map((c) => c[0]).find((c) => c.user.includes("问题逐条如下"))!;
    expect(retry.user).toContain("可见文字只有");
    expect(retry.user).toContain("你好"); // 带上一版
    expect(JSON.stringify(out.pagedScreens![0]!.root)).toContain("本月账单");
  });

  it("重问结果更差 ⇒ 保留原来那版", async () => {
    const ok = goodPage(1).replace("<button", "<button"); // 过线但不满分，不会触发重问；换个略差的
    const mid = "<style>.a{font-size:14px;font-size:20px}</style><div class='a'>月度账单概览：房租、水电、餐饮、交通共四项支出，合计 4,120 元，比上月少 8%，请在月底前核对每一笔。</div><button>查看</button>";
    const worse = "<div>空</div>";
    const { r } = harness((user, n) => (user.includes("问题逐条如下") ? wrap(worse) : wrap(n === 1 ? mid : ok)));
    const out = await r.reply(CTX);
    expect(JSON.stringify(out.pagedScreens![0]!.root)).toContain("月度账单概览");
  });

  it("某页始终写不出 ⇒ 只丢那一页，回复里说清", async () => {
    const { r } = harness((user) => (user.includes("现在只画第 1 页") ? "抱歉我做不到" : wrap(goodPage(1))));
    const out = await r.reply(CTX);
    expect(out.pagedScreens![0]!.root).toBeDefined();
    expect(out.pagedScreens![1]!.root).toBeUndefined();
    expect(out.text).toContain("没画出来");
  });

  it("关闭 HTML 模式 ⇒ 骨架轮不要简报，走组件树", async () => {
    const complete = vi.fn(async (_input: { system: string; user: string }) => ({ text: OUTLINE }));
    const r = new ModelDesignChatReplier({ model: { complete } as never, chatModel: { provider: "p", modelId: "m" }, log: vi.fn() });
    await r.reply(CTX);
    expect(complete.mock.calls[0]![0].system).not.toContain("brief");
  });
});

/* ───────────────────────── 局部修改 ───────────────────────── */

describe("HTML 页局部修改", () => {
  const page0 = parseHtmlPageOutput(wrap(goodPage(1)), { index: 0, screenCount: 2 })!.html;
  const page1 = parseHtmlPageOutput(wrap(goodPage(0)), { index: 1, screenCount: 2 })!.html;
  
  const editCtx = (ref: string | undefined, text: string): DesignChatContext => ({
    ...CTX, frames: ["账单", "明细"], prototype: [{ id: "p0", type: "html", props: { html: page0 } }, { id: "p1", type: "html", props: { html: page1 } }],
    focus: { id: "p0", frame: "账单", path: ["整页版面"], node: {}, html: { page: page0, ...(ref === undefined ? {} : { ref }) } },
    chat: [{ role: "user", text, at: "2026-09-30T00:00:00.000Z" }],
  });
  const make = (reply: (user: string, system: string) => string) => {
    const complete = vi.fn(async (i: { system: string; user: string }) => ({ text: reply(i.user, i.system) }));
    return { r: new ModelDesignChatReplier({ model: { complete } as never, chatModel: { provider: "p", modelId: "m" }, log: vi.fn(), htmlPages: true }), complete };
  };

  it("选中元素 ⇒ 只把这个元素 + 页面 CSS 发给模型，只替换这一个元素，整页其余逐字不动", async () => {
    const ref = /data-ref="(r\d+)"[^>]*>本月账单/.exec(page0)![1]!;
    const { r, complete } = make(() => "<reply>标题改成了更具体的。</reply><element><h1 class=\"t\">9 月账单</h1></element><css>.t{letter-spacing:.02em}</css>");
    const out = await r.reply(editCtx(ref, "把标题改成 9 月账单"));
    const sent = complete.mock.calls[0]![0];
    expect(sent.user).toContain("本月账单");
    expect(sent.user).not.toContain("查看明细"); // 没发整页，只发被选中的元素
    expect(sent.system).not.toContain("页面根元素用");
    expect(sent.system).toContain("不要新增 page 根容器");
    expect(sent.user).toContain("font-size:28px"); // 但带着页面 CSS
    expect(out.text).toBe("标题改成了更具体的。");
    const [setProps, setLinks] = out.writeback.patch!;
    expect(setProps).toMatchObject({ op: "setProps", id: "p0" });
    const html = (setProps as unknown as { props: { html: string } }).props.html;
    expect(html).toContain("9 月账单");
    expect(html).toContain("letter-spacing:.02em");
    expect(html).toContain("查看明细"); // 其余保留
    expect(html).toContain('data-goto="1"');
    expect(html).not.toContain("本月账单");
    expect(setLinks).toMatchObject({ op: "setLinks", screen: 0 });
    // 整条 patch 能被契约应用
    const applied = designPrototype.applyPrototypePatch(
      [{ root: { id: "p0", type: "html", props: { html: page0 } } }, { root: { id: "p1", type: "html", props: { html: page1 } } }] as never,
      out.writeback.patch!,
    );
    expect(JSON.stringify(applied[0])).toContain("9 月账单");
  });

  it("模型在元素里夹带脚本 ⇒ 被清洗", async () => {
    const ref = /data-ref="(r\d+)"[^>]*>本月账单/.exec(page0)![1]!;
    const { r } = make(() => "<element><h1>x</h1><script>steal()</script></element>");
    const out = await r.reply(editCtx(ref, "改"));
    expect(JSON.stringify(out.writeback)).not.toMatch(/steal|<script/);
  });

  it("元素编号失效 ⇒ 页面保持原样，不扩大到整页修改", async () => {
    const { r, complete } = make(() => `<reply>整页改了。</reply>${wrap(goodPage(1))}`);
    const out = await r.reply(editCtx("r9999", "加一段说明"));
    expect(out.source).toBe("fallback");
    expect(complete).not.toHaveBeenCalled();
    expect(out.writeback).toEqual({});
  });

  it("元素输出无效或截断 ⇒ 不再调用整页模型，不修改未选中内容", async () => {
    const ref = /data-ref="(r\d+)"[^>]*>本月账单/.exec(page0)![1]!;
    const { r, complete } = make(() => `<reply>整页改了。</reply>${wrap(goodPage(1))}`);
    const out = await r.reply(editCtx(ref, "只改标题"));
    expect(complete).toHaveBeenCalledTimes(1);
    expect(out.source).toBe("fallback");
    expect(out.writeback).toEqual({});
  });

  it("选中整页（没有元素）⇒ 整页在原有基础上改；新增的 data-goto 会重算 links；指向自己的被剪掉", async () => {
    const { r, complete } = make(() => `<reply>加了返回。</reply>${wrap(goodPage(1, '<a data-goto="1">返回明细</a><a data-goto="0">自己</a>'))}`);
    const out = await r.reply(editCtx(undefined, "加一个去明细的入口"));
    expect(complete.mock.calls[0]![0].user).toContain("本月账单"); // 整页 HTML 发了过去
    const links = (out.writeback.patch![1] as { links: { to: number }[] }).links;
    expect(links.length).toBe(2);
    expect(links.every((l) => l.to === 1)).toBe(true);
  });

  it("模型没给出可用输出 ⇒ 固定回执，不写一页坏数据", async () => {
    const { r } = make(() => "抱歉我没法改");
    const out = await r.reply(editCtx(undefined, "改一下"));
    expect(out.source).toBe("fallback");
    expect(out.writeback).toEqual({});
  });

  it("树形 prompt 里 HTML 页只留摘要，不塞整页 HTML", async () => {
    const complete = vi.fn(async (_i: { system: string; user: string }) => ({ text: '{"reply":"好的","writeback":{}}' }));
    const r = new ModelDesignChatReplier({ model: { complete } as never, chatModel: { provider: "p", modelId: "m" }, log: vi.fn() });
    await r.reply({ ...editCtx(undefined, "随便聊聊"), focus: undefined });
    const user = complete.mock.calls[0]![0].user;
    expect(user).not.toContain("font-size:28px");
    expect(user).toContain("整页版面");
  });
});
