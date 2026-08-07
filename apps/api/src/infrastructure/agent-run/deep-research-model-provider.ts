/**
 * `DeepResearchModelProvider` -- the second `ModelCallPort` implementation (2026-08-07,
 * human直接指令: "去 LangChain GitHub 里面搜索 Open Deep Research 的一个 agent，导入到
 * 后台，在 chat 里面可以去引用 deep research").
 *
 * ## Why this is not `ConfiguredModelProvider` with a different base URL
 *
 * `open_deep_research`（langchain-ai，MIT）不是一个 OpenAI-compatible `/chat/completions`
 * 端点——它是一个独立部署的 LangGraph 服务（本仓在 devapp VM 上以 Docker 容器运行，
 * `langgraph dev`，仅绑定 `127.0.0.1:2024`），协议是"创建线程 → 提交 run → 轮询到终态 →
 * 读线程 state 取最终消息"，不是单次 request/response。`ConfiguredModelProvider.complete()`
 * 假设"一次 HTTP POST 就拿到完整回复"，这里假设不成立，所以是一个独立的端口实现，不是
 * 同一个类多一个分支。
 *
 * ## 为什么轮询预算比 `ConfiguredModelProvider` 的 180s 长得多
 *
 * 深度研究本身就是"多轮子代理研究 + 反思 + 报告生成"，2026-08-07 devapp 实测一次真实
 * run（真 Tavily 搜索 + qwen3.8-max）跑了约 100 秒，复杂问题会更长。这条超时挡的是
 * "服务真的挂了"，不是"研究本来就慢"——`KERNEL_DEEP_RESEARCH_TIMEOUT_MS` 默认 10 分钟，
 * 比交互式聊天的超时宽松得多，因为这个 agent 的执行发生在后台 tick worker 里，不是
 * 一次阻塞的用户请求。
 *
 * ## 最终回复怎么取
 *
 * 线程 state 的 `values.messages` 是这次对话的完整消息数组（含 supervisor 内部的
 * system/human 消息）。真正的最终答案是数组里**最后一条 `type === "ai"` 且有非空
 * `content`** 的消息——`deep_researcher.py` 的图在 `final_report_generation` 节点把
 * 报告作为最后一条 AIMessage 追加进 `messages`（不是 `supervisor_messages`，那是内部
 * 编排状态，不对用户暴露）。
 */
import type { ModelCallInput } from "../../application/agent-run/ports";
import { ModelCallError, type ModelCallPort } from "../../application/agent-run/ports";

export const DEEP_RESEARCH_PROVIDER_NAME = "open-deep-research";
/** langgraph.json 里声明的 graph 名字，`/assistants` 与 `/threads/:id/runs` 都按这个找图。 */
const ASSISTANT_ID = "Deep Researcher";

export interface DeepResearchProviderConfig {
  /** 只应该是内网地址（如 `http://127.0.0.1:2024`）——这个服务没有独立鉴权，见部署文件头注。 */
  readonly baseUrl: string;
  readonly pollIntervalMs: number;
  readonly timeoutMs: number;
}

/**
 * ⚠ 2026-08-07 devapp 实测：这个服务目前是手动 `docker run` 在 VM 上起的（见
 * PR #680 描述"已知限制"），从没接进 `deploy.sh` 那条给 `KERNEL_MODEL_*` 用的
 * "生成 deploy.env → 每次部署读一遍"流水线——production 的 `deploy.env` 里压根没有
 * `KERNEL_DEEP_RESEARCH_BASE_URL` 这一行，而直接 SSH 上去追加一行到那份文件属于
 * "绕过审查直接改生产配置"，这仓库这次会话里已经因为同类操作被 classifier 挡过
 * 一次（见 `configured-model-provider.ts` 相关 PR 讨论）。
 *
 * 默认值 `http://127.0.0.1:2024` 对**当前唯一的部署**是真实、正确的值（该容器就是
 * 这样起的，且只绑定 loopback，见部署文件头注）——不是瞎猜的占位符。failure mode
 * 也是安全的：服务不在那儿，`DeepResearchModelProvider` 会在真正尝试连接时拿到
 * `MODEL_CALL_FAILED`（连接被拒），不会静默假装成功。仍然可以用
 * `KERNEL_DEEP_RESEARCH_BASE_URL` 覆盖——多环境/未来把这个服务接进正式部署流水线时
 * 不需要再改代码。
 */
const DEFAULT_BASE_URL = "http://127.0.0.1:2024";

export function readDeepResearchProviderConfig(
  env: NodeJS.ProcessEnv = process.env,
): DeepResearchProviderConfig {
  const timeout = Number(env.KERNEL_DEEP_RESEARCH_TIMEOUT_MS ?? "600000");
  const pollInterval = Number(env.KERNEL_DEEP_RESEARCH_POLL_INTERVAL_MS ?? "5000");
  return {
    baseUrl: (env.KERNEL_DEEP_RESEARCH_BASE_URL ?? DEFAULT_BASE_URL).trim().replace(/\/+$/, ""),
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 600_000,
    pollIntervalMs: Number.isFinite(pollInterval) && pollInterval > 0 ? pollInterval : 5_000,
  };
}

