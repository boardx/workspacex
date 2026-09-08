import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, it } from "vitest";
import { DEEP_AGENT_HITL_TOOL_NAME } from "@repo/contracts/deep-agent-hitl";
import { PLAN_CONFIRMATION_TOOL_NAME } from "@repo/contracts/plan-control";
import { buildDeepAgentSkillCatalogBlock } from "../../src/application/agent-run/skill-catalog";

/** Exercise the actual fixture handler without creating a listener, process or Docker. */
function fixture(extraEnv: Record<string, string> = {}) {
  let handle: (request: unknown, response: unknown) => void;
  const server = { listen: () => {}, close: () => {} };
  const source = readFileSync(new URL("../../scripts/loopback-deep-agent-provider.ts", import.meta.url), "utf8");
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    // 替身用 `setInterval` 驱动 SSE 帧节奏（十步滚动剧本的推进游标就挂在上面），
    // vm 上下文默认没有计时器——不给它就等于把「节奏」这件事从被测面里删掉。
    setInterval, clearInterval, setTimeout, clearTimeout, Date, JSON, Math,
    exports: {}, process: {env: {LOOPBACK_DEEP_AGENT_PROVIDER_PORT: "9999", LOOPBACK_DEEP_AGENT_MULTISTEP_TRIGGER: "multistep", ...extraEnv}, once: () => {}},
    require: (name: string) => {
      if (name === "node:http") return {createServer: (callback: typeof handle) => { handle = callback; return server; }};
      if (name === "node:crypto") return {randomUUID};
      if (name === "@repo/contracts/deep-agent-hitl") return {DEEP_AGENT_HITL_TOOL_NAME};
      // 路径矩阵 D4：替身判定「skill 目录块」时从产品源码取那一行头，不在替身里抄第二份
      // 字面量（同上面 `DEEP_AGENT_HITL_TOOL_NAME` 那条既有理由：允许分叉就等于允许静默
      // 假绿）。这个 shim 是白名单，新增依赖必须显式列进来——本条正是那个显式动作。
      if (name === "../src/application/agent-run/skill-catalog") return {buildDeepAgentSkillCatalogBlock};
      // issue #3132（B7）：替身要演计划确认门，工具名同样从契约取，不在替身里抄第二份
      // 字面量——与上面两条同一条理由。这一行就是白名单要求的那个显式动作。
      if (name === "@repo/contracts/plan-control") return {PLAN_CONFIRMATION_TOOL_NAME};
      throw new Error(`unexpected fixture dependency: ${name}`);
    },
  });
  const request = (method: string, url: string, body?: unknown): Promise<any> => new Promise(resolve => {
    const incoming = Object.assign(Readable.from(body === undefined ? [] : [JSON.stringify(body)]), {method, url});
    const response = {writeHead: () => response, end: (text: string) => resolve(JSON.parse(text))};
    handle(incoming, response);
  });
  /** SSE 形态的响应替身：帧留在数组里，流不结束也能被观察——正是本文件要证的那件事。 */
  const openStream = (url: string) => {
    const frames: string[] = [];
    let ended = false;
    const incoming = Object.assign(Readable.from([]), {method: "GET", url, on: () => incoming});
    const response = {
      writeHead: () => response,
      write: (chunk: string) => { frames.push(chunk); return true; },
      end: () => { ended = true; },
      destroy: () => { ended = true; },
    };
    handle(incoming, response);
    return {frames, isEnded: () => ended};
  };
  return Object.assign(request, {openStream});
}
it("new empty thread has no fabricated future tool history; ensureThread preserves real completed history", async () => {
  const request = fixture();
  await request("POST", "/threads", {thread_id: "thread"});
  expect(await request("GET", "/threads/thread/state")).toEqual({values: {messages: []}});
  await request("POST", "/threads/thread/runs", {input: {messages: [{role: "user", content: "actual user"}]}});
  const started = await request("GET", "/threads/thread/state");
  expect(started.values.messages.some((message: any) => message.tool_calls?.some((call: any) => call.name === "write_todos"))).toBe(true);
  await request("GET", "/threads/thread/runs/thread");
  expect(await request("GET", "/threads/thread/runs/thread")).toEqual({status: "success"});
  await request("POST", "/threads", {thread_id: "thread", if_exists: "do_nothing"});
  expect((await request("GET", "/threads/thread/state")).values.messages[0].content).toBe("actual user");
});
it("exact multistep trigger keeps run nonterminal across the early status polls", async () => {
  const request = fixture();
  await request("POST", "/threads", {thread_id: "thread"});
  await request("POST", "/threads/thread/runs", {input: {messages: [{role: "user", content: "multistep"}]}});
  for (let i = 0; i < 5; i += 1) expect(await request("GET", "/threads/thread/runs/thread")).toEqual({status: "pending"});
  expect(await request("GET", "/threads/thread/runs/thread")).toEqual({status: "success"});
});

