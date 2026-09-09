/**
 * issue #3243 —— 「10 个画布：刷新后看不到、生成中又自动消失、最后声称全部交付但一个也看不到」
 * 的**结构性反证**。
 *
 * ## 同一事实在两处各算一遍
 *
 * 一轮 deep-agent run 里，用户**看见的助手正文**和**落库的助手正文**来自两个不同的地方：
 *
 *  ① 看见的：`tryStreamRun` 把远端 messages-tuple 流里**本轮所有顶层 AI 消息**的 token
 *     喂给 `onDelta`（嵌套子图按 `checkpoint_ns` 显式排除，见该处注释「Nested graphs
 *     belong to their task/tool trace, never the parent answer」）。10 个画布分 10 步产出，
 *     每步一条 AI 消息，用户就是这样一个一个看着它们画出来的。
 *  ② 落库的：`readCompletion` 取 `readFinalReply(messages)` —— **只有最后一条**非空 AI
 *     消息。它就是那句「所有 10 个画布模板现已完整交付」，里面**一个 ```canvas 围栏都没有**。
 *
 * 于是：run 一结束，前端 `restoreFinalMessages` 用落库正文顶替流式正文 ⇒ 已经画出来的
 * 画布**当场消失**；刷新页面读 `chat_messages` ⇒ 同样一个也看不到；而最后那句「全部交付」
 * 是真的——交付物确实产出过，只是从没被写进任何持久记录。
 *
 * 判据是**结构事实**（本轮流式吐出的 ```canvas 围栏条数 vs 落库正文里的围栏条数），
 * 不是「元素存在」或截图字节。
 */
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEEP_AGENT_PROVIDER_NAME,
  DeepAgentModelProvider,
} from "../../src/infrastructure/agent-run/deep-agent-model-provider";

const RUN_ID = "run-3243";
/** 与 `turnMessageId(turnKey, "user")` 逐字同形——本轮的起点锚。 */
const TURN_USER_ID = `wsx-turn:${RUN_ID}:user`;

function canvasFence(key: string): string {
  return ["```canvas", `模板: ${key}`, "## 分区一", "- 便签", "```"].join("\n");
}

/** 上一轮（历史）的回复——本轮正文**不得**把它算进来。 */
const PREVIOUS_TURN_REPLY = "上一轮的旧回复，与本轮无关。";

const CANVAS_KEYS = ["ai-strategy", "growth", "ops", "risk", "talent"] as const;

/**
 * 远端 checkpoint 的 `values.messages`：上一轮遗留 + 本轮锚点 + 每步一条带画布的 AI 消息
 * + 最后一条纯文字总结。形状照 `readCompletion` 真正读的那份 state。
 */
const THREAD_MESSAGES = [
  { type: "ai", content: PREVIOUS_TURN_REPLY, id: "old-turn-reply" },
  { type: "human", content: "生成 10 个画布模板", id: TURN_USER_ID },
  ...CANVAS_KEYS.map((key, i) => ({
    type: "ai",
    content: `第 ${i + 1} 个画布：\n\n${canvasFence(key)}`,
    id: `wsx-turn:${RUN_ID}:step-${i}`,
  })),
  { type: "ai", content: "所有 5 个画布模板现已完整交付。", id: `wsx-turn:${RUN_ID}:final` },
];

/** 用户在流式期间**看见**的那些 AI 消息正文（= 顶层、非空、本轮）。 */
const STREAMED_BODIES = THREAD_MESSAGES
  .slice(THREAD_MESSAGES.findIndex((m) => m.id === TURN_USER_ID) + 1)
  .filter((m) => m.type === "ai")
  .map((m) => m.content);

