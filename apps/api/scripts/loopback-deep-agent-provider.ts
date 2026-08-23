#!/usr/bin/env node
/**
 * #728 P6/P7 —— 确定性的 `apps/deep-agent-service` 替身，供 chat-read e2e 用。
 *
 * ## 为什么不是起一个真的 `langgraph dev` 进程
 *
 * `apps/deep-agent-service` 本身在 `Dockerfile` 的头注里写死了：本仓从未在任何自动化
 * 路径（包括 `.harness/scripts/vm/deploy.sh`）里起过它，是人工在 VM 上启动的一个真实
 * Python/LangGraph 服务，且需要真实模型凭据才能让模型自己决定"要不要调工具"。
 * 在 e2e 里接一个从未被自动化过、还依赖真实模型凭据的外部服务，风险和工作量都不是
 * 一轮迭代该扛的。
 *
 * ## 这不是在 UI 层造假，是在同一条真实执行链路上换一个可预测的上游
 *
 * 和 `loopback-model-provider.ts` 同一套纪律（见那个文件的头注）：
 *   · 必须被**显式选中**——只有 `agent_versions.model_provider = "deep-agent"` 的 run
 *     才会打到这里；`DeepAgentModelProvider.startRun` 对不等于 `DEEP_AGENT_PROVIDER_NAME`
 *     的 run 直接拒绝，不存在"顺便"落到这个进程的路径。
 *   · 产品代码里仍然只有 `DeepAgentModelProvider` 一个实现在说话——本进程只是那个
 *     实现要打的 HTTP 上游，`execute-run.ts` 的 `completeWithProgress` 分支、
 *     `extractToolCallEvents` 的配对逻辑、`AgentRunToolCallSteps` 的渲染，一行都没有
 *     被绕过或替换，走的是真代码、真 HTTP、真状态机。
 *   · 缺席时不会有人替它兜底：`KERNEL_DEEP_AGENT_BASE_URL` 不设，run 就以
 *     `MODEL_PROVIDER_NOT_CONFIGURED` 诚实失败。
 *
 * ## 协议来源
 *
 * 严格照抄 `deep-agent-model-provider.ts` 自己文档的四个端点与消息形状（LangChain
 * `AIMessage`/`ToolMessage`），不是猜的：
 *   POST /threads                    -> { thread_id }
 *   POST /threads/:id/runs           -> { run_id }
 *   GET  /threads/:id/runs/:runId    -> { status: "pending" | "success" }
 *   GET  /threads/:id/state          -> { values: { messages: ThreadMessage[] } }
 *
 * `state` 从第一次读起就是「完整」的（计划句 + 一次工具调用 + 配对的工具结果 +
 * 最终回复），不做「过几轮才补全」的时序游戏——`completeWithProgress` 的轮询循环
 * 本来就会在 run 到终态后再补读一次，用不着靠人为延迟制造"中途态"，那样只会引入
 * e2e 里不必要的时序竞争。`status` 前一次答 `pending`、后一次答 `success`，只是为了
 * 让真实的轮询循环真的转一圈，不是首次调用就终态——这本身也是一种取证：证明轮询
 * 逻辑真的在工作，不是恰好一次到位。
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const port = Number(process.env.LOOPBACK_DEEP_AGENT_PROVIDER_PORT ?? "");
if (!Number.isInteger(port) || port <= 0) {
  throw new Error("LOOPBACK_DEEP_AGENT_PROVIDER_PORT must be a positive integer");
}

/**
 * 计划句 + 工具名 + 回显用户原文进结果里，三者都是"闭环真的穿过了整条链"的证据——
 * 同一纪律 `loopback-model-provider.ts` 头注里"为什么要回显用户原文"那段。
 */
