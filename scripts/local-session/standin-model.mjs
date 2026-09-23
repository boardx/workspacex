/**
 * 本地会话实测用的**替身模型**：OpenAI 兼容的 `/v1/chat/completions`，给设计对话回一套固定的两页原型。
 *
 * ## 为什么需要它
 *
 * 本地版（`packages/local-runtime`）的模型走本机 Ollama（`127.0.0.1:11434/v1`）。没装 Ollama 的机器
 * ——比如远程执行容器——设计对话只会走到「这次没有生成画布」的退路，于是**画出原型之后**的一切
 * （属性面板、导出、分享）都没法在真栈上点到。仓里已有的 `apps/api/scripts/loopback-model-provider.ts`
 * 只回显，不认识设计对话的协议。
 *
 * 它**不是**模型质量的证据：回的是写死的原型。它证明的是「模型之后的那条链路」在真栈上走得通。
 * 真模型那一侧另有 `real-model-e2e` 的 lane。
 *
 * ## 认得的三种调用（与 `apps/api/src/application/design-workbench/design-chat-model.ts` 对齐）
 *
 *   · 骨架轮：系统提示含「只做两件事」且要 `"outline"` ⇒ 回页划分
 *   · 单页轮：正文含「现在只画第 N 页」 ⇒ 回第 N 页的组件树
 *   · 整页写回：含 `writeback` 与 `prototype` ⇒ 一次回全部页
 *   · 其余 ⇒ 「好的。」（让产品走它自己的退路，不假装懂）
 *
 * 每次调用追加一行到 `calls.log`（调用方给出目录），报告据此写「模型被问了什么」。
 */
import { createServer } from "node:http";
import { appendFileSync } from "node:fs";
import { join } from "node:path";

/** 两页：首页主按钮跳下单，下单提交回首页。两页都过契约 schema，且 `scorePrototypeScreen` 打 80 分（门槛 70）。 */
export const SCREENS = [
  {
    frame: "首页",
    notes: "打开就能看到本周推荐与会员价，一键进入下单。",
    links: [{ from: "home-cta", to: 1 }],
    root: { type: "stack", id: "home-root", props: { gap: "md", padding: "md" }, children: [
      { type: "navbar", id: "home-nav", props: { title: "会员商城" } },
      { type: "hero", id: "home-hero", props: { title: "本周会员价", subtitle: "精选 12 款，限时 7 天" } },
      { type: "text", id: "home-intro", props: { content: "老会员下单再减 10 元，今晚 24 点前有效。" } },
      { type: "list", id: "home-list", props: { items: ["有机牛奶 · ¥39", "全麦面包 · ¥16", "冷萃咖啡 · ¥28"] } },
      { type: "button", id: "home-cta", props: { label: "立即下单", variant: "primary", full: true } },
    ] },
  },
  {
    frame: "下单",
    notes: "确认数量与地址，提交后回到首页。",
    links: [{ from: "order-submit", to: 0 }],
    root: { type: "stack", id: "order-root", props: { gap: "md", padding: "md" }, children: [
      { type: "navbar", id: "order-nav", props: { title: "确认订单" } },
      { type: "input", id: "order-addr", props: { label: "收货地址", placeholder: "例如：朝阳区望京 SOHO T1" } },
      { type: "stat", id: "order-total", props: { label: "合计", value: "¥83" } },
      { type: "text", id: "order-tip", props: { content: "会员价已自动抵扣 10 元。" } },
      { type: "button", id: "order-submit", props: { label: "提交订单", variant: "primary", full: true } },
    ] },
  },
];

const textOf = (m) =>
  typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content.map((p) => p.text ?? "").join("") : "";

/** 按提示词判断是哪一种调用，返回 `[kind, 回复文本]`。 */
export function answer(messages) {
  const all = (messages ?? []).map(textOf).join("\n");
  const one = /现在只画第 (\d+) 页/.exec(all);
  if (/"outline"/.test(all) && /只做两件事/.test(all)) {
    return ["outline", JSON.stringify({
      reply: "先拆成两页：首页看会员价，下单页确认提交。",
      tone: "给老会员用的购物小程序，信息密度适中，以价格和主按钮为视觉重点",
      accent: "blue",
      outline: SCREENS.map((s) => ({ frame: s.frame, intent: s.notes })),
    })];
  }
  if (one !== null) {
    const s = SCREENS[Number(one[1])] ?? SCREENS[0];
    return [`screen#${one[1]}`, JSON.stringify({ frame: s.frame, root: s.root, notes: s.notes, links: s.links })];
  }
  if (/writeback/.test(all) && /prototype/.test(all)) {
    return ["writeback", JSON.stringify({ reply: "画好了两页：首页和下单。", writeback: { prototype: SCREENS } })];
  }
  return ["other", "好的。"];
}

/** 起在 `127.0.0.1:port`；返回 `close()`。 */
export function startStandinModel({ port = 11434, logDir }) {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "standin" }] }));
        return;
      }
      let p = {};
      try { p = JSON.parse(body || "{}"); } catch { /* 坏请求按「其余」回 */ }
      const [kind, reply] = answer(p.messages);
      if (logDir !== undefined) appendFileSync(join(logDir, "calls.log"), `${new Date().toISOString()} ${req.url} ${kind}\n`);
      if (p.stream === true) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { role: "assistant", content: reply } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`);
        res.end("data: [DONE]\n\n");
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: reply } }] }));
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve({ close: () => new Promise((r) => server.close(() => r())) }));
  });
}
