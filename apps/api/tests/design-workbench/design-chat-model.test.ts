/**
 * UC-17.8 B5.2 —— `ModelDesignChatReplier` 与 `parseWriteback` 的正反例。fake port，不打真网络。
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { designPrototype, designWorkbench as C } from "@repo/contracts";
import { MODEL_CALL_IMAGE_MIMES, ModelCallError } from "../../src/application/agent-run/ports";
import {
  DESIGN_CHAT_SYSTEM_PROMPT,
  DESIGN_ONE_SCREEN_SYSTEM_PROMPT,
  DESIGN_OUTLINE_SYSTEM_PROMPT,
  DESIGN_PRINCIPLES,
  DESIGN_QUALITY_BAR,
  SCREEN_CONCURRENCY,
  CHAT_HISTORY_MAX_TURNS,
  CHAT_TURN_MAX_CHARS,
  ModelDesignChatReplier,
  parseSuggestions,
  parseWriteback,
  type DesignChatContext,
} from "../../src/application/design-workbench/design-chat-model";

const CTX: DesignChatContext = {
  name: "导出改版",
  template: "wireframe",
  problem: "导出太慢",
  criteria: ["明确问题与目标范围"],
  frames: ["草稿页 1"],
  // 迭代 12：**非空**——这些用例测的是「在一个已有原型的项目上聊天」（改验收标准、局部 patch），
  // 走的是单次调用那条路。首次生成（`prototype` 为空）走分页，另有一组用例。
  prototype: [{ id: "n1", type: "stack", children: [{ id: "n2", type: "text", props: { content: "占位" } }] }],
  chat: [
    { role: "user", text: "先聊聊", at: "2026-09-05T00:00:00.000Z" },
    { role: "ai", text: "好的", at: "2026-09-05T00:00:01.000Z", source: "model" },
    { role: "user", text: "把成功率写进验收标准", at: "2026-09-05T00:00:02.000Z" },
  ],
};

function replier(complete: (input: { system: string; user: string }) => Promise<{ text: string }>) {
  const log = vi.fn();
  const model = { complete: vi.fn(complete) };
  const r = new ModelDesignChatReplier({ model: model as never, chatModel: { provider: "p", modelId: "m" }, log });
  return { r, model, log };
}

describe("B5.2 ModelDesignChatReplier", () => {
  it("prompt 含项目五个字段与按序历史；JSON 输出 ⇒ reply 文字 + 逐字段解析的 writeback；不传 threadId", async () => {
    const { r, model } = replier(async () =>
      ({ text: '{"reply":"加上了。","writeback":{"criteria":["导出成功率 ≥ 99%"],"frames":[],"name":"改名"}}' }),
    );
    const out = await r.reply(CTX);
    expect(out).toEqual({ text: "加上了。", source: "model", writeback: { criteria: ["导出成功率 ≥ 99%"] }, suggestions: [] }); // 空数组丢弃；name 不是可写回字段
    const input = model.complete.mock.calls[0]?.[0];
    expect(input).toMatchObject({ modelProvider: "p", modelId: "m", system: DESIGN_CHAT_SYSTEM_PROMPT });
    expect(input).not.toHaveProperty("threadId");
    for (const s of ["导出改版", "wireframe", "导出太慢", "明确问题与目标范围", "草稿页 1", "用户：先聊聊", "助手：好的", "用户：把成功率写进验收标准"]) {
      expect(input?.user).toContain(s);
    }
    expect(input?.user.indexOf("用户：先聊聊")).toBeLessThan(input?.user.indexOf("用户：把成功率") ?? -1);
  });

  it("迭代 7 修复轮：首轮 prototype 不合法 ⇒ 带原话理由再问一次；修复轮合法 ⇒ 用它；修复轮也失败 ⇒ 保留首轮合法字段与回复", async () => {
    const bad = '{"reply":"画好了。","writeback":{"criteria":["c1"],"prototype":[{"frame":"聊天","root":{"type":"iframe"}}]}}';
    /*
     * 迭代 16（#3773 R5）：修复轮产出的页**也要过质量门**了，所以这里的"修好了"那一页
     * 必须本身是一页说得过去的界面——否则会多出一次质量重问，这条用例就不再是在测修复轮。
     * 这正是本轮要的效果：迭代产出的页不再无人把关（另有用例专门钉它）。
     */
    const goodRoot = {
      type: "stack",
      children: [
        { type: "text", props: { content: "客服会话", variant: "title" } },
        { type: "text", props: { content: "12 条待回复", variant: "caption", muted: true } },
        { type: "text", props: { content: "今天", variant: "label" } },
        { type: "list", props: { items: ["王女士：订单还没发货", "李先生：想改收货地址", "赵小姐：申请退款"], leading: "avatar" } },
        { type: "text", props: { content: "已处理", variant: "label" } },
        { type: "list", props: { items: ["陈先生：发票抬头", "周女士：尺码咨询"], leading: "avatar" } },
        { type: "input", props: { placeholder: "搜索会话" } },
        { type: "button", props: { label: "开始回复", variant: "primary", full: true } },
      ],
    };
    const good = `{"reply":"修好了。","writeback":{"prototype":[{"frame":"聊天","root":${JSON.stringify(goodRoot)}}]}}`;
    let n = 0;
    const ok = replier(async () => ({ text: (n += 1) === 1 ? bad : good }));
    const out = await ok.r.reply(CTX);
    expect(ok.model.complete).toHaveBeenCalledTimes(2);
    const repairPrompt = ok.model.complete.mock.calls[1]?.[0]?.user ?? "";
    expect(repairPrompt).toContain("没通过契约校验");
    expect(repairPrompt).toContain("prototype");
    expect(out.text).toBe("画好了。"); // 回复文字沿用首轮
    expect(out.writeback).toEqual({ criteria: ["c1"], prototype: [{ frame: "聊天", root: goodRoot }] });

    let m = 0;
    const stillBad = replier(async () => { m += 1; if (m === 1) return { text: bad }; throw new Error("boom"); });
    const out2 = await stillBad.r.reply(CTX);
    expect(stillBad.model.complete).toHaveBeenCalledTimes(2);
    expect(out2).toEqual({ text: "画好了。", source: "model", writeback: { criteria: ["c1"] }, suggestions: [] });

    // 修复轮 prototype 仍不合法但夹带合法 criteria ⇒ 不采纳修复轮的任何字段，首轮 criteria 保留（Codex P1）
    let q = 0;
    const partial = replier(async () => ({ text: (q += 1) === 1 ? bad : '{"reply":"x","writeback":{"criteria":["被覆盖的"],"prototype":[{"frame":"f","root":{"type":"iframe"}}]}}' }));
    const out3 = await partial.r.reply(CTX);
    expect(out3.writeback).toEqual({ criteria: ["c1"] });
    // 只有文字字段被拒 ⇒ 不发修复轮
    const textOnly = replier(async () => ({ text: '{"reply":"x","writeback":{"criteria":[]}}' }));
    await textOnly.r.reply(CTX);
    expect(textOnly.model.complete).toHaveBeenCalledTimes(1);
  });

  it("迭代 7 纠偏只按「类型.键」转数字：stat.value 字符串保留；patch 节点超深 ⇒ 字段拒不 500", () => {
    const out = parseWriteback({ prototype: [{ frame: "p", root: { type: "stat", props: { label: "对话数", value: "1284" } } }] });
    expect(out.prototype?.[0]?.root).toEqual({ type: "stat", props: { label: "对话数", value: "1284" } });
    let n: unknown = { type: "divider" };
    for (let i = 0; i < 5000; i += 1) n = { type: "stack", children: [n] };
    expect(parseWriteback({ criteria: ["a"], patch: [{ op: "replace", id: "n1", node: n }] })).toEqual({ criteria: ["a"] });
  });

  it("迭代 7 纠偏：type 大小写 / 容器漏 children / 数字字符串 / divider 带 props 在过契约前被修正", () => {
    const out = parseWriteback({ prototype: [{ frame: "p", root: { type: "Stack", children: [
      { type: "grid", props: { columns: "2" } },
      { type: "divider", props: {} },
      { type: "progress", props: { value: "68" } },
      { type: "text", props: { content: "x" }, children: [] },
    ] } }] });
    expect(out.prototype?.[0]?.root).toEqual({ type: "stack", children: [
      { type: "grid", props: { columns: 2 }, children: [] },
      { type: "divider" },
      { type: "progress", props: { value: 68 } },
      { type: "text", props: { content: "x" } },
    ] });
  });

  it("迭代 9 suggestions：逐条过契约、最多 3 条、trim；prompt 含设计原则与 few-shot", async () => {
    const r = replier(async () => ({ text: JSON.stringify({ reply: "好。", suggestions: [" 加筛选 ", "x".repeat(50), "设计详情页", "第四条", 42] }) }));
    const out = await r.r.reply(CTX);
    expect(out.suggestions).toEqual(["加筛选", "设计详情页", "第四条"]);
    expect(DESIGN_CHAT_SYSTEM_PROMPT).toContain("设计原则");
    expect(DESIGN_CHAT_SYSTEM_PROMPT).toContain("示例 2");
    expect(parseSuggestions("nope")).toEqual([]);
  });

  it("模型抛错 / 空输出 ⇒ 退路 + 原因 + 空 writeback，不抛", async () => {
    // 2026-09-07：三种退路各有各的下一步——「没配 provider」要找运维，「调用失败」可以重试，
    // 「输出为空」换个说法就行。合并成一句"模型不可用"，用户就无从判断该等还是该去修。
    const failing = replier(async () => { throw new ModelCallError("MODEL_PROVIDER_NOT_CONFIGURED", "none"); });
    expect(await failing.r.reply(CTX)).toEqual({ text: C.DESIGN_WORKBENCH_CHAT_REPLY, source: "fallback", writeback: {}, suggestions: [], fallbackReason: "MODEL_NOT_CONFIGURED" });
    expect(failing.log).toHaveBeenCalled();
    const broken = replier(async () => { throw new ModelCallError("MODEL_CALL_FAILED", "boom"); });
    expect((await broken.r.reply(CTX)).fallbackReason).toBe("MODEL_CALL_FAILED");
    const empty = replier(async () => ({ text: " " }));
    expect(await empty.r.reply(CTX)).toEqual({ text: C.DESIGN_WORKBENCH_CHAT_REPLY, source: "fallback", writeback: {}, suggestions: [], fallbackReason: "MODEL_EMPTY_OUTPUT" });
  });

  /**
   * 2026-09-07 用户实测：模型一次整页重画 5 页，输出超上限被**截断**，JSON 没闭合、parse 失败，
   * 于是半截 JSON 被当成聊天回复**原样泼进对话框**。截断的输出是失败，不是回复。
   */
  it("看着是 JSON 却解析不了（截断）⇒ 判 MODEL_BAD_JSON，绝不把半截 JSON 当回复显示", async () => {
    const truncated = '{"reply":"已在各页 notes 中补充完整的路由跳转逻辑","suggestions":["加一个错误提示页"],"writeback":{"prototype":[{"frame":"对话","root":{"id":"n1","type":"stack","children":[{"id":"n2"';
    const r = replier(async () => ({ text: truncated }));
    const out = await r.r.reply(CTX);
    expect(out.fallbackReason).toBe("MODEL_BAD_JSON");
    expect(out.source).toBe("fallback");
    expect(out.writeback).toEqual({});
    // 关键：那句"已经补充好了"不能出现在屏上——写回一个字都没生效
    expect(out.text).not.toContain("已在各页");
    expect(out.text).not.toContain("writeback");
  });

  it("输出不是 JSON ⇒ 整段当回复（source=model），不写回；JSON 无 reply ⇒ 文字退路但 writeback 仍生效", async () => {
    const plain = replier(async () => ({ text: "我觉得可以先把导出拆成两步。" }));
    expect(await plain.r.reply(CTX)).toEqual({ text: "我觉得可以先把导出拆成两步。", source: "model", writeback: {}, suggestions: [] });
    const noReply = replier(async () => ({ text: '{"writeback":{"problem":"新背景"}}' }));
    expect(await noReply.r.reply(CTX)).toEqual({ text: C.DESIGN_WORKBENCH_CHAT_REPLY, source: "fallback", writeback: { problem: "新背景" }, suggestions: [], fallbackReason: "MODEL_NO_REPLY_TEXT" });
  });

  it("B5.3 prototype 写回：合法整页树保留；一页超限 ⇒ 整个 prototype 字段丢、其余字段照写；prompt 含当前原型与原语说明", async () => {
    const screen = { frame: "聊天", root: { type: "stack", children: [{ type: "text", props: { content: "hi" } }] } };
    const { r, model } = replier(async () => ({ text: JSON.stringify({ reply: "画好了。", writeback: { prototype: [screen] } }) }));
    const out = await r.reply({ ...CTX, prototype: [{ type: "divider" }] });
    expect(out.source).toBe("model");
    expect(out.writeback).toEqual({ prototype: [screen] });
    const input = model.complete.mock.calls[0]?.[0];
    expect(input?.user).toContain('"type":"divider"');
    expect(DESIGN_CHAT_SYSTEM_PROMPT).toContain("navbar");
    expect(DESIGN_CHAT_SYSTEM_PROMPT).toContain("setProps"); // 迭代 1：patch 说明进 prompt
    const focused = replier(async () => ({ text: "{}" }));
    await focused.r.reply({ ...CTX, focus: { id: "n2", frame: "聊天", path: ["纵向布局", "按钮「发送」"], node: { id: "n2", type: "button" } } });
    expect(focused.model.complete.mock.calls[0]?.[0]?.user).toContain("选中了节点 id=n2"); // 迭代 2
    expect(parseWriteback({ patch: [{ op: "remove", id: "n2" }] })).toEqual({ patch: [{ op: "remove", id: "n2" }] });
    const bad = { frame: "x", root: { type: "iframe" } };
    expect(parseWriteback({ criteria: ["a"], prototype: [screen, bad] })).toEqual({ criteria: ["a"] });
  });

  it("B5.3 几千层嵌套的 prototype：不打爆调用栈，只丢 prototype 字段，其余照写", () => {
    let n: unknown = { type: "divider" };
    for (let i = 0; i < 5000; i += 1) n = { type: "stack", children: [n] };
    const log = vi.fn();
    expect(parseWriteback({ criteria: ["a"], prototype: [{ frame: "x", root: n }] }, log)).toEqual({ criteria: ["a"] });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("rejected"), expect.objectContaining({ field: "prototype", reason: "depth" }));
  });

  it("parseWriteback：逐字段过契约——非法字段丢、合法保留；非对象 ⇒ {}", () => {
    expect(parseWriteback({ problem: "", criteria: ["a"], frames: "x" })).toEqual({ criteria: ["a"] });
    expect(parseWriteback({ criteria: new Array(21).fill("a") })).toEqual({});
    expect(parseWriteback(null)).toEqual({});
    expect(parseWriteback(["a"])).toEqual({});
  });
});