/**
 * 反证（issue #3069）——十步滚动剧本必须**逐步**推进，而不是流结束后一次性吐出来。
 *
 * 基线 run 34198904439 的 trace 逐字证据：整轮 776ms，十个 `tool_start` 挤在 135ms
 * 内。根因是 `/stream` 在正文发完时立刻 EOF 并把 `statusPolls` 推到
 * `Number.MAX_SAFE_INTEGER`，于是 `/state` 的十对调用同时全部满足条件，provider
 * 只在流后兜底读一次 state 就把它们全记了账。真 LangGraph 的 join 流会在图还在跑
 * 工具节点时保持打开，逐个发 `event: updates` 的 `{"tools": ...}` patch。
 *
 * 这条测试盯的正是那两件事：流在正文发完后**不结束**，且每个半步只新增一条 message，
 * 于是「宣布了但还没回执」这个状态真的存在一整个 `SCROLL_STEP_MS` 窗口。
 */
it("scroll acceptance script advances one tool half-step at a time while the join stream stays open", async () => {
  const request = fixture({LOOPBACK_DEEP_AGENT_SCROLL_ACCEPTANCE_TRIGGER: "scroll", LOOPBACK_DEEP_AGENT_SCROLL_STEP_MS: "15", LOOPBACK_DEEP_AGENT_STREAM_GAP_MS: "1"});
  await request("POST", "/threads", {thread_id: "thread"});
  await request("POST", "/threads/thread/runs", {input: {messages: [{role: "user", content: "scroll"}]}});
  const stream = request.openStream("/threads/thread/runs/thread/stream");

  const toolCallIds = (messages: any[]) => messages.filter((m) => Array.isArray(m.tool_calls)).flatMap((m) => m.tool_calls.map((c: any) => c.id));
  const answeredIds = (messages: any[]) => messages.filter((m) => m.type === "tool").map((m) => m.tool_call_id);

  // 正文帧发完之后流仍然开着——这一步就是旧实现的反面。
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(stream.isEnded(), "正文发完后 join 流不该立刻 EOF").toBe(false);

  const widths: number[] = [];
  for (let step = 0; step < 40; step += 1) {
    await new Promise((resolve) => setTimeout(resolve, 8));
    const messages = (await request("GET", "/threads/thread/state")).values.messages as any[];
    widths.push(toolCallIds(messages).length - answeredIds(messages).length);
  }
  // 每个奇数半步都留下一个「已宣布、未回执」的调用；旧实现里这个宽度恒为 0。
  expect(widths.some((width) => width === 1), `每个半步的在途工具数：${JSON.stringify(widths)}`).toBe(true);

  for (let wait = 0; wait < 100 && !stream.isEnded(); wait += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  const final = (await request("GET", "/threads/thread/state")).values.messages as any[];
  expect(toolCallIds(final)).toHaveLength(10);
  expect(answeredIds(final)).toHaveLength(10);
  expect(final.some((m) => typeof m.id === "string" && m.id.endsWith(":final"))).toBe(true);
  expect(stream.frames.some((frame) => frame.startsWith("event: updates") && frame.includes('"tools"')),
    "工具落地必须以真引擎的 `event: updates` 形状发出来（`tryStreamRun` 只认这一支做事件驱动记账）").toBe(true);
  expect(stream.isEnded(), "剧本演完后流才 EOF").toBe(true);
});
