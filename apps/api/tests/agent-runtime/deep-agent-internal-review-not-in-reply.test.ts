/**
 * issue #3386 —— 「用户可见的回复正文里出现了系统内部的自我评分/纠错对话」的**结构性反证**。
 *
 * ## 人类 2026-09-11 devapp 实测原话
 *
 * 问「帮我搜一下 2026 年新能源汽车销量的最新数据」，回复正文末尾出现：
 *
 * > 感谢 grading 反馈。经重新抓取 CnEVPost 原文核实，+110% 和 +140% 这两个数字确实存在于
 * > 工具返回的全文中，并非编造。以下是修正后的完整回复……
 *
 * 用户已经在这段**之上**读完了一份回复，于是不知道自己读的是哪一份、该信哪一份；而
 * 「并非编造」这句为自证清白写的话，在用户视角变成了自认曾经编造。
 *
 * ## 链路事实（不是从代码结构推的）
 *
 * `deepagents 0.7.6` 的 `middleware/rubric.py::_compose_update` 在 grader 判 `needs_revision`
 * 时，把反馈包成 `HumanMessage(name="rubric_grader")` **注回 `messages`** 并 `jump_to: "model"`。
 * 模型于是把它当成用户的新一轮发言，用对话口吻回它。这一轮的 `messages` 因此是：
 *
 *     [本轮用户提问] → [AI 旧草稿] → [ToolMessage] → [内部注入的 human] → [AI 返工稿]
 *
 * 而 `joinTurnAssistantBodies` 取本轮**全部**顶层 AI 正文（#3243 为了保住分步产出的画布），
 * 于是旧草稿与返工稿被 `\n\n` 拼成一条 —— 这就是用户看到的两份。
 *
 * ## 判据表达的是「这一类」，不是「这一句」
 *
 * 断言**不匹配任何措辞**（不含「grading」「返工」「修正后」等黑名单）。判据是**来源**：
 * 本轮消息被切到用户提问之后，`human` 位就再没有合法占用者 —— 那之后出现的任何 `human`
 * 消息按构造只能是运行时内部环节注入的。正文只允许来自**最后一次内部注入之后**的 AI
 * 消息。下面第三条用两种完全不同的措辞跑同一条判据，证明换措辞绕不过去。
 */
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEEP_AGENT_PROVIDER_NAME,
  DeepAgentModelProvider,
  joinTurnAssistantBodies,
  readTurnReply,
} from "../../src/infrastructure/agent-run/deep-agent-model-provider";

const RUN_ID = "run-3386";
const TURN_USER_ID = `wsx-turn:${RUN_ID}:user`;

/** 被内部环节判为要返工的旧草稿——用户不该再读到它。 */
const SUPERSEDED_DRAFT =
  "2026 年 1-8 月中国新能源汽车销量约 780 万辆，出口同比 +110%，其中纯电出口 +140%。";

/** 库 `_revision_prompt` 注回 messages 的那条内部消息（措辞照库源码第一句）。 */
const INTERNAL_REVIEW_FEEDBACK =
  "A grader reviewed your work against the rubric and asked for revisions before we can finish.";

/** 模型把上面那条当成用户发言后写出的返工稿——泄漏的那段就长在它开头。 */
const REVISION_WITH_META_PREAMBLE = [
  "感谢 grading 反馈。经重新抓取 CnEVPost 原文核实，+110% 和 +140% 这两个数字确实存在于",
  "工具返回的全文中，并非编造。以下是修正后的完整回复：",
  "",
  "2026 年 1-8 月中国新能源汽车销量约 780 万辆（来源：CnEVPost 第 3 段）。",
].join("\n");

const THREAD_MESSAGES = [
  { type: "human", content: "帮我搜一下 2026 年新能源汽车销量的最新数据", id: TURN_USER_ID },
  { type: "ai", content: "", id: `wsx-turn:${RUN_ID}:call`, tool_calls: [{ name: "web_search", id: "tc1" }] },
  { type: "tool", content: "CnEVPost 全文…", id: `wsx-turn:${RUN_ID}:tool`, tool_call_id: "tc1" },
  { type: "ai", content: SUPERSEDED_DRAFT, id: `wsx-turn:${RUN_ID}:draft` },
  // ← 内部注入。它之上的 AI 正文全部作废。
  { type: "human", content: INTERNAL_REVIEW_FEEDBACK, name: "rubric_grader" },
  { type: "ai", content: REVISION_WITH_META_PREAMBLE, id: `wsx-turn:${RUN_ID}:revision` },
];