/**
 * 迭代 12（delta `paged-generation-and-doc-export` §1）—— V36 / V37 / V38 / V40。
 * 首次生成从「一次调用吐出所有页」改成「一次骨架 + 每页一次」。
 */
/**
 * 一页「像真界面」的 root（导航 + 三档字号 + 可操作控件）。
 *
 * issue #3340 起生成路径上有结构自审：空壳页会被带着反馈重问一次，调用次数随之变化。
 * 测分页 / 参考图 / 截断降级的用例都不该被那条打扰，所以桩页统一用这个形状。
 * ⚠ 抄第三遍就是「同一事实两处」——只此一份。
 */
const REAL_PAGE_CHILDREN =
  `{"type":"navbar","props":{"title":"页"}},` +
  `{"type":"text","props":{"content":"标题","variant":"title"}},` +
  `{"type":"text","props":{"content":"正文说明","variant":"body"}},` +
  `{"type":"text","props":{"content":"辅助","variant":"caption"}},` +
  `{"type":"list","props":{"items":["一","二","三"]}},` +
  `{"type":"divider"},` +
  `{"type":"input","props":{"placeholder":"输入"}},` +
  `{"type":"button","props":{"label":"继续","variant":"primary"}},` +
  `{"type":"bottomnav","props":{"items":["首页","消息","我的"],"active":0}}`;