const PLANNING_NOTE = process.env.LOOPBACK_DEEP_AGENT_PLANNING_NOTE ?? "我需要先查一下当前时间，再回答这个问题。";
const TOOL_NAME = process.env.LOOPBACK_DEEP_AGENT_TOOL_NAME ?? "lookup_time";
// UI 流式取证的时序旋钮（2026-08-23）：默认值保持既有行为（run ~1s 内完成），
// 取证 config 把两者调大让 run 拖到数秒——截图采样间隔 1.5s，窗口太短第一帧
// 就已终态，streaming 行永远拍不到（v4 取证实测教训）。真实模型是秒级往返，
// 慢速档模拟的才是真实时序，不是造假。
const STATUS_POLLS_BEFORE_DONE = Number(process.env.LOOPBACK_DEEP_AGENT_STATUS_POLLS ?? "2");
const STREAM_GAP_MS = Number(process.env.LOOPBACK_DEEP_AGENT_STREAM_GAP_MS ?? "80");
/**
 * #728 P9 —— 确定性失败触发词。用户消息**逐字等于**这个值时，本进程让 run 走到
 * `error` 终态而不是 `success`，供取证脚本构造一次真实失败并截图——不是在前端
 * 伪造一个失败态组件，是让这条真实的 `DeepAgentModelProvider.pollToTerminal` 轮询
 * 循环真的读到 `error` 状态、真的抛 `ModelCallError`、真的让 `execute-run.ts` 把
 * run 落成 `failed`。触发词从环境变量读，唯一事实源在
 * `apps/web/e2e/chat-read-fixture.ts` 的 `deepAgentFailureTrigger`，两头不各写一份。
 */
const FAILURE_TRIGGER = process.env.LOOPBACK_DEEP_AGENT_FAILURE_TRIGGER;

interface RunRecord {
  readonly userText: string;
  statusPolls: number;
}

const runs = new Map<string, RunRecord>();

function readBody(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => { text += chunk; });
    stream.on("end", () => resolve(text));
    stream.on("error", reject);
  });
}

