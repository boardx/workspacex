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
    if (record.statusPolls < 2) { sendJson(res, 200, { status: "pending" }); return; }
    // 第二次起终态——见头注。用户原话逐字等于失败触发词时终态是 error，不是 success。
    const status = FAILURE_TRIGGER !== undefined && record.userText === FAILURE_TRIGGER ? "error" : "success";
    sendJson(res, 200, { status });
    return;
  }

  const stateMatch = /^\/threads\/([^/]+)\/state$/.exec(url);
  if (req.method === "GET" && stateMatch) {
    const threadId = stateMatch[1]!;
    const record = runs.get(threadId);
    if (!record) { sendJson(res, 404, { error: "unknown thread" }); return; }
    const toolCallId = `call-${threadId}`;
    const toolResult = `已查询：当前时间 ${new Date().toISOString()}。用户原话："${record.userText}"`;
    const finalReply = `根据查询结果回答你："${record.userText}" —— ${toolResult}`;
    sendJson(res, 200, {
      values: {
        messages: [
          { type: "human", content: record.userText },
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