let server: Server | undefined;
afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

function startFake(messages: readonly unknown[]): Promise<string> {
  server = createServer(async (req, res) => {
    const url = req.url ?? "";
    const json = (body: unknown): void => {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
    };
    if (req.method === "POST" && url === "/threads") return json({ thread_id: "t1" });
    if (req.method === "POST" && url === "/threads/t1/runs") {
      for await (const _c of req) { /* drain */ }
      return json({ run_id: "r1" });
    }
    if (req.method === "GET" && url === "/threads/t1/runs/r1") return json({ status: "success" });
    if (req.method === "GET" && url === "/threads/t1/state") return json({ values: { messages } });
    res.writeHead(404).end();
  });
  return new Promise((resolve) => {
    server!.listen(0, "127.0.0.1", () => {
      const address = server!.address();
      resolve(`http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`);
    });
  });
}

async function completedBody(baseUrl: string): Promise<string> {
  const provider = new DeepAgentModelProvider({ baseUrl, timeoutMs: 15_000, pollIntervalMs: 10 });
  const completion = await provider.complete({
    modelProvider: DEEP_AGENT_PROVIDER_NAME, modelId: "any", system: "s",
    user: "帮我搜一下 2026 年新能源汽车销量的最新数据", history: [], skills: [],
    runId: RUN_ID, threadId: "chat-thread-3386",
  } as never);
  return completion.text;
}

/** 正文里「本轮里非用户 human 消息之前的 AI 正文」的条数——0 才算没泄漏。 */
function supersededBodiesLeaked(text: string, messages: readonly { type?: string; content?: unknown }[]): string[] {
  const cut = messages.findIndex((m, i) => i > 0 && m.type === "human");
  const before = cut < 0 ? [] : messages.slice(0, cut);
  return before
    .filter((m) => m.type === "ai" && typeof m.content === "string" && m.content.trim() !== "")
    .map((m) => m.content as string)
    .filter((body) => text.includes(body));
}

describe("issue #3386 · 内部质检环节的产物不得进入用户可见正文", () => {
  it("落库正文只含最后一次内部注入之后的助手正文——被取代的旧草稿一个字都不进", async () => {
    const baseUrl = await startFake(THREAD_MESSAGES);
    const text = await completedBody(baseUrl);

    // 前提自检：本轮确实发生了一次内部注入（否则这条断言在空转）。
    expect(THREAD_MESSAGES.slice(1).some((m) => m.type === "human")).toBe(true);

    // 判据（按来源，不按措辞）：内部注入之前的 AI 正文一条都不许出现在用户正文里。
    expect(supersededBodiesLeaked(text, THREAD_MESSAGES)).toEqual([]);
    // 现行答案照常在——修的是「两份拼一起」，不是把回复删空。
    expect(text).toContain("2026 年 1-8 月中国新能源汽车销量约 780 万辆（来源：CnEVPost 第 3 段）。");
  });

  it("没有内部注入的一轮逐字不变——#3243 的分步产出全部保留", () => {
    const plain = [
      { type: "ai", content: "第 1 个画布", id: "a" },
      { type: "ai", content: "第 2 个画布", id: "b" },
      { type: "ai", content: "两个画布都已交付。", id: "c" },
    ];
    expect(joinTurnAssistantBodies(plain as never)).toBe("第 1 个画布\n\n第 2 个画布\n\n两个画布都已交付。");
  });

  it("换一套完全不同的措辞，同一条判据照样接住——它抓的是来源不是这七个字", () => {
    for (const wording of [
      "感谢 grading 反馈。以下是修正后的完整回复：\n\n真正的答案。",
      "好的，我重新核对了一遍质检清单里点出的问题。下面重新给一版：\n\n真正的答案。",
      "Thanks for the review notes — revised answer below.\n\n真正的答案。",
    ]) {
      const messages = [
        { type: "human", content: "问题", id: TURN_USER_ID },
        { type: "ai", content: SUPERSEDED_DRAFT, id: "draft" },
        { type: "human", content: "任意内部反馈措辞", name: "whatever_future_middleware" },
        { type: "ai", content: wording, id: "revision" },
      ];
      const text = readTurnReply(messages as never, RUN_ID);
      expect(text).not.toContain(SUPERSEDED_DRAFT);
      expect(text).toBe(wording);
    }
  });
});