interface ThreadMessage {
  readonly type?: string;
  readonly content?: unknown;
}

interface RunStatusResponse {
  readonly status?: string;
}

interface ThreadStateResponse {
  readonly values?: { readonly messages?: readonly ThreadMessage[] };
}

export class DeepResearchModelProvider implements ModelCallPort {
  constructor(private readonly config: DeepResearchProviderConfig) {}

  async complete(input: ModelCallInput): Promise<{ readonly text: string; readonly tokens?: number }> {
    const { baseUrl, timeoutMs, pollIntervalMs } = this.config;
    if (baseUrl === "") {
      throw new ModelCallError(
        "MODEL_PROVIDER_NOT_CONFIGURED",
        "KERNEL_DEEP_RESEARCH_BASE_URL is not set for this deployment",
      );
    }
    if (input.modelProvider !== DEEP_RESEARCH_PROVIDER_NAME) {
      // 同 `ConfiguredModelProvider` 那条纪律：不做 fallback，pin 了别的 provider 就是别的
      // provider 的事，`RoutingModelCallPort` 正常不会把请求路由到这里，这里只是双重防线。
      throw new ModelCallError(
        "MODEL_PROVIDER_NOT_CONFIGURED",
        `run pinned provider "${input.modelProvider}", this port only serves "${DEEP_RESEARCH_PROVIDER_NAME}"`,
      );
    }

    const deadline = Date.now() + timeoutMs;

    const threadId = await this.createThread(baseUrl);
    const runId = await this.createRun(baseUrl, threadId, input.user);

    while (true) {
      const status = await this.readRunStatus(baseUrl, threadId, runId);
      if (status === "success") break;
      if (status === "error" || status === "timeout" || status === "interrupted") {
        throw new ModelCallError("MODEL_CALL_FAILED", `deep research run ended with status "${status}"`);
      }
      if (Date.now() >= deadline) {
        throw new ModelCallError("MODEL_CALL_FAILED", `deep research run did not reach a terminal state within ${timeoutMs}ms`);
      }
      await sleep(pollIntervalMs);
    }

    const text = await this.readFinalReport(baseUrl, threadId);
    if (text.trim() === "") {
      // 空回复不是"成功但没内容"，是失败——同 `ConfiguredModelProvider` 的既有纪律
      // （"Empty content is a failure, not an empty reply"，见 execute-run.ts 头注）。
      throw new ModelCallError("MODEL_CALL_FAILED", "deep research run succeeded but produced no assistant message");
    }
    return { text };
  }

  private async createThread(baseUrl: string): Promise<string> {
    const response = await fetchWithTransportErrors(`${baseUrl}/threads`, { method: "POST", body: "{}" });
    const body = (await response.json()) as { thread_id?: string };
    if (!response.ok || !body.thread_id) {
      throw new ModelCallError("MODEL_CALL_FAILED", `deep research thread creation failed with HTTP ${response.status}`);
    }
    return body.thread_id;
  }

  private async createRun(baseUrl: string, threadId: string, userText: string): Promise<string> {
    const response = await fetchWithTransportErrors(`${baseUrl}/threads/${threadId}/runs`, {
      method: "POST",
      body: JSON.stringify({
        assistant_id: ASSISTANT_ID,
        input: { messages: [{ role: "user", content: userText }] },
      }),
    });
    const body = (await response.json()) as { run_id?: string };
    if (!response.ok || !body.run_id) {
      throw new ModelCallError("MODEL_CALL_FAILED", `deep research run submission failed with HTTP ${response.status}`);
    }
    return body.run_id;
  }

  private async readRunStatus(baseUrl: string, threadId: string, runId: string): Promise<string> {
    const response = await fetchWithTransportErrors(`${baseUrl}/threads/${threadId}/runs/${runId}`, { method: "GET" });
    if (!response.ok) {
      throw new ModelCallError("MODEL_CALL_FAILED", `deep research run status read failed with HTTP ${response.status}`);
    }
    const body = (await response.json()) as RunStatusResponse;
    return body.status ?? "unknown";
  }

  private async readFinalReport(baseUrl: string, threadId: string): Promise<string> {
    const response = await fetchWithTransportErrors(`${baseUrl}/threads/${threadId}/state`, { method: "GET" });
    if (!response.ok) {
      throw new ModelCallError("MODEL_CALL_FAILED", `deep research thread state read failed with HTTP ${response.status}`);
    }
    const body = (await response.json()) as ThreadStateResponse;
    const messages = body.values?.messages ?? [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message?.type === "ai" && typeof message.content === "string" && message.content.trim() !== "") {
        return message.content;
      }
    }
    return "";
  }
}

async function fetchWithTransportErrors(url: string, init: { method: string; body?: string }): Promise<Response> {
  try {
    return await fetch(url, { ...init, headers: { "content-type": "application/json" } });
  } catch {
    // 传输层错误的原始信息不上抛（同 `ConfiguredModelProvider` 的纪律：host/port 不进
    // 错误消息）——这里也不该出现内网服务的连接细节。
    throw new ModelCallError("MODEL_CALL_FAILED", "deep research service transport failure");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