describe("迭代 12：分页生成", () => {
  /** 空项目 = 还没有任何树 ⇒ 走分页。 */
  const EMPTY: DesignChatContext = { ...CTX, prototype: [], frames: [] };
  /**
   * 桩页要**像一页真界面**：有导航、三档字号、可操作控件。
   *
   * issue #3340 起，生成路径上多了一道结构自审（`prototype-quality`），不合格的页会被
   * 带着反馈重问一次。本组用例测的是**分页**（调用次数、哪一页失败），不是质量——
   * 桩页要是个空壳，自审就会触发、调用次数被搅乱，这些断言测的就不再是它们要测的东西。
   *
   * ⚠ 修法是把桩页做成真页的形状，**不是**把自审的线调松：真实夹具里三页已发布的原型
   * 分别是 86 / 87 / 100 分，production 的页本来就该长这样。
   */
  const screenJson = (frame: string) =>
    `{"frame":"${frame}","root":{"type":"stack","children":[` +
    `{"type":"navbar","props":{"title":"${frame}"}},` +
    `{"type":"text","props":{"content":"${frame}的内容","variant":"title"}},` +
    `{"type":"text","props":{"content":"${frame}这一页做什么","variant":"body"}},` +
    `{"type":"text","props":{"content":"补充说明","variant":"caption"}},` +
    `{"type":"list","props":{"items":["一","二","三"]}},` +
    `{"type":"divider"},` +
    `{"type":"input","props":{"placeholder":"输入"}},` +
    `{"type":"button","props":{"label":"继续","variant":"primary"}},` +
    `{"type":"bottomnav","props":{"items":["首页","消息","我的"],"active":0}}` +
    `]},"notes":"${frame}的说明"}`;
  const outlineJson = (frames: readonly string[]) =>
    `{"reply":"拆成${frames.length}页。","outline":[${frames.map((f) => `{"frame":"${f}","intent":"${f}做什么"}`).join(",")}]}`;

  it("V36 骨架轮只要标签与意图，prompt 里不含组件树说明；返回的页进 frames，还没有树", async () => {
    const frames = ["登录", "首页", "设置"];
    let n = 0;
    const { r, model } = replier(async () => ({ text: (n += 1) === 1 ? outlineJson(frames) : screenJson(frames[n - 2]!) }));
    const out = await r.reply(EMPTY);
    const outlineCall = model.complete.mock.calls[0]?.[0];
    expect(outlineCall?.system).toBe(DESIGN_OUTLINE_SYSTEM_PROMPT);
    // 反证锚点：骨架轮的系统提示里**没有**组件树 schema 说明，否则模型照旧整页吐
    expect(outlineCall?.system).not.toContain("组件树原语");
    expect(out.pagedScreens?.map((s) => s.frame)).toEqual(frames);
  });

  it("V37 8 页 ⇒ 恰好 1 + 8 次调用；每页轮的 prompt 不含其余页的完整树", async () => {
    const frames = Array.from({ length: 8 }, (_, i) => `第${i + 1}页`);
    let n = 0;
    const { r, model } = replier(async () => ({ text: (n += 1) === 1 ? outlineJson(frames) : screenJson(frames[n - 2]!) }));
    const out = await r.reply(EMPTY);
    expect(model.complete).toHaveBeenCalledTimes(1 + 8);
    expect(out.pagedScreens).toHaveLength(8);
    // 单次输出量与页数解耦的另一半：**输入**也不能随已生成页数线性涨。
    // 最后一页的 prompt 里只有结构摘要，没有前 7 页的完整树。
    const last = model.complete.mock.calls[8]?.[0]?.user ?? "";
    expect(last).toContain("已经画好的页");
    expect(last).not.toContain("的内容\"}}");   // 完整树里才有的 props 字面量
    expect(last).toContain("现在只画第 7 页");
  });

  it("V38 第 3 页失败 ⇒ 只损失第 3 页，其余照常写回，回复里说清是哪一页", async () => {
    // 迭代 12 补：截断会给这一页**第二次机会**（降级重试），所以要让 C 两次都失败，
    // 这条才真的在测「一页彻底失败」而不是「第一次没成」。
    const frames = ["A", "B", "C", "D"];
    let done = 0;
    const { r } = replier(async (input) => {
      if (input.system === DESIGN_OUTLINE_SYSTEM_PROMPT) return { text: outlineJson(frames) };
      const which = input.user.match(/现在只画第 (\d+) 页/)?.[1];
      if (which === "2") return { text: screenJson("C"), truncated: true } as never;  // 第 3 页（序号 2）两次都截断
      done += 1;
      return { text: screenJson(frames[Number(which)]!) };
    });
    const out = await r.reply(EMPTY);
    // issue #3340：失败的页**留在原位**（没有 root），不再从页序里消失。
    expect(out.pagedScreens?.map((s) => s.frame)).toEqual(["A", "B", "C", "D"]);
    expect(out.pagedScreens?.map((s) => s.root !== undefined)).toEqual([true, true, false, true]);
    expect(done).toBe(3);
    expect(out.source).toBe("model");           // 不是整段退路——已经画好的三页是真的
    expect(out.text).toContain("C");
    expect(out.text).toContain("没画出来");
  });

  it("V38 某页 JSON 坏掉 / 不过契约 ⇒ 同样只丢那一页", async () => {
    const frames = ["A", "B", "C"];
    let n = 0;
    const { r } = replier(async () => {
      n += 1;
      if (n === 1) return { text: outlineJson(frames) };
      if (n === 3) return { text: '{"frame":"B","root":{"type":"iframe"}}' };   // 类型不在闭集
      return { text: screenJson(frames[n - 2]!) };
    });
    const out = await r.reply(EMPTY);
    expect(out.pagedScreens?.map((s) => s.frame)).toEqual(["A", "B", "C"]);
    expect(out.pagedScreens?.map((s) => s.root !== undefined)).toEqual([true, false, true]);
  });

  it("V40 骨架轮被截断 ⇒ MODEL_OUTPUT_TRUNCATED；全部页都失败 ⇒ 也是退路，不写半套", async () => {
    const cut = replier(async () => ({ text: '{"reply":"…', truncated: true } as never));
    expect(await cut.r.reply(EMPTY)).toMatchObject({ source: "fallback", fallbackReason: "MODEL_OUTPUT_TRUNCATED" });

    let n = 0;
    const allFail = replier(async () => {
      n += 1;
      return n === 1 ? { text: outlineJson(["A", "B"]) } : ({ text: "x", truncated: true } as never);
    });
    const out = await allFail.r.reply(EMPTY);
    expect(out).toMatchObject({ source: "fallback", fallbackReason: "MODEL_OUTPUT_TRUNCATED" });
    expect(out.writeback).toEqual({});
  });

  it("V40 非空项目上的截断也判 MODEL_OUTPUT_TRUNCATED，而不是靠 JSON 解析失败反推", async () => {
    // 输出**可以**解析（没坏），但 provider 说它被长度切断了——旧实现会当成一次成功的写回。
    const { r } = replier(async () => ({ text: '{"reply":"好了。"}', truncated: true } as never));
    expect(await r.reply(CTX)).toMatchObject({ source: "fallback", fallbackReason: "MODEL_OUTPUT_TRUNCATED" });
  });
});

/**
 * 2026-09-08 人类实测：提交需求后**一页都没生成**，屏上只有「没说完就被长度截断了」。
 * 分页解耦的是"输出量 vs 页数"，没解决"**单页**就超预算"——桌面站一页的组件树，
 * 在 provider 默认输出上限（dashscope/qwen 常见 2048）下照样装不下，于是每页都截断、
 * 颗粒无收。修法：某页截断就换一个**要求更简单**的请求再来一次。
 */
