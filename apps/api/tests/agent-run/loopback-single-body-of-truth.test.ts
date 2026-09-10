/**
 * issue #3389 —— **替身的两个端点必须说同一句话。**
 *
 * ## 缺陷的真实形状（issue #3389「诊断定案」的逐帧证据，真栈四轮形状一致）
 *
 * ```
 * 2961 dom uid=1 len=157   ← 流式正文长完（/stream 那份）
 * 3279 dom uid=1 len=0     ← 被抹掉，节点身份不变
 * 3414 wire assistant_message_replaced + TEXT_MESSAGE_START/CONTENT(232)
 * 4348 dom uid=5 len=232   ← 才重新出现（/state 那份），空白窗口 ~1.07s
 * ```
 *
 * 157 与 232 是**同一轮同一句话的两个版本**：`/stream`（用户逐片看到的）与 `/state`
 * （落库的）此前各写了一份措辞不同的默认模板，本文件之前那版头注还把这条分歧当作
 * "刻意保留、不在本次范围"。它不是无害的排版差异——两份正文一旦对不上，
 * `execution-journal-relay.ts` 的 `finish()` 就只能「撤回已流出的全部气泡 + 整段重发」
 * 把它们对齐，撤回与重绘之间就是用户看到的那段空白。真实上游不会这么说话，
 * 替身却在稳定制造这个产品级缺陷的形状——「替身的方言不是上游的方言」的又一例。
 *
 * ## 本文件钉住的不变量
 *
 * 默认剧本下，`/state` 的最终 assistant 正文与 `/stream` 逐片拼起来的正文**逐字相等**。
 *
 * ⚠ 反证纪律：把 `loopback-deep-agent-provider.ts` 里 `/state` 那句
 * `computeSpecialTurnReply(...) ?? defaultTurnReply(record)` 改回原来那句带 `toolResult`
 * 的字面量，本用例当场红，并逐字打印出两份正文的差异。
 */
import { expect, it } from "vitest";
import { fixture } from "./loopback-deep-agent-fixture";

/** SSE 帧 → 模型 token 拼起来的正文（只取 `event: messages` 的 AIMessageChunk 片段）。 */
function streamedText(frames: readonly string[]): string {
  let text = "";
  for (const frame of frames) {
    const line = frame.split("\n").find((l) => l.startsWith("data: "));
    if (line === undefined || !frame.includes("event: messages")) continue;
    const [chunk] = JSON.parse(line.slice("data: ".length)) as [{ content?: string; type?: string }];
    if (chunk?.type === "AIMessageChunk" && typeof chunk.content === "string") text += chunk.content;
  }
  return text;
}

it("默认剧本：/state 的终稿与 /stream 逐片拼出来的正文逐字相等——一轮回复只有一份事实", async () => {
  const request = fixture({ LOOPBACK_DEEP_AGENT_STREAM_GAP_MS: "0" });
  await request("POST", "/threads", { thread_id: "thread" });
  await request("POST", "/threads/thread/runs", {
    input: { messages: [{ role: "user", content: "现在几点" }] },
  });

  const stream = request.openStream("/threads/thread/runs/thread/stream");
  await new Promise((resolve) => setTimeout(resolve, 50));
  const streamed = streamedText(stream.frames);

  const state = await request("GET", "/threads/thread/state");
  const bodies = (state.values.messages as { type: string; content: unknown }[])
    .filter((m) => m.type === "ai" && typeof m.content === "string" && (m.content as string).trim() !== "")
    .map((m) => m.content as string);
  const finalBody = bodies[bodies.length - 1];

  expect(streamed, "替身 /stream 端点应真的吐出正文分片").not.toBe("");
  expect(finalBody).toBe(streamed);
});