function countFences(text: string): number {
  return (text.match(/^```canvas$/gm) ?? []).length;
}

let server: Server | undefined;
afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

function startFake(): Promise<string> {
  server = createServer(async (req, res) => {
    const url = req.url ?? "";
    if (req.method === "POST" && url === "/threads") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ thread_id: "t1" }));
      return;
    }
    if (req.method === "POST" && url === "/threads/t1/runs") {
      for await (const _c of req) { /* drain */ }
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ run_id: "r1" }));
      return;
    }
    if (req.method === "GET" && url === "/threads/t1/runs/r1/stream") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      // 每条本轮 AI 消息作为一个 AIMessageChunk 流出（顶层命名空间，无 tool_call_id）——
      // 这正是用户一个一个看着画布出现的那条通路。
      STREAMED_BODIES.forEach((content, i) => {
        const chunk = { content, type: "AIMessageChunk", id: `wsx-turn:${RUN_ID}:stream-${i}` };
        res.write(`event: messages\ndata: [${JSON.stringify(chunk)}, {}]\n\n`);
      });
      res.end();
      return;
    }
    if (req.method === "GET" && url === "/threads/t1/runs/r1") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status: "success" }));
      return;
    }
    if (req.method === "GET" && url === "/threads/t1/state") {
      res.writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ values: { messages: THREAD_MESSAGES } }));
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) => {
    server!.listen(0, "127.0.0.1", () => {
      const address = server!.address();
      resolve(`http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`);
    });
  });
}

async function runTurn(baseUrl: string): Promise<{ text: string; deltas: string[] }> {
  const provider = new DeepAgentModelProvider({
    baseUrl, timeoutMs: 15_000, pollIntervalMs: 10, streamEnabled: true,
  });
  const deltas: string[] = [];
  const completion = await provider.completeWithProgress(
    {
      modelProvider: DEEP_AGENT_PROVIDER_NAME, modelId: "any", system: "s",
      user: "生成 10 个画布模板", history: [], skills: [],
      runId: RUN_ID, threadId: "chat-thread-3243",
    } as never,
    async () => {},
    async (delta) => { deltas.push(delta); },
  );
  return { text: completion.text, deltas };
}

describe("issue #3243 · 一轮 run 的助手正文只有一份事实", () => {
  it("落库正文必须含有本轮流式吐出的**全部**画布围栏——不是只剩最后那句总结", async () => {
    const baseUrl = await startFake();
    const { text, deltas } = await runTurn(baseUrl);

    // 前提自检：用户确实在流式里看见了 5 个画布围栏（否则这条断言在空转）。
    expect(countFences(deltas.join(""))).toBe(CANVAS_KEYS.length);

    // 结构判据：落库正文里的围栏条数 = 流式吐出的围栏条数。
    // 修复前这里是 0（`readFinalReply` 只取最后一条 AI 消息）。
    expect(countFences(text)).toBe(CANVAS_KEYS.length);
    for (const key of CANVAS_KEYS) expect(text).toContain(`模板: ${key}`);
    // 总结那句仍要在（它本来就是本轮的一部分，不是被替换掉）。
    expect(text).toContain("所有 5 个画布模板现已完整交付。");
  });

  it("本轮之外的旧回复不得被算进来——turn 锚点之前的 AI 消息一律不进正文", async () => {
    const baseUrl = await startFake();
    const { text } = await runTurn(baseUrl);
    expect(text).not.toContain(PREVIOUS_TURN_REPLY);
  });
});

/**
 * 锚点缺席时的**诚实降级**（不是"顺手也拼上"）。远端 state 里同时有历史轮和本轮时，
 * 没有锚点就无法区分两者——那时把所有 AI 消息拼起来会让上一轮的答案在本轮凭空重现。
 * 所以退回旧行为：只取最后一条非空 AI 消息。
 */
describe("issue #3243 · 找不到本轮锚点时退回最后一条 AI 消息", () => {
  it("没有 turnKey ⇒ 只取最后一条；不把历史轮拼进来", async () => {
    const { readTurnReply } = await import("../../src/infrastructure/agent-run/deep-agent-model-provider");
    expect(readTurnReply(THREAD_MESSAGES as never)).toBe("所有 5 个画布模板现已完整交付。");
  });

  it("给了 turnKey 但 state 里没有那个锚点 ⇒ 同样退回最后一条", async () => {
    const { readTurnReply } = await import("../../src/infrastructure/agent-run/deep-agent-model-provider");
    expect(readTurnReply(THREAD_MESSAGES as never, "some-other-run")).toBe("所有 5 个画布模板现已完整交付。");
  });

  it("给了本轮 turnKey ⇒ 本轮全部助手正文，历史轮排除", async () => {
    const { readTurnReply } = await import("../../src/infrastructure/agent-run/deep-agent-model-provider");
    const text = readTurnReply(THREAD_MESSAGES as never, RUN_ID);
    expect(countFences(text)).toBe(CANVAS_KEYS.length);
    expect(text).not.toContain(PREVIOUS_TURN_REPLY);
  });
});