describe("迭代 12 补：单页截断后降级重试", () => {
  const EMPTY: DesignChatContext = { ...CTX, prototype: [], frames: [] };
  const screenJson = (frame: string) =>
    `{"frame":"${frame}","root":{"type":"stack","children":[${REAL_PAGE_CHILDREN}]}}`;
  const outlineJson = (frames: readonly string[]) =>
    `{"reply":"拆成${frames.length}页。","outline":[${frames.map((f) => `{"frame":"${f}","intent":"i"}`).join(",")}]}`;

  it("某页截断 ⇒ 同一页再问一次并要求画简单点；这一次成了就照常落库", async () => {
    let n = 0;
    const { r, model } = replier(async () => {
      n += 1;
      if (n === 1) return { text: outlineJson(["首页"]) };
      if (n === 2) return { text: '{"frame":"首页","root":{"type":"stack","chil', truncated: true } as never;
      return { text: screenJson("首页") };
    });
    const out = await r.reply(EMPTY);
    expect(model.complete).toHaveBeenCalledTimes(3);            // 骨架 + 首轮 + 降级重试
    const retry = model.complete.mock.calls[2]?.[0]?.user ?? "";
    // ⭐ 反证锚点：重试若不追加"画简单点"，就是原样重试一个必然再次超预算的请求。
    expect(retry).toContain("更简单");
    expect(retry).toContain("完整输出");
    expect(out.pagedScreens?.map((s) => s.frame)).toEqual(["首页"]);
    expect(out.source).toBe("model");
  });

  it("降级重试仍然截断 ⇒ 才算这一页失败，不无限重试", async () => {
    let n = 0;
    const { r, model } = replier(async () => {
      n += 1;
      return n === 1 ? { text: outlineJson(["首页", "详情"]) } : ({ text: "{", truncated: true } as never);
    });
    const out = await r.reply(EMPTY);
    // 两页 × (首轮 + 一次降级) + 骨架 = 5；不能更多
    expect(model.complete).toHaveBeenCalledTimes(5);
    expect(out).toMatchObject({ source: "fallback", fallbackReason: "MODEL_OUTPUT_TRUNCATED" });
  });

  it("provider 没报截断但 JSON 不完整 ⇒ 同样走降级重试（不是直接判这一页死）", async () => {
    let n = 0;
    const { r, model } = replier(async () => {
      n += 1;
      if (n === 1) return { text: outlineJson(["首页"]) };
      if (n === 2) return { text: '{"frame":"首页","root":{"type":"sta' };   // 没有 truncated 标记
      return { text: screenJson("首页") };
    });
    const out = await r.reply(EMPTY);
    expect(model.complete).toHaveBeenCalledTimes(3);
    expect(out.pagedScreens).toHaveLength(1);
  });
});

/**
 * issue #3125 —— 人类实测「现在出来的页面很不专业」。根因：`.agents/skills/frontend-design/SKILL.md`
 * 就在仓库里，而这条链路完全没引用它；原来的八条设计原则全是布局结构，一个字没讲视觉。
 * 这组用例钉住"视觉判据真的进了模型的约束"，以及"它只在一处声明"。
 */
describe("V67 视觉判据进设计原则，且与 frontend-design skill 不是两份", () => {
  const P = DESIGN_PRINCIPLES;

  it("三组视觉约束都在：视觉重点唯一 / 字号级差 / 间距成体系", () => {
    expect(P).toContain("一个视觉重点");
    expect(P).toContain("title 一页最多一次");
    expect(P).toContain("最多用两档");
    // ⭐ 反证锚点：删掉其中任一条，这里就红——它们各自是 skill 里一条判据的翻译。
  });

  it("「结构装置编码信息而非装饰」落成了可核对的三句", () => {
    for (const s of ["divider 只在真的分隔", "card 只在真的成组", "数字编号只在内容真的是有序步骤"]) {
      expect(P).toContain(s);
    }
  });

  it("skill 里点名的「一眼看出是生成的」套路逐条禁掉", () => {
    for (const s of ["全大写", "中点", "破折号标签", "→", "一个词换成另一种 variant"]) {
      expect(P).toContain(s);
    }
  });

  it("文案判据：按钮说清后果、同名、错误不含糊、空态是邀请", () => {
    expect(P).toContain("保存修改");
    expect(P).toContain("全流程同名");
    expect(P).toContain("空态是一句邀请");
    expect(P).not.toContain("暂无数据…");   // 反例本身要出现在"不要这样"的位置
  });

  it("系统提示词真的带上了它（不是只导出一个没人用的常量）", () => {
    expect(DESIGN_CHAT_SYSTEM_PROMPT).toContain(P);
    expect(DESIGN_ONE_SCREEN_SYSTEM_PROMPT).toContain(P);
  });

  /**
   * V67 的**另一半**：「只在一处」。
   *
   * 上面几条只证明了判据**在** `DESIGN_PRINCIPLES` 里，没有任何东西阻止有人哪天顺手
   * 把同一批判据也抄回 SKILL.md —— 那正是本仓五次漂移的形态，而 SKILL.md 里只有一句
   * 「不要在本文再写一份」的**注释**。仓库自己的话：没有脚本的规范条目视为未落地。
   *
   * 判法：那批判据里**措辞独特**的短语（不是"字号""间距"这种任何设计文档都会出现的通用词）
   * 一个都不许出现在 SKILL.md 里；同时那条指回 `DESIGN_PRINCIPLES` 的指针必须在。
   */
  const SKILL_PATH = join(import.meta.dirname, "..", "..", "..", "..", ".agents", "skills", "frontend-design", "SKILL.md");

  it("SKILL.md 只留一条指针，不重复声明任何一条视觉判据", () => {
    const skill = readFileSync(SKILL_PATH, "utf8");
    // 非空转：文件真的读到了，且指针真的在。
    expect(skill.length).toBeGreaterThan(500);
    expect(skill).toContain("DESIGN_PRINCIPLES");
    expect(skill).toContain("不要");

    // 这些短语是 `DESIGN_PRINCIPLES` 里那批判据的**原话**——出现在 SKILL.md 里就是第二份。
    const OWNED_BY_PRINCIPLES = [
      "title 一页最多一次",
      "divider 只在真的分隔",
      "card 只在真的成组",
      "数字编号只在内容真的是有序步骤",
      "全流程同名",
      "空态是一句邀请",
      "破折号标签",
    ];
    const leaked = OWNED_BY_PRINCIPLES.filter((phrase) => skill.includes(phrase));
    // ⭐ 反证：把其中任一句抄进 SKILL.md ⇒ 这条红。这就是那条「只在一处」的门。
    expect(leaked, `这些判据在 SKILL.md 里出现了第二份：\n${leaked.join("\n")}`).toEqual([]);

    // 而它们确实都在 DESIGN_PRINCIPLES 里——否则上面那条会因为"两边都没有"而假绿。
    for (const phrase of OWNED_BY_PRINCIPLES) expect(P, `DESIGN_PRINCIPLES 里没有「${phrase}」`).toContain(phrase);
  });
});

/**
 * 迭代 13（delta `design-chat-inputs` §1）—— V52 / V53 / V54。
 * 参考图随**每一轮**发；模型看不了图时**不发图且在回复里说出来**。
 */
/**
 * issue #3340 后一半：「界面质量很差，感觉没有迭代就提交了，流程没有完整执行」。
 *
 * 在这之前，这条链路上**唯一**的重试是「截断了 ⇒ 要求画简单一点」，方向是更简陋。
 * 现在每页生成完先过一遍结构自审，不合格就带着**具体缺什么**重问一次。
 */