function sendJson(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

interface CreateRunBody {
  readonly input?: { readonly messages?: { readonly role?: string; readonly content?: unknown }[] };
}

const server = createServer((req, res) => {
  const url = req.url ?? "";

  if (req.method === "GET" && url === "/healthz") {
    sendJson(res, 200, { status: "ok" });
    return;
  }

  if (req.method === "POST" && url === "/threads") {
    // DA-04：真实 LangGraph Platform 支持调用方指定 thread_id + if_exists 幂等创建，
    // provider 的 ensureThread 靠它做线程连续性。假上游必须镜像同一协议面——
    // 「loopback 假上游要与真上游同步改」是 dashscope realtime ASR 那次的教训原话。
    void readBody(req).then((raw) => {
      let requested: string | undefined;
      try {
        const parsed = raw === "" ? {} : (JSON.parse(raw) as { thread_id?: string });
        requested = typeof parsed.thread_id === "string" && parsed.thread_id !== "" ? parsed.thread_id : undefined;
      } catch {
        requested = undefined;
      }
      const threadId = requested ?? randomUUID();
      if (!runs.has(threadId)) runs.set(threadId, { userText: "", statusPolls: 0 });
      sendJson(res, 200, { thread_id: threadId });
    });
    return;
  }

  const runsMatch = /^\/threads\/([^/]+)\/runs$/.exec(url);
  if (req.method === "POST" && runsMatch) {
    const threadId = runsMatch[1]!;
    void readBody(req).then((raw) => {
      const existing = runs.get(threadId);
      if (!existing) { sendJson(res, 404, { error: "unknown thread" }); return; }
      let parsed: CreateRunBody;
      try {
        parsed = JSON.parse(raw) as CreateRunBody;
      } catch {
        sendJson(res, 400, { error: "invalid json" });
        return;
      }
      const lastUser = [...(parsed.input?.messages ?? [])].reverse().find((m) => m.role === "user")?.content;
      runs.set(threadId, { userText: typeof lastUser === "string" ? lastUser : "", statusPolls: 0 });
      // 用 thread id 直接当 run id：同一线程本进程不并发跑第二个 run，够用，
      // 不需要为了"看起来更像真服务"多维护一份映射。
      sendJson(res, 200, { run_id: threadId });
    });
    return;
  }

  const statusMatch = /^\/threads\/([^/]+)\/runs\/([^/]+)$/.exec(url);
  if (req.method === "GET" && statusMatch) {
    const threadId = statusMatch[1]!;
    const record = runs.get(threadId);
    if (!record) { sendJson(res, 404, { error: "unknown run" }); return; }
    record.statusPolls += 1;
    if (record.statusPolls < STATUS_POLLS_BEFORE_DONE) { sendJson(res, 200, { status: "pending" }); return; }
    // 第二次起终态——见头注。用户原话逐字等于失败触发词时终态是 error，不是 success。
    const status = FAILURE_TRIGGER !== undefined && record.userText === FAILURE_TRIGGER ? "error" : "success";
    sendJson(res, 200, { status });
    return;
  }

  // DA-03 取证扩展：join 流端点（messages-tuple 形状，与真 LangGraph 一致）。
  // 逐片发 finalReply（每片 ~8 字符、间隔 80ms）——「相邻帧正文字数不同」是
  // UI 评分第 1 项的判据，整段一次性发等于白做。
  const streamMatch = /^\/threads\/([^/]+)\/runs\/([^/]+)\/stream$/.exec(url);
  if (req.method === "GET" && streamMatch) {
    const threadId = streamMatch[1]!;
    const record = runs.get(threadId);
    if (!record) { sendJson(res, 404, { error: "unknown thread" }); return; }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const reply = `根据查询结果回答你："${record.userText}" —— 已查询当前时间，详情见工具结果。`;
    const pieces: string[] = [];
    for (let i = 0; i < reply.length; i += 8) pieces.push(reply.slice(i, i + 8));
    let idx = 0;
    const timer = setInterval(() => {
      if (idx >= pieces.length) {
        clearInterval(timer);
        res.end();
        return;
      }
      res.write(`event: messages\ndata: [{"content": ${JSON.stringify(pieces[idx])}, "type": "AIMessageChunk"}, {}]\n\n`);
      idx += 1;
    }, STREAM_GAP_MS);
    req.on("close", () => clearInterval(timer));
    return;
  }

  const stateMatch = /^\/threads\/([^/]+)\/state$/.exec(url);
  if (req.method === "GET" && stateMatch) {
    const threadId = stateMatch[1]!;
    const record = runs.get(threadId);
    if (!record) { sendJson(res, 404, { error: "unknown thread" }); return; }
    const toolCallId = `call-${threadId}`;
    // DA-06 取证扩展（#1749，UI 主卡第 2 项「规划步骤」）：剧本先发一次 write_todos
    // ——与真 deepagents TodoListMiddleware 的调用形状一致（args.todos 数组），
    // 让规划条（agent-plan-panel）在确定性替身下也能被真实渲染并被取证脚本拍到。
    // 三态齐全：completed/in_progress/pending，前端逐态图标都有得判。
    const todosCallId = `todos-${threadId}`;
    const todosArgs = {
      todos: [
        { content: "理解用户问题", status: "completed" },
        { content: "查询当前时间", status: "in_progress" },
        { content: "组织最终回答", status: "pending" },
      ],
    };
    const toolResult = `已查询：当前时间 ${new Date().toISOString()}。用户原话："${record.userText}"`;
    const finalReply = `根据查询结果回答你："${record.userText}" —— ${toolResult}`;
    sendJson(res, 200, {
      values: {
        messages: [
          { type: "human", content: record.userText },
          {
            type: "ai",
            content: "",
            tool_calls: [{ id: todosCallId, name: "write_todos", args: todosArgs }],
          },
          { type: "tool", tool_call_id: todosCallId, content: "todos updated" },
          {
            type: "ai",
            content: PLANNING_NOTE,
            tool_calls: [{ id: toolCallId, name: TOOL_NAME, args: { query: record.userText } }],
          },
          { type: "tool", tool_call_id: toolCallId, content: toolResult },
          { type: "ai", content: finalReply },
        ],
      },
    });
    return;
  }

  res.writeHead(404).end();
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`[loopback-deep-agent-provider] listening on 127.0.0.1:${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
