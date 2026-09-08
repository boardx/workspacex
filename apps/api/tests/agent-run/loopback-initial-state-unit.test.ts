import { expect, it } from "vitest";
import { fixture } from "./loopback-deep-agent-fixture";

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
  // issue #3100 D6：剧本多了 `spawn_async_task` 一步（宣布 + 回执各占一个半步），终稿
  // 落在第 8 个半步，`MULTISTEP_MIN_STATUS_POLLS` 随之从 6 抬到 8——这里的 7/8 不是
  // 魔数，是"终稿之前一律 pending、终稿那一刻才 success"这同一条判据在新剧本长度上的值。
  for (let i = 0; i < 7; i += 1) expect(await request("GET", "/threads/thread/runs/thread")).toEqual({status: "pending"});
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