describe("#3340 运行期结构自审：不合格的页带着反馈重问一次", () => {
  const EMPTY2: DesignChatContext = { ...CTX, prototype: [], frames: [] };
  const outline1 = `{"reply":"一页。","outline":[{"frame":"首页","intent":"i"}]}`;
  const shell = `{"frame":"首页","root":{"type":"stack","children":[{"type":"text","props":{"content":"禅学入门"}}]}}`;
  const good = `{"frame":"首页","root":{"type":"stack","children":[${REAL_PAGE_CHILDREN}]}}`;

  it("空壳页 ⇒ 重问一次，且反馈里逐条说缺什么（不是「再试一次」）", async () => {
    let n = 0;
    const { r, model } = replier(async () => ({ text: (n += 1) === 1 ? outline1 : n === 2 ? shell : good }));
    const out = await r.reply(EMPTY2);
    expect(model.complete).toHaveBeenCalledTimes(3);            // 骨架 + 首轮 + 质量重问
    const retryPrompt = model.complete.mock.calls[2]![0] as { user: string };
    expect(retryPrompt.user).toContain("画得不够好");
    expect(retryPrompt.user).toContain("海报");                  // 没有可操作控件那条
    expect(retryPrompt.user).toContain("字号");                  // 只有一档字号那条
    // 重问更好 ⇒ 用重问那版
    expect(JSON.stringify(out.pagedScreens?.[0])).toContain("bottomnav");
  });

  /**
   * ⚠ 这条用例第一版是**失效的**：桩页得 75 分、压根没触发重问，于是「无条件用重问那版」
   * 这个变异也照样绿。改成真正踩到那条分支的分数——首轮 69（不合格、会重问），
   * 重问那版 41（更差）。反证：把「更好才换」改成无条件替换 ⇒ 本条红。
   */
  it("重问结果更差 ⇒ 保留原来那版，不许越修越坏", async () => {
    let n = 0;
    // 5 个节点、一档字号、有按钮 ⇒ 69 分（不合格，触发重问）
    const first = `{"frame":"首页","root":{"type":"stack","children":[{"type":"text","props":{"content":"甲"}},{"type":"text","props":{"content":"乙"}},{"type":"text","props":{"content":"丙"}},{"type":"button","props":{"label":"走"}}]}}`;
    // 2 个节点、没有控件 ⇒ 41 分（更差）
    const worse = `{"frame":"首页","root":{"type":"stack","children":[{"type":"text","props":{"content":"更差"}}]}}`;
    const { r } = replier(async () => ({ text: (n += 1) === 1 ? outline1 : n === 2 ? first : worse }));
    const out = await r.reply(EMPTY2);
    const got = JSON.stringify(out.pagedScreens?.[0]);
    expect(got).toContain("甲");
    expect(got).not.toContain("更差");
  });

  it("合格的页 ⇒ 不重问（不为了 1 分多花一次调用）", async () => {
    let n = 0;
    const { r, model } = replier(async () => ({ text: (n += 1) === 1 ? outline1 : good }));
    await r.reply(EMPTY2);
    expect(model.complete).toHaveBeenCalledTimes(2);
  });
});

describe("迭代 13：参考图", () => {
  const IMG = { filename: "ref.png", mime: "image/png" as const, bytes: new Uint8Array([1, 2, 3]) };
  const WITH_IMG: DesignChatContext = { ...CTX, refImages: [IMG] };
  const EMPTY_WITH_IMG: DesignChatContext = { ...CTX, prototype: [], frames: [], refImages: [IMG] };

  /** 带 supportsVision 的 replier（既有 `replier` 的模型替身没有这个方法 ⇒ 视作看不了图）。 */
  const seeing = (complete: (i: { system: string; user: string }) => Promise<{ text: string }>) => {
    const log = vi.fn();
    const model = { complete: vi.fn(complete), supportsVision: () => true };
    return { r: new ModelDesignChatReplier({ model: model as never, chatModel: { provider: "p", modelId: "m" }, log }), model };
  };

  it("V52 图片类型闭集与端口**集合相等**，不是包含", () => {
    // 端口那边只是再导出契约的那一份（迭代 13 起）。两处各写一份的话，端口加一种格式
    // 设计这边会静默不支持——所以断言集合相等，而不是「设计的 ⊆ 端口的」。
    expect([...MODEL_CALL_IMAGE_MIMES].sort()).toEqual([...C.IMAGE_MIMES].sort());
    expect(C.isImageMime("image/png")).toBe(true);
    expect(C.isImageMime("image/gif")).toBe(false);
  });

  it("V53 分页生成时**每一轮**都带图（骨架轮 + 每页轮），不是只发第一轮", async () => {
    const frames = ["首页", "详情", "设置"];
    let n = 0;
    const { r, model } = seeing(async () => {
      n += 1;
      return n === 1
        ? { text: `{"reply":"好","outline":[${frames.map((f) => `{"frame":"${f}","intent":"i"}`).join(",")}]}` }
        : { text: `{"frame":"${frames[n - 2]}","root":{"type":"stack","children":[${REAL_PAGE_CHILDREN}]}}` };
    });
    await r.reply(EMPTY_WITH_IMG);
    expect(model.complete).toHaveBeenCalledTimes(1 + 3);
    // ⭐ 反证锚点：只在骨架轮带图 ⇒ 后三条红（"照着这张画"在第 3 页就失效了）。
    for (const call of model.complete.mock.calls) {
      expect((call[0] as { images?: unknown[] }).images).toHaveLength(1);
    }
  });

  it("V54 模型看不了图 ⇒ 请求体不含 images，且回复里**说出来**", async () => {
    // 既有 `replier` 的替身没有 supportsVision ⇒ 看不了图
    const { r, model } = replier(async () => ({ text: '{"reply":"画好了。"}' }));
    const out = await r.reply(WITH_IMG);
    expect(model.complete.mock.calls[0]?.[0]).not.toHaveProperty("images");
    // ⭐ 这是本 delta 最重要的一条：静默丢图会让界面显示"已上传"而模型没看过。
    expect(out.text).toContain("看不了图");
    expect(out.text).toContain("画好了。");
  });

  it("V54 看得了图 ⇒ 带 images，且**不**画蛇添足地加那句提示", async () => {
    const { r, model } = seeing(async () => ({ text: '{"reply":"照着画好了。"}' }));
    const out = await r.reply(WITH_IMG);
    expect((model.complete.mock.calls[0]?.[0] as { images?: unknown[] }).images).toHaveLength(1);
    expect(out.text).not.toContain("看不了图");
  });

  it("没传图 ⇒ 不管模型能不能看图，都不加那句提示", async () => {
    const { r } = replier(async () => ({ text: '{"reply":"好的。"}' }));
    expect((await r.reply(CTX)).text).not.toContain("看不了图");
  });
});

/* ───────────────── 迭代 16（#3773 R1）：上下文膨胀与提示词一致性 ───────────────── */

describe("迭代 16：喂给模型的对话历史有上限（#3773 R1-⑦）", () => {
  it("超过上限 ⇒ 只带最近 N 轮，并如实说明省略了多少轮", async () => {
    const chat = Array.from({ length: CHAT_HISTORY_MAX_TURNS + 8 }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("ai" as const),
      text: `第 ${String(i)} 句`,
      at: "2026-09-05T00:00:00.000Z",
      ...(i % 2 === 0 ? {} : { source: "model" as const }),
    }));
    const { r, model } = replier(async () => ({ text: '{"reply":"好。"}' }));
    await r.reply({ ...CTX, chat });
    const user = model.complete.mock.calls[0]?.[0].user ?? "";
    // 最早的几句不该还在上下文里；最后一句必须在。
    expect(user).not.toContain("第 0 句");
    expect(user).toContain(`第 ${String(chat.length - 1)} 句`);
    // 不静默截断：模型要知道前面还有话，才不会把「用户没说过」当事实。
    expect(user).toContain("更早的 8 轮已省略");
  });

  it("单条超长消息被截断，不把预算一次吃光", async () => {
    const huge = "长".repeat(CHAT_TURN_MAX_CHARS + 500);
    const { r, model } = replier(async () => ({ text: '{"reply":"好。"}' }));
    await r.reply({ ...CTX, chat: [{ role: "user", text: huge, at: "2026-09-05T00:00:00.000Z" }] });
    const user = model.complete.mock.calls[0]?.[0].user ?? "";
    expect(user).toContain("（本条已截断）");
    expect(user).not.toContain(huge);
  });
});

describe("迭代 16：提示词与服务端质量门不再互相矛盾（#3773 R1-⑤⑥）", () => {
  it("两个系统提示词都写明了质量门的判据", () => {
    expect(DESIGN_CHAT_SYSTEM_PROMPT).toContain(DESIGN_QUALITY_BAR);
    expect(DESIGN_ONE_SCREEN_SYSTEM_PROMPT).toContain(DESIGN_QUALITY_BAR);
  });

  it("few-shot 里的第一页**自己过得了质量门**——模型照抄范例不该被我们自己判不及格", async () => {
    // 回归钉：原来的范例首页只有 5 个节点、零个 text，按 `scorePrototypeScreen` 是不及格的。
    const { scorePrototypeScreen, PROTOTYPE_QUALITY_THRESHOLD } =
      await import("../../src/application/design-workbench/prototype-quality");
    const { DESIGN_FEW_SHOT } = await import("../../src/application/design-workbench/design-chat-model");
    const start = DESIGN_FEW_SHOT.indexOf("{\"reply\"");
    const end = DESIGN_FEW_SHOT.indexOf("}]}}", start) + 4;
    const parsed = JSON.parse(DESIGN_FEW_SHOT.slice(start, end)) as {
      writeback: { prototype: { frame: string; root: unknown }[] };
    };
    const screens = parsed.writeback.prototype;
    expect(screens.length).toBeGreaterThanOrEqual(2);
    // 每一页都要过契约（范例里写错一个 props 键，模型就会照着写错）。
    for (const s of screens) expect(designPrototype.PrototypeScreen.safeParse(s).success).toBe(true);
    // 首页要过质量门。
    expect(scorePrototypeScreen(screens[0]!.root as never).total).toBeGreaterThanOrEqual(PROTOTYPE_QUALITY_THRESHOLD);
  });
});

describe("迭代 16：设计基调在骨架轮定一次、每页轮都带着（#3773 R1-⑩）", () => {
  it("骨架轮给了 tone ⇒ 每一页的上下文里都有它", async () => {
    const outline = '{"reply":"拆成两页。","tone":"面向一线客服、信息密度高、以待办列表为视觉重点","outline":[{"frame":"待办","intent":"看今天要做什么"},{"frame":"详情","intent":"处理一条"}]}';
    const screen = '{"frame":"x","root":{"type":"stack","children":[{"type":"text","props":{"content":"一句真实文案","variant":"title"}},{"type":"button","props":{"label":"开始处理","variant":"primary"}}]},"notes":"说明"}';
    let call = 0;
    const { r, model } = replier(async () => ({ text: call++ === 0 ? outline : screen }));
    await r.reply({ ...CTX, prototype: [], frames: [], chat: [{ role: "user", text: "做个客服待办", at: "2026-09-05T00:00:00.000Z" }] });
    const perScreen = model.complete.mock.calls.slice(1);
    expect(perScreen.length).toBeGreaterThanOrEqual(2);
    for (const [input] of perScreen) {
      expect(input.system).toBe(DESIGN_ONE_SCREEN_SYSTEM_PROMPT);
      expect(input.user).toContain("面向一线客服、信息密度高、以待办列表为视觉重点");
    }
  });

  it("骨架轮没给 tone ⇒ 不往上下文里塞空句子（照常生成）", async () => {
    const outline = '{"reply":"一页。","outline":[{"frame":"待办","intent":"看今天要做什么"}]}';
    const screen = '{"frame":"x","root":{"type":"stack","children":[{"type":"text","props":{"content":"一句真实文案","variant":"title"}},{"type":"button","props":{"label":"开始处理","variant":"primary"}}]}}';
    let call = 0;
    const { r, model } = replier(async () => ({ text: call++ === 0 ? outline : screen }));
    const out = await r.reply({ ...CTX, prototype: [], frames: [], chat: [{ role: "user", text: "做个客服待办", at: "2026-09-05T00:00:00.000Z" }] });
    expect(out.source).toBe("model");
    expect(model.complete.mock.calls[1]?.[0].user).not.toContain("设计基调");
  });
});

describe("迭代 16：分页生成的中间结果当场发出去（#3773 R2）", () => {
  const outline = '{"reply":"拆成三页。","outline":[{"frame":"待办","intent":"看今天要做什么"},{"frame":"详情","intent":"处理一条"},{"frame":"我的","intent":"看设置"}]}';
  const screen = '{"frame":"x","root":{"type":"stack","children":[{"type":"text","props":{"content":"一句真实文案","variant":"title"}},{"type":"button","props":{"label":"开始处理","variant":"primary"}}]},"notes":"说明"}';
  const fresh = { ...CTX, prototype: [], frames: [], chat: [{ role: "user" as const, text: "做个客服待办", at: "2026-09-05T00:00:00.000Z" }] };

  it("骨架一回来就发一次（全是占位页），之后每画好一页再发一次", async () => {
    const seen: string[][] = [];
    let call = 0;
    const { r } = replier(async () => ({ text: call++ === 0 ? outline : screen }));
    await r.reply({
      ...fresh,
      onProgress: async (screens) => {
        seen.push(screens.map((x) => (x.root === undefined ? `${x.frame}:空` : `${x.frame}:有`)));
      },
    });
    /*
     * 迭代 16（#3773 R9）之后是**一批一次**：1 次骨架 + 第 0 页（串行定调）
     * + 其余页按 `SCREEN_CONCURRENCY` 成批 ⇒ 三页项目共 3 次。
     * 逐页可见这件事没有变（用户看到的仍然是一批批长出来），变的是不再一页页干等。
     */
    expect(seen.length).toBe(3);
    // 第一次：三页全是占位——页标签当场就能出现在画布上，而不是等几分钟。
    expect(seen[0]).toEqual(["待办:空", "详情:空", "我的:空"]);
    // 第 0 页先单独画完（它是后面几页的风格锚）。
    expect(seen[1]).toEqual(["待办:有", "详情:空", "我的:空"]);
    // 最后一次：全部画好，且**页序按骨架还原**——并发之后完成顺序不再等于页序。
    expect(seen[2]).toEqual(["待办:有", "详情:有", "我的:有"]);
  });

  it("回调抛了 ⇒ 记一条日志，生成照常走完（它只是「早点存一下」，不是成败条件）", async () => {
    let call = 0;
    const { r, log } = replier(async () => ({ text: call++ === 0 ? outline : screen }));
    const out = await r.reply({
      ...fresh,
      onProgress: async () => { throw new Error("db down"); },
    });
    expect(out.source).toBe("model");
    expect(out.pagedScreens?.length).toBe(3);
    expect(out.pagedScreens?.every((x) => x.root !== undefined)).toBe(true);
    expect(log.mock.calls.some(([m]) => String(m).includes("progress publish failed"))).toBe(true);
  });

  it("没给回调 ⇒ 一切照旧（老调用方不受影响）", async () => {
    let call = 0;
    const { r } = replier(async () => ({ text: call++ === 0 ? outline : screen }));
    const out = await r.reply(fresh);
    expect(out.pagedScreens?.length).toBe(3);
  });
});

describe("迭代 16：裁剪不许裁掉系统留痕（#3773 R3）", () => {
  it("很早的一条「从对话导入」留痕，即使被 20 轮窗口挤出去也仍然在上下文里", async () => {
    const trace = { role: "ai" as const, text: "从线程《导出慢》导入了 12 条消息作为背景。", at: "2026-09-05T00:00:00.000Z", source: "system" as const };
    const noise = Array.from({ length: CHAT_HISTORY_MAX_TURNS + 5 }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("ai" as const),
      text: `闲聊 ${String(i)}`,
      at: "2026-09-05T00:00:00.000Z",
      ...(i % 2 === 0 ? {} : { source: "model" as const }),
    }));
    const { r, model } = replier(async () => ({ text: '{"reply":"好。"}' }));
    await r.reply({ ...CTX, chat: [trace, ...noise] });
    const user = model.complete.mock.calls[0]?.[0].user ?? "";
    expect(user).toContain("从线程《导出慢》导入了 12 条消息");
    expect(user).not.toContain("闲聊 0");
    // 钉住顺序：留痕仍排在被保留的那些闲聊之前，不是被挪到末尾。
    expect(user.indexOf("从线程《导出慢》")).toBeLessThan(user.indexOf(`闲聊 ${String(noise.length - 1)}`));
  });
});

/* ───────────────── 迭代 16（#3773 R5）：迭代产出也要被管住 ───────────────── */

const THIN_PAGE = { type: "stack", children: [{ type: "text", props: { content: "空空如也" } }] };
const SOLID_PAGE = {
  type: "stack",
  children: [
    { type: "text", props: { content: "我的订单", variant: "title" } },
    { type: "text", props: { content: "近 30 天共 8 单", variant: "caption", muted: true } },
    { type: "text", props: { content: "进行中", variant: "label" } },
    { type: "list", props: { items: ["楼下的面馆", "书店", "水果摊"], detail: ["牛肉面 × 1", "三本书", "两斤橙子"], trailing: ["¥28", "¥136", "¥19"], leading: "icon", icons: ["cart"] } },
    { type: "text", props: { content: "已完成", variant: "label" } },
    { type: "list", props: { items: ["咖啡店", "便利店"], trailing: ["¥32", "¥15"] } },
    { type: "input", props: { placeholder: "搜索订单" } },
    { type: "button", props: { label: "再来一单", icon: "refresh", variant: "primary", full: true } },
  ],
};

describe("整页写回也过质量门（#3773 R5）", () => {
  it("写回的页低于线 ⇒ 带着具体反馈重问那一页；更好就换", async () => {
    // ⭐ 反证锚点：把 `liftScreenQuality` 摘掉 ⇒ 这条红。质量门此前**只跑在首次分页生成上**，
    // 用户每一轮迭代产出的页一次都没被审过——而迭代恰恰是这个工具的主用途。
    const first = `{"reply":"重画了首页。","writeback":{"prototype":[{"frame":"订单","root":${JSON.stringify(THIN_PAGE)}}]}}`;
    const retry = `{"frame":"订单","root":${JSON.stringify(SOLID_PAGE)},"notes":"列出进行中与已完成的订单。"}`;
    let n = 0;
    const { r, model } = replier(async () => ({ text: (n += 1) === 1 ? first : retry }));
    const out = await r.reply(CTX);
    expect(model.complete).toHaveBeenCalledTimes(2);
    // 第二次是**单页**重问，带着具体缺什么，不是一句"再试一次"。
    const second = model.complete.mock.calls[1]?.[0];
    expect(second?.system).toBe(DESIGN_ONE_SCREEN_SYSTEM_PROMPT);
    expect(second?.user).toContain("刚才这一页画得不够好");
    expect(second?.user).toContain("元素");
    expect(out.writeback.prototype?.[0]?.root).toEqual(SOLID_PAGE);
    expect(out.writeback.prototype?.[0]?.notes).toBe("列出进行中与已完成的订单。");
  });

  it("重问反而更差 ⇒ 保留原来那版（不能越修越坏）", async () => {
    const first = `{"reply":"重画了。","writeback":{"prototype":[{"frame":"订单","root":${JSON.stringify(THIN_PAGE)}}]}}`;
    const worse = '{"frame":"订单","root":{"type":"stack","children":[{"type":"divider"}]}}';
    let n = 0;
    const { r } = replier(async () => ({ text: (n += 1) === 1 ? first : worse }));
    const out = await r.reply(CTX);
    expect(out.writeback.prototype?.[0]?.root).toEqual(THIN_PAGE);
  });

  it("写回的页本来就过线 ⇒ 一次都不重问（不为了 1 分多花一次调用）", async () => {
    const first = `{"reply":"重画了。","writeback":{"prototype":[{"frame":"订单","root":${JSON.stringify(SOLID_PAGE)}}]}}`;
    const { r, model } = replier(async () => ({ text: first }));
    await r.reply(CTX);
    expect(model.complete).toHaveBeenCalledTimes(1);
  });
});

describe("整页重画被截断 ⇒ 落到分页生成，而不是直接判失败（#3773 R5）", () => {
  it("首轮 truncated ⇒ 改走「一次骨架 + 每页一次」，用户拿到的是页，不是一句「没说完」", async () => {
    /*
     * ⭐ 反证锚点：改回 `return fallbackWith("MODEL_OUTPUT_TRUNCATED")` ⇒ 这条红。
     * 「整体重画一遍」要一次吐出所有页的完整树，正是首次生成早就拆掉的那件事，
     * 只是换了个入口；退回一句"AI 这次没说完"会让用户一遍遍重试一个必然再次截断的请求。
     */
    const outline = '{"reply":"重画成两页。","outline":[{"frame":"订单","intent":"看订单"},{"frame":"详情","intent":"看一单"}]}';
    const screen = `{"frame":"x","root":${JSON.stringify(SOLID_PAGE)},"notes":"说明"}`;
    let n = 0;
    const { r, model } = replier(async () => {
      n += 1;
      if (n === 1) return { text: "{\"reply\":\"重画中", truncated: true } as never;
      return { text: n === 2 ? outline : screen };
    });
    const out = await r.reply(CTX);
    expect(out.source).toBe("model");
    expect(out.fallbackReason).toBeUndefined();
    expect(out.pagedScreens?.map((x) => x.frame)).toEqual(["订单", "详情"]);
    expect(out.pagedScreens?.every((x) => x.root !== undefined)).toBe(true);
    // 1 次首轮 + 1 次骨架 + 2 次每页
    expect(model.complete).toHaveBeenCalledTimes(4);
  });

  it("落过去的分页生成也失败 ⇒ 仍然如实报「被截断」，不假装成别的原因", async () => {
    let n = 0;
    const { r } = replier(async () => {
      n += 1;
      if (n === 1) return { text: "{半截", truncated: true } as never;
      throw new ModelCallError("MODEL_CALL_FAILED", "boom");
    });
    const out = await r.reply(CTX);
    expect(out.source).toBe("fallback");
    expect(out.fallbackReason).toBe("MODEL_OUTPUT_TRUNCATED");
  });
});

describe("迭代 16：每页轮成批并发（#3773 R9）", () => {
  const screen = '{"frame":"x","root":{"type":"stack","children":[{"type":"text","props":{"content":"一句真实文案","variant":"title"}},{"type":"button","props":{"label":"开始处理","variant":"primary"}}]},"notes":"说明"}';

  it("第 0 页串行定调，其余页按并发度成批——同一批的调用真的是同时在跑", async () => {
    const outline = '{"reply":"五页。","outline":[{"frame":"A","intent":"a"},{"frame":"B","intent":"b"},{"frame":"C","intent":"c"},{"frame":"D","intent":"d"},{"frame":"E","intent":"e"}]}';
    let inFlight = 0;
    let peak = 0;
    let call = 0;
    const { r } = replier(async () => {
      const n = (call += 1);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((res) => setTimeout(res, 1));
      inFlight -= 1;
      return { text: n === 1 ? outline : screen };
    });
    const out = await r.reply({ ...CTX, prototype: [], frames: [], chat: [{ role: "user", text: "画", at: "2026-09-05T00:00:00.000Z" }] });
    // ⭐ 反证锚点：改回串行 ⇒ peak 恒为 1，这条红。5 页 × 每页几十秒 = 用户干等两三分钟，
    // 而这几次调用之间没有真正的依赖。
    expect(peak).toBe(SCREEN_CONCURRENCY);
    // 并发度不许被悄悄放大：429 在这条链路上的表现是「某几页没画出来」，比慢更糟。
    expect(peak).toBeLessThanOrEqual(SCREEN_CONCURRENCY);
    expect(out.pagedScreens?.map((x) => x.frame)).toEqual(["A", "B", "C", "D", "E"]);
    expect(out.pagedScreens?.every((x) => x.root !== undefined)).toBe(true);
  });

  it("第 0 页**不**与别人并发——它是后面每一页的风格锚", async () => {
    const outline = '{"reply":"三页。","outline":[{"frame":"A","intent":"a"},{"frame":"B","intent":"b"},{"frame":"C","intent":"c"}]}';
    const order: string[] = [];
    let call = 0;
    const { r, model } = replier(async () => {
      const n = (call += 1);
      if (n > 1) order.push("start");
      await new Promise((res) => setTimeout(res, 1));
      if (n > 1) order.push("end");
      return { text: n === 1 ? outline : screen };
    });
    await r.reply({ ...CTX, prototype: [], frames: [], chat: [{ role: "user", text: "画", at: "2026-09-05T00:00:00.000Z" }] });
    // 第一页：start,end 成对；之后 B、C 同批 ⇒ start,start,end,end。
    expect(order.slice(0, 2)).toEqual(["start", "end"]);
    expect(order.slice(2)).toEqual(["start", "start", "end", "end"]);
    // 后面几页的上下文里带着第 0 页的结构轮廓。
    const laterUser = model.complete.mock.calls[2]?.[0].user ?? "";
    expect(laterUser).toContain("已经画好的页");
  });

  it("并发批里某一页失败 ⇒ 只损失那一页，其余照常，页序仍按骨架还原", async () => {
    const outline = '{"reply":"三页。","outline":[{"frame":"A","intent":"a"},{"frame":"B","intent":"b"},{"frame":"C","intent":"c"}]}';
    let call = 0;
    const { r } = replier(async () => {
      const n = (call += 1);
      if (n === 1) return { text: outline };
      if (n === 3) throw new ModelCallError("MODEL_CALL_FAILED", "boom");
      return { text: screen };
    });
    const out = await r.reply({ ...CTX, prototype: [], frames: [], chat: [{ role: "user", text: "画", at: "2026-09-05T00:00:00.000Z" }] });
    expect(out.pagedScreens?.map((x) => x.frame)).toEqual(["A", "B", "C"]);
    expect(out.pagedScreens?.filter((x) => x.root === undefined)).toHaveLength(1);
    expect(out.text).toContain("没画出来");
  });
});

/* ───────────────── 迭代 17：骨架轮挑强调色（#3773 后续） ───────────────── */

describe("迭代 17：强调色在骨架轮定一次，过契约闭集", () => {
  const screen = '{"frame":"x","root":{"type":"stack","children":[{"type":"text","props":{"content":"一句真实文案","variant":"title"}},{"type":"button","props":{"label":"开始处理","variant":"primary"}}]},"notes":"说明"}';
  const fresh = { ...CTX, prototype: [], frames: [], chat: [{ role: "user" as const, text: "做个记账 App", at: "2026-09-22T00:00:00.000Z" }] };
  const run = async (outline: string) => {
    let call = 0;
    const { r } = replier(async () => ({ text: call++ === 0 ? outline : screen }));
    return r.reply(fresh);
  };

  it("模型给了合法档位 ⇒ 带出去，调用方据它落库", async () => {
    // ⭐ 反证锚点：骨架轮不问强调色 ⇒ 这条红。不问的话每个项目都是同一个中性灰，
    // 不管做的是儿童记账还是医院排班——所有产出看起来像同一个模板的不同填空。
    const out = await run('{"reply":"两页。","accent":"blue","outline":[{"frame":"A","intent":"a"},{"frame":"B","intent":"b"}]}');
    expect(out.accent).toBe("blue");
  });

  it("给了个闭集外的名字 ⇒ 不带（**不猜、不近似匹配**）", async () => {
    // 「深蓝」和 blue 差一个字就该判不合法：近似匹配会让"模型给了个什么"变得不可复核。
    const out = await run('{"reply":"两页。","accent":"深蓝","outline":[{"frame":"A","intent":"a"},{"frame":"B","intent":"b"}]}');
    expect(out.accent).toBeUndefined();
  });

  it("压根没给 ⇒ 不带，项目保持原样（不是「改回 neutral」）", async () => {
    const out = await run('{"reply":"两页。","outline":[{"frame":"A","intent":"a"},{"frame":"B","intent":"b"}]}');
    expect(out.accent).toBeUndefined();
    expect(out.pagedScreens?.length).toBe(2);
  });

  it("骨架轮的提示词把可选档位逐个列出来了（不列，模型只会编一个渲染不了的名字）", () => {
    for (const a of C.PrototypeAccent.options) expect(DESIGN_OUTLINE_SYSTEM_PROMPT).toContain(a);
  });
});

describe("迭代 20：页数上限由服务端**截断执行**，不是给模型的提示", () => {
  const screen = '{"frame":"x","root":{"type":"stack","children":[{"type":"text","props":{"content":"一句真实文案","variant":"title"}},{"type":"button","props":{"label":"开始处理","variant":"primary"}}]},"notes":"说明"}';
  const outline5 = '{"reply":"五页。","outline":[{"frame":"A","intent":"a"},{"frame":"B","intent":"b"},{"frame":"C","intent":"c"},{"frame":"D","intent":"d"},{"frame":"E","intent":"e"}]}';
  const fresh = { ...CTX, prototype: [], frames: [], chat: [{ role: "user" as const, text: "画", at: "2026-09-22T00:00:00.000Z" }] };

  it("模型规划了 5 页、上限给 3 ⇒ 只画前 3 页（先给最核心的，所以截前面）", async () => {
    /*
     * ⭐ 反证锚点：把上限当成提示塞进提示词、不做截断 ⇒ 这条红。
     * 超时退路一直写着「试试少要几页」，而用户此前没有任何控制页数的手段——
     * 说「只画 3 页」只是一句模型可以不听的话。
     */
    let call = 0;
    const { r, model } = replier(async () => ({ text: call++ === 0 ? outline5 : screen }));
    const out = await r.reply({ ...fresh, maxScreens: 3 });
    expect(out.pagedScreens?.map((x) => x.frame)).toEqual(["A", "B", "C"]);
    // 1 次骨架 + 3 次每页：被砍掉的两页**一次模型调用都没花**。
    expect(model.complete).toHaveBeenCalledTimes(4);
  });

  it("上限比规划的页数大 ⇒ 不影响（不会凭空补页）", async () => {
    let call = 0;
    const { r } = replier(async () => ({ text: call++ === 0 ? outline5 : screen }));
    const out = await r.reply({ ...fresh, maxScreens: 20 });
    expect(out.pagedScreens?.length).toBe(5);
  });

  it("不给上限 ⇒ 行为与这个字段出现之前逐字相同", async () => {
    let call = 0;
    const { r } = replier(async () => ({ text: call++ === 0 ? outline5 : screen }));
    const out = await r.reply(fresh);
    expect(out.pagedScreens?.length).toBe(5);
  });
});

/* ───────────────── 对标 R1（#3933）：骨架轮定品牌色与字体 ───────────────── */

describe("对标 R1：品牌色与字体在骨架轮定一次，过契约", () => {
  const screen = '{"frame":"x","root":{"type":"stack","children":[{"type":"text","props":{"content":"一句真实文案","variant":"title"}},{"type":"button","props":{"label":"开始处理","variant":"primary"}}]},"notes":"说明"}';
  const fresh = { ...CTX, prototype: [], frames: [], chat: [{ role: "user" as const, text: "品牌色 #FF5A1F，衬线体", at: "2026-09-23T00:00:00.000Z" }] };
  const run = async (outline: string) => {
    let call = 0;
    const { r } = replier(async () => ({ text: call++ === 0 ? outline : screen }));
    return r.reply(fresh);
  };

  it("用户给了色值 ⇒ 原样带出去（统一大写，免得大小写不同被当成「变了」）；字体档位一起带", async () => {
    // ⭐ 反证锚点：骨架轮不读 brand/font ⇒ 这条红——用户说了「我们的橙是 #FF5A1F」，产出还是某一档近似色。
    const out = await run('{"reply":"两页。","brand":"#ff5a1f","font":"serif","outline":[{"frame":"A","intent":"a"},{"frame":"B","intent":"b"}]}');
    expect(out.tokens).toEqual({ brand: "#FF5A1F", font: "serif" });
  });

  it("色值不合法、字体不在档位里 ⇒ 都不带（不猜「橙色」是哪个色）", async () => {
    const out = await run('{"reply":"两页。","brand":"橙色","font":"comic","outline":[{"frame":"A","intent":"a"},{"frame":"B","intent":"b"}]}');
    expect(out.tokens).toBeUndefined();
  });

  it("提示词把字体档位逐个列出来，并说清楚没给色值就不要编", () => {
    for (const f of C.PrototypeFont.options) expect(DESIGN_OUTLINE_SYSTEM_PROMPT).toContain(f);
    expect(DESIGN_OUTLINE_SYSTEM_PROMPT).toMatch(/没给就不要输出这个字段/);
  });
});
