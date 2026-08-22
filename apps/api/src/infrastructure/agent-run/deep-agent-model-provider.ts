/**
 * `DeepAgentModelProvider` -- the `ModelCallPort` for the new deepagents-backed general
 * assistant (#740, replacing the TS tool loop this PR does NOT yet remove -- see #741 for
 * that step). Architecture decided in #738; the remote service itself is #739
 * (`apps/deep-agent-service`).
 *
 * ## Same shape as `DeepResearchModelProvider`, on purpose
 *
 * Both talk to a standalone LangGraph service via `langgraph dev`'s HTTP surface (create
 * thread → create run → poll status → read state) -- see that file's own header for why
 * this is a separate `ModelCallPort` implementation rather than a `ConfiguredModelProvider`
 * variant. This class is deliberately NOT a shared base class with
 * `DeepResearchModelProvider`: the two differ in exactly the two places that matter (what
 * goes into the run's `input`/`config`, and how the final answer is read back), and a
 * shared abstraction over "poll a LangGraph run to a terminal state" for two call sites
 * would be premature -- if a THIRD LangGraph-backed provider shows up, that is the moment
 * to extract one, not before.
 *
 * ## What makes this one different: `config.configurable.org_skills`
 *
 * `open_deep_research` has no notion of "this organization's Skills" -- it is one fixed
 * research graph, same for every org. This service's graph (`apps/deep-agent-service`) DOES
 * need per-run data: the run's pinned Skills, so its `call_skill` tool can execute one for
 * real (see that package's `tools.py` header for why the tool set itself is static and the
 * DATA is what varies per run). `ModelCallInput.skills` (#740, added alongside this file)
 * carries exactly that -- forwarded here verbatim into the run's `config`, LangGraph's own
 * mechanism for per-run data a graph's tools can read via `RunnableConfig`.
 *
 * ## `input.system` is still sent, and still contains full Skill bodies -- not a mistake
 *
 * `execute-run.ts` builds `system` via `buildSystemPrompt`/`buildOrchestratorSystemPrompt`
 * regardless of which provider ends up receiving it -- both already paste every pinned
 * Skill's full content into that string (`buildSystemPrompt`'s own doc comment). Sending it
 * here on top of `org_skills` looks redundant, but it is the SAME choice #725 made when it
 * added tool-calling on top of the pre-existing "paste the whole Skill body in" behaviour:
 * the model gets the content as context immediately AND a real way to invoke it for a
 * focused execution, rather than one replacing the other. `apps/deep-agent-service`'s own
 * `system_prompt` (baked into the graph at construction, see `graph.py`) additionally tells
 * the model to prefer calling a tool over answering from memorized Skill text.
 *
 * ## ⚠ Not verified end-to-end (#739's own limitation carries over here)
 *
 * This file's HTTP client logic IS covered by a real loopback-server test (see
 * `deep-agent-model-provider.test.ts`, same style as
 * `configured-model-provider-stream.test.ts`). What is NOT verified: whether
 * `apps/deep-agent-service`'s actual `langgraph dev` process accepts this exact request
 * shape and whether a `deepagents`-built graph honours an extra system message the way this
 * file assumes (#739 could not install `deepagents` in its sandbox -- Python 3.9 vs. the
 * package's `>=3.11` requirement). First real run against a live service is outstanding.
 *
 * ## #783 -- `completeWithProgress`: reading the SAME poll loop's state mid-flight
 *
 * #742's investigation (issue #742 comment thread) concluded the only way to know whether
 * `apps/deep-agent-service`'s intermediate state is observable is to look at a REAL run's
 * `GET /threads/:id/state` while it is still `running` -- #739's environment could never
 * install `deepagents` to produce one. #781 (LangGraph as the full chat orchestration
 * layer) made that observation possible: the human verified #739's service manually on the
 * VM with real `deepagents==0.7.5` and confirmed a run's `state` DOES already carry a
 * `messages` array shaped like standard LangChain messages, growing as the graph's `task`/
 * `call_skill` tool calls happen (an `AIMessage` with a non-empty `tool_calls` array,
 * followed by a `ToolMessage` carrying that call's `tool_call_id` and result content) --
 * this is the SAME `values.messages` shape `readFinalReply` already reads for the terminal
 * answer, just observed WHILE `running` instead of only once at `success`.
 *
 * `completeWithProgress` therefore does not add a second polling loop: it is `complete()`'s
 * OWN status-poll loop, with one extra read (`GET /threads/:id/state`) per iteration, same
 * discipline `agui-bridge.ts`'s "read deltas, then read status, same iteration" already
 * uses for `DeepResearchModelProvider`-adjacent streaming. `extractToolCallEvents` pairs
 * each `AIMessage.tool_calls[]` entry with the `ToolMessage` that answers it (matched by
 * `tool_call_id`) and reports the pair as ONE `ModelCallProgressEvent` only once both halves
 * are present -- a call announced but not yet answered is not reported early as a guess.
 */
import { createHash } from "node:crypto";

import type {
  ModelCallCompletion,
  ModelCallInput,
  ModelCallProgressEvent,
  PinnedSkillContent,
} from "../../application/agent-run/ports";
import { ModelCallError, type ModelCallPort } from "../../application/agent-run/ports";

export const DEEP_AGENT_PROVIDER_NAME = "deep-agent";
/** Must match `langgraph.json`'s `graphs` key in `apps/deep-agent-service` verbatim. */
const ASSISTANT_ID = "Deep Agent";

export interface DeepAgentProviderConfig {
  /**
   * DA-03（#1749，rubric D3）：`KERNEL_DEEP_AGENT_STREAM_ENABLED === "1"` 时，
   * `completeWithProgress` 优先走 LangGraph 的 `POST /threads/:id/runs/stream` SSE
   * 取 token 级增量；关闭或流路失败时回退到下方的状态轮询——回退路径与开关不存在时
   * **逐字相同**（S1=B 双轨纪律：新通路故障不得比旧世界更糟）。
   * 默认关。与 `KERNEL_MODEL_STREAM_ENABLED` 同一个灰度模式（configured-model-provider 先例）。
   */
  readonly streamEnabled?: boolean;
  /**
   * Only an internal address, same discipline as `DeepResearchProviderConfig.baseUrl` --
   * this service has no auth of its own. UNLIKE that sibling config, this has no "known
   * real deployment" default: #739's service has never been deployed anywhere yet (per the
   * human's own instruction, standing it up on the VM is a manual step for later, not part
   * of this PR). Defaulting to a guessed port would be a fabricated-looking value for a
   * deployment that does not exist -- empty string (see `complete()`'s guard below) is the
   * honest default until whoever deploys it sets `KERNEL_DEEP_AGENT_BASE_URL` for real.
   */
  readonly baseUrl: string;
  readonly pollIntervalMs: number;
  readonly timeoutMs: number;
}

export function readDeepAgentProviderConfig(
  env: NodeJS.ProcessEnv = process.env,
): DeepAgentProviderConfig {
  // A general-assistant turn should feel closer to interactive chat than deep research's
  // multi-minute report generation, but a deep agent run may still involve several
  // sequential `call_skill` tool calls (each a real, separate model call inside
  // apps/deep-agent-service) -- 5 minutes is a starting placeholder, not a measured figure
  // (no live deployment to measure against yet, see this config's own `baseUrl` comment).
  const timeout = Number(env.KERNEL_DEEP_AGENT_TIMEOUT_MS ?? "300000");
  const pollInterval = Number(env.KERNEL_DEEP_AGENT_POLL_INTERVAL_MS ?? "2000");
  return {
    baseUrl: (env.KERNEL_DEEP_AGENT_BASE_URL ?? "").trim().replace(/\/+$/, ""),
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 300_000,
    pollIntervalMs: Number.isFinite(pollInterval) && pollInterval > 0 ? pollInterval : 2_000,
    streamEnabled: env.KERNEL_DEEP_AGENT_STREAM_ENABLED === "1",
  };
}

/** One LangChain `tool_calls[]` entry on an `AIMessage` -- `args` is whatever JSON object
 * shape the model's tool call carried (`call_skill`'s `{skill_stable_name, task}`,
 * `list_org_skills`'s `{}`), read here as `unknown` and `JSON.stringify`d for the summary,
 * never parsed for meaning -- this file does not need to understand a tool's arguments,
 * only report them. */
interface WireToolCallRequest {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly args?: unknown;
}

interface ThreadMessage {
  readonly type?: string;
  readonly content?: unknown;
  /** Present on an `AIMessage` that asked to call one or more tools (#783). */
  readonly tool_calls?: readonly WireToolCallRequest[];
  /** Present on a `ToolMessage` -- pairs it back to the `AIMessage.tool_calls[]` entry it
   * answers (#783). */
  readonly tool_call_id?: unknown;
}

interface RunStatusResponse {
  readonly status?: string;
}

interface ThreadStateResponse {
  readonly values?: { readonly messages?: readonly ThreadMessage[] };
}

const PROGRESS_SUMMARY_MAX_CHARS = 500;

/** Same truncation discipline `execute-run.ts`'s retired TS tool loop used for
 * `AppendedRunStep.toolArgsSummary`/`toolResultSummary` (#725's `summarize`, see that
 * function's own doc comment before #741 removed it) -- these are for on-run VISIBILITY,
 * never a digest, so a long value is truncated rather than hashed or dropped. */
function summarizeProgressText(text: string, maxChars = PROGRESS_SUMMARY_MAX_CHARS): string {
  const trimmed = text.trim();
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars)}…` : trimmed;
}

/**
 * Walk `messages` (the FULL array, fresh every call -- see this file's own header on why
 * that is simpler and safe here) and pair every `AIMessage.tool_calls[]` entry with the
 * `ToolMessage` that answers it, by `tool_call_id`. Returns one `ModelCallProgressEvent`
 * per COMPLETE pair, in the order the answering `ToolMessage` appears -- a call announced
 * but not yet answered is not reported (see file head: "not reported early as a guess").
 *
 * `alreadyEmitted` is the caller's running set of `tool_call_id`s already turned into an
 * event on an earlier poll; this function neither reads nor mutates it beyond skipping
 * ids already in it -- the caller owns when an id is added, so a rejected `onProgress`
 * (see `ModelCallPort.completeWithProgress`'s own doc: "not best effort") does not leave
 * an id marked emitted for an event that never actually made it out.
 */
function extractToolCallEvents(
  messages: readonly ThreadMessage[],
  alreadyEmitted: ReadonlySet<string>,
): readonly { readonly id: string; readonly event: ModelCallProgressEvent }[] {
  const pending = new Map<string, { readonly name: string; readonly argsSummary: string | null; readonly planningNote: string | null }>();
  const found: { readonly id: string; readonly event: ModelCallProgressEvent }[] = [];

  for (const message of messages) {
    if (message.type === "ai" && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      const planningNote = typeof message.content === "string" && message.content.trim() !== ""
        ? summarizeProgressText(message.content)
        : null;
      for (const call of message.tool_calls) {
        const id = typeof call.id === "string" ? call.id : null;
        const name = typeof call.name === "string" ? call.name : null;
        if (id === null || name === null || alreadyEmitted.has(id)) continue;
        // DA-06（#1749，rubric D1）：write_todos 的参数是**结构化数据**，前端规划条
        // 要 JSON.parse 它渲染 todo 列表——500 字符截断会把它切成非法 JSON，规划条
        // 直接瞎掉。todos 由 TodoListMiddleware 生成、条目数有实际上限，4000 字符
        // 足够容纳而不至于失控（DB 列是 text，无长度约束）。其他工具保持 500 截断
        // 纪律不变——它们的 argsSummary 是给人读的摘要，不是给程序解析的数据。
        const maxChars = name === "write_todos" ? 4000 : undefined;
        const argsSummary = call.args === undefined
          ? null
          : summarizeProgressText(JSON.stringify(call.args), maxChars);
        pending.set(id, { name, argsSummary, planningNote });
      }
      continue;
    }
    if (message.type === "tool" && typeof message.tool_call_id === "string") {
      const id = message.tool_call_id;
      const call = pending.get(id);
      if (call === undefined || alreadyEmitted.has(id)) continue;
      const resultSummary = typeof message.content === "string" && message.content.trim() !== ""
        ? summarizeProgressText(message.content)
        : null;
      found.push({
        id,
        event: {
          toolName: call.name, toolArgsSummary: call.argsSummary,
          toolResultSummary: resultSummary, planningNote: call.planningNote,
        },
      });
      pending.delete(id);
    }
  }
  return found;
}

/**
 * #1747 —— 从线程状态里把**工具结果正文**收出来，作为脚本解析的候选来源。
 *
 * 为什么最终回复不够：deep-agent 的最后一条 `AIMessage` 是编排模型对工具结果的**转述**。
 * 子模型（`call_skill` 里那次独立调用）按 `scriptProtocol` 写出来的 ```run_script 块留在
 * 它答复的那条 `ToolMessage` 里，永远不会逐字出现在最终回复中。判据只看最终回复时，
 * 挂了 skill 的 deep-agent run 会一路 succeeded 却一个文件都产不出来——#1747 的实测形态。
 *
 * **倒序**返回：最后一次工具调用是真正在回答用户这一问的那次，先看它。
 *
 * 不按工具名过滤（不只挑 `call_skill`）是有意的：这一侧不需要理解某个工具的语义，
 * 判「这段文本里有没有可执行块」的唯一规则在 `run-script-with-retries.ts` 的那条正则，
 * 在这里再加一层按名字的过滤，等于把同一个判断分散到两处。`list_org_skills` 的输出是
 * 一行行技能名，本来就不含代码围栏，过不了那条正则。
 */
function collectScriptCandidates(messages: readonly ThreadMessage[]): readonly string[] {
  const candidates: string[] = [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.type === "tool" && typeof message.content === "string" && message.content.trim() !== "") {
      candidates.push(message.content);
    }
  }
  return candidates;
}

/** Wire shape for `config.configurable.org_skills` -- matches
 * `apps/deep-agent-service/src/deep_agent_service/tools.py`'s `OrgSkill` TypedDict field
 * names verbatim (snake_case, because that side reads it as plain JSON, not through this
 * type). Keep the two in sync by hand; there is no shared schema across the language
 * boundary yet -- a follow-up worth having once this path is verified end-to-end. */
interface WireOrgSkill {
  readonly stable_name: string;
  readonly name: string;
  readonly content: string;
}

function toWireSkills(skills: readonly PinnedSkillContent[] | undefined): readonly WireOrgSkill[] {
  return (skills ?? []).map((s) => ({ stable_name: s.stableName, name: s.name, content: s.content }));
}

export class DeepAgentModelProvider implements ModelCallPort {
  constructor(private readonly config: DeepAgentProviderConfig) {}

  async complete(input: ModelCallInput): Promise<ModelCallCompletion> {
    const { baseUrl, threadId, runId, deadline, pollIntervalMs, timeoutMs } = await this.startRun(input);
    await this.pollToTerminal(baseUrl, threadId, runId, deadline, pollIntervalMs, timeoutMs);
    return this.readCompletion(baseUrl, threadId);
  }

  /**
   * #783 -- same run, same poll loop as `complete()`, plus one extra state read per
   * iteration to report tool-call progress AS IT HAPPENS. See this file's own header for
   * why this is `complete()`'s loop with a read added, not a second implementation of it.
   */
  async completeWithProgress(
    input: ModelCallInput,
    onProgress: (event: ModelCallProgressEvent) => Promise<void>,
    onDelta?: (delta: string) => Promise<void>,
  ): Promise<ModelCallCompletion> {
    const { baseUrl, threadId, runId, deadline, pollIntervalMs, timeoutMs } = await this.startRun(input);
    const emitted = new Set<string>();

    if (this.config.streamEnabled === true && onDelta !== undefined) {
      // DA-03 流式通路。任何一步失败都落回下面的轮询循环——run 已经在服务端跑着，
      // 轮询继续等它到终态；已经通过 onDelta 交付过的片段不会重复（delta 是观察通道，
      // 终稿仍从 readFinalReply 读，两者由 agui-bridge/前端按既有约定拼接）。
      const streamed = await this.tryStreamRun(baseUrl, threadId, runId, onDelta, onProgress, emitted);
      if (streamed) {
        const status = await this.readRunStatus(baseUrl, threadId, runId);
        if (status === "success") {
          await this.emitNewToolEvents(baseUrl, threadId, onProgress, emitted);
          /* ⚠ 走 `readCompletion` 而不是只读终稿文本：#1747 起返回体要带
             `scriptCandidates`（`call_skill` 的工具结果里可能含脚本块）。
             这条**流式**分支若只返回 `{ text }`，脚本候选会被静默丢掉——
             症状是"挂了 skill 但没产出文件"，与 #1747 修的正是同一个形状。 */
          return await this.readCompletion(baseUrl, threadId);
        }
        if (status === "error" || status === "timeout" || status === "interrupted") {
          await this.emitNewToolEvents(baseUrl, threadId, onProgress, emitted);
          throw new ModelCallError("MODEL_CALL_FAILED", `deep agent run ended with status "${status}"`);
        }
        // 流断了但 run 还没终态：落回轮询等待，不重复提交。
      }
    }

    const emitNewEvents = async (): Promise<void> =>
      this.emitNewToolEvents(baseUrl, threadId, onProgress, emitted);

    while (true) {
      await emitNewEvents();
      const status = await this.readRunStatus(baseUrl, threadId, runId);
      if (status === "success") break;
      if (status === "error" || status === "timeout" || status === "interrupted") {
        // One last read: a call that completed in the same instant the run turned terminal
        // must not be lost because this loop stops polling the moment it sees the status.
        await emitNewEvents();
        throw new ModelCallError("MODEL_CALL_FAILED", `deep agent run ended with status "${status}"`);
      }
      if (Date.now() >= deadline) {
        await emitNewEvents();
        throw new ModelCallError("MODEL_CALL_FAILED", `deep agent run did not reach a terminal state within ${timeoutMs}ms`);
      }
      await sleep(pollIntervalMs);
    }
    // Same race this file's `#654 阶段2b` sibling (`agui-bridge.ts`) already documented and
    // fixed once for deltas: the terminal status can be observed before the LAST tool-call
    // pair's `ToolMessage` is reflected in the same poll's state read. One more read here
    // closes it the identical way -- it never introduces a new race, only catches up.
    await emitNewEvents();

    return this.readCompletion(baseUrl, threadId);
  }

  /**
   * 终态之后**读一次** state，同时得到最终回复与 #1747 的候选脚本来源。
   *
   * 一次读而不是两次：两次分别读会拿到两个可能不同的快照，于是「回复」与「产生它的
   * 工具结果」可能来自不同时刻——那正是本仓一再栽的「同一事实取自两处」。
   */
  private async readCompletion(baseUrl: string, threadId: string): Promise<ModelCallCompletion> {
    const state = await this.readState(baseUrl, threadId);
    const messages = state.values?.messages ?? [];
    const text = readFinalReply(messages);
    if (text.trim() === "") {
      throw new ModelCallError("MODEL_CALL_FAILED", "deep agent run succeeded but produced no assistant message");
    }
    return { text, scriptCandidates: collectScriptCandidates(messages) };
  }

  /** `completeWithProgress` 的 tool 事件提取（原内联闭包提为方法，流式与轮询两条通路共用）。
   * emitted 只在 `onProgress` resolve 后标记——拒绝不得静默丢事件（"not best effort"）。 */
  private async emitNewToolEvents(
    baseUrl: string,
    threadId: string,
    onProgress: (event: ModelCallProgressEvent) => Promise<void>,
    emitted: Set<string>,
  ): Promise<void> {
    const state = await this.readState(baseUrl, threadId);
    const messages = state.values?.messages ?? [];
    for (const { id, event } of extractToolCallEvents(messages, emitted)) {
      await onProgress(event);
      emitted.add(id);
    }
  }

  /**
   * DA-03：`POST /threads/:id/runs/stream?` 的 SSE 消费。返回 true = 流打开过且正常读完
   * （不保证 run 成功——终态判定归调用方）；false = 流根本没打开（HTTP 非 2xx / 传输错），
   * 调用方落回轮询。
   *
   * 解析刻意只认两种形状、其余静默跳过（fail-open 到轮询而不是猜）：
   *   · `event: messages` 且 data 为 `[chunk, metadata]`、chunk.content 是非空字符串、
   *     chunk 无 tool_call_id → 当作 AIMessageChunk 的 token 片段 → onDelta
   *   · chunk 带 `tool_call_id` → 有 ToolMessage 落地 → 事件驱动地读一次 state 提取
   *     tool 事件对（比旧的定时轮询更及时，语义与其同源：仍从 state 提取、仍按 emitted 去重）
   *
   * ⚠ 事件形状按 LangGraph Platform 文档 + loopback 测试锚定；对真实 `langgraph dev`
   * 的首次实跑验证 outstanding——与 #739/#783 同一个已声明的验证边界。形状不匹配的
   * 后果被设计成「退化为无 delta 的轮询语义」，不会丢终稿、不会伪造流式。
   */
  private async tryStreamRun(
    baseUrl: string,
    threadId: string,
    runId: string,
    onDelta: (delta: string) => Promise<void>,
    onProgress: (event: ModelCallProgressEvent) => Promise<void>,
    emitted: Set<string>,
  ): Promise<boolean> {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/threads/${threadId}/runs/${runId}/stream`, {
        method: "GET",
        headers: { accept: "text/event-stream" },
      });
    } catch {
      return false;
    }
    if (!response.ok || response.body === null) return false;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) >= 0) {
          const rawEvent = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const dataLines = rawEvent
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trim());
          if (dataLines.length === 0) continue;
          let parsed: unknown;
          try {
            parsed = JSON.parse(dataLines.join(""));
          } catch {
            continue;
          }
          if (!Array.isArray(parsed) || parsed.length === 0) continue;
          const chunk = parsed[0] as { content?: unknown; tool_call_id?: unknown };
          if (typeof chunk.tool_call_id === "string" && chunk.tool_call_id !== "") {
            await this.emitNewToolEvents(baseUrl, threadId, onProgress, emitted);
            continue;
          }
          if (typeof chunk.content === "string" && chunk.content !== "") {
            await onDelta(chunk.content);
          }
        }
      }
      return true;
    } catch {
      // 流中途断：run 还在服务端跑，调用方落回轮询——已交付的 delta 不回滚也不重发。
      return true;
    } finally {
      reader.releaseLock();
    }
  }

  /** Shared by `complete()` and `completeWithProgress()`: validate config/provider, create
   * the thread and run, and hand back everything the poll loop needs. */
  private async startRun(input: ModelCallInput): Promise<{
    readonly baseUrl: string; readonly threadId: string; readonly runId: string;
    readonly deadline: number; readonly pollIntervalMs: number; readonly timeoutMs: number;
  }> {
    const { baseUrl, timeoutMs, pollIntervalMs } = this.config;
    if (baseUrl === "") {
      throw new ModelCallError(
        "MODEL_PROVIDER_NOT_CONFIGURED",
        "KERNEL_DEEP_AGENT_BASE_URL is not set for this deployment",
      );
    }
    if (input.modelProvider !== DEEP_AGENT_PROVIDER_NAME) {
      // Same double-checked discipline `DeepResearchModelProvider.complete` and
      // `ConfiguredModelProvider.complete` both already enforce: no fallback, ever.
      throw new ModelCallError(
        "MODEL_PROVIDER_NOT_CONFIGURED",
        `run pinned provider "${input.modelProvider}", this port only serves "${DEEP_AGENT_PROVIDER_NAME}"`,
      );
    }
    const deadline = Date.now() + timeoutMs;
    const threadId = input.threadId === undefined || input.threadId === ""
      ? await this.createThread(baseUrl)
      : await this.ensureThread(baseUrl, input.threadId);
    const runId = await this.createRun(baseUrl, threadId, input);
    return { baseUrl, threadId, runId, deadline, pollIntervalMs, timeoutMs };
  }

  /**
   * DA-04（#1749，rubric D4）：同一个 Chat thread 的每一轮都落进**同一个**远端
   * LangGraph thread——checkpointer 里的跨轮上下文（DA-02 接的 PostgresSaver）
   * 只有在 thread 稳定时才真正生效；此前每轮 createThread，持久化形同虚设。
   *
   * 做法：Chat threadId → 决定性派生一个 UUID 形状的远端 id（sha256 截断，
   * 版本/变体位按 RFC 4122 摆好——不是标准 uuid5，但决定性、无碰撞顾虑、格式合法，
   * 且**不需要一张映射表**：同输入永远同输出，映射关系本身就是纯函数，
   * 存表反而制造第二份事实）。然后 `POST /threads` 带 `if_exists: "do_nothing"`
   * 幂等创建——LangGraph Platform 的原生语义，首轮创建、后续复用，无竞态窗口。
   *
   * ⚠ 验证边界（同 DA-03 先例）：`if_exists` 语义按 Platform 文档 + loopback 测试
   * 锚定，真实 langgraph dev 实跑 outstanding。失败模式 fail-closed：HTTP 非 2xx
   * 即抛 MODEL_CALL_FAILED，不静默退回「每轮新 thread」——那会把「续聊坏了」
   * 伪装成「记性差」。
   */
  private async ensureThread(baseUrl: string, chatThreadId: string): Promise<string> {
    const remoteThreadId = deriveRemoteThreadId(chatThreadId);
    const response = await fetchWithTransportErrors(`${baseUrl}/threads`, {
      method: "POST",
      body: JSON.stringify({ thread_id: remoteThreadId, if_exists: "do_nothing" }),
    });
    if (!response.ok) {
      throw new ModelCallError("MODEL_CALL_FAILED", `deep agent thread ensure failed with HTTP ${response.status}`);
    }
    // 服务器是 thread id 的权威：真平台会回显请求的 id（幂等创建），此时连续性成立；
    // 一个不支持调用方指定 id 的上游（或测试假上游）会回自己分配的 id——那就用它的，
    // 这一轮照常工作，只是没有跨轮连续性。**不能**无视响应体硬用派生 id：上游没接受
    // 那个 id 时，后续所有按派生 id 的读写都会 404，把「上游不支持」放大成「run 全挂」。
    const body = (await response.json().catch(() => ({}))) as { thread_id?: string };
    return typeof body.thread_id === "string" && body.thread_id !== "" ? body.thread_id : remoteThreadId;
  }

  /** `complete()`'s own poll-to-terminal loop, extracted so `completeWithProgress` can
   * reuse the exact same termination logic without a second copy of it. */
  private async pollToTerminal(
    baseUrl: string, threadId: string, runId: string, deadline: number, pollIntervalMs: number, timeoutMs: number,
  ): Promise<void> {
    while (true) {
      const status = await this.readRunStatus(baseUrl, threadId, runId);
      if (status === "success") return;
      if (status === "error" || status === "timeout" || status === "interrupted") {
        throw new ModelCallError("MODEL_CALL_FAILED", `deep agent run ended with status "${status}"`);
      }
      if (Date.now() >= deadline) {
        throw new ModelCallError("MODEL_CALL_FAILED", `deep agent run did not reach a terminal state within ${timeoutMs}ms`);
      }
      await sleep(pollIntervalMs);
    }
  }

  private async createThread(baseUrl: string): Promise<string> {
    const response = await fetchWithTransportErrors(`${baseUrl}/threads`, { method: "POST", body: "{}" });
    const body = (await response.json()) as { thread_id?: string };
    if (!response.ok || !body.thread_id) {
      throw new ModelCallError("MODEL_CALL_FAILED", `deep agent thread creation failed with HTTP ${response.status}`);
    }
    return body.thread_id;
  }

  private async createRun(baseUrl: string, threadId: string, input: ModelCallInput): Promise<string> {
    const messages: { role: string; content: string }[] = [];
    if (input.system.trim() !== "") messages.push({ role: "system", content: input.system });
    for (const turn of input.history ?? []) messages.push({ role: turn.role, content: turn.content });
    messages.push({ role: "user", content: input.user });

    const response = await fetchWithTransportErrors(`${baseUrl}/threads/${threadId}/runs`, {
      method: "POST",
      body: JSON.stringify({
        assistant_id: ASSISTANT_ID,
        input: { messages },
        config: {
          configurable: {
            org_skills: toWireSkills(input.skills),
            /*
             * #1747 —— 脚本执行协议原样转发给远端。
             *
             * 远端的 `call_skill` 发起的是一次**独立的**子模型调用，system prompt 是
             * skill 正文，收不到上面那条 system 消息。协议只能作为 per-run 配置过去，
             * 和 `org_skills` 一样走 LangGraph 自己的 `configurable` 通道。
             *
             * ⚠ 缺席时这个键**不出现**——远端读不到就完全按改动前的方式跑（T2）。
             *   协议正文的唯一事实源在 `run-script-with-retries.ts`，Python 侧不写副本。
             */
            ...(input.scriptProtocol === undefined ? {} : { script_protocol: input.scriptProtocol }),
          },
        },
      }),
    });
    const body = (await response.json()) as { run_id?: string };
    if (!response.ok || !body.run_id) {
      throw new ModelCallError("MODEL_CALL_FAILED", `deep agent run submission failed with HTTP ${response.status}`);
    }
    return body.run_id;
  }

  private async readRunStatus(baseUrl: string, threadId: string, runId: string): Promise<string> {
    const response = await fetchWithTransportErrors(`${baseUrl}/threads/${threadId}/runs/${runId}`, { method: "GET" });
    if (!response.ok) {
      throw new ModelCallError("MODEL_CALL_FAILED", `deep agent run status read failed with HTTP ${response.status}`);
    }
    const body = (await response.json()) as RunStatusResponse;
    return body.status ?? "unknown";
  }

  /** #783: extracted so `completeWithProgress`'s `emitNewEvents` can read the SAME endpoint
   * mid-run instead of `readFinalReply` being the only caller. */
  private async readState(baseUrl: string, threadId: string): Promise<ThreadStateResponse> {
    const response = await fetchWithTransportErrors(`${baseUrl}/threads/${threadId}/state`, { method: "GET" });
    if (!response.ok) {
      throw new ModelCallError("MODEL_CALL_FAILED", `deep agent thread state read failed with HTTP ${response.status}`);
    }
    return (await response.json()) as ThreadStateResponse;
  }

}

/** 最后一条非空 `AIMessage` 的正文。#1747 把它从方法改成纯函数：`readCompletion` 要在
 * **同一份** state 快照上同时取回复与候选来源，再读一次 HTTP 就是取自两个时刻。 */
function readFinalReply(messages: readonly ThreadMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.type === "ai" && typeof message.content === "string" && message.content.trim() !== "") {
      return message.content;
    }
  }
  return "";
}

/** Chat threadId → 远端 thread id 的决定性派生。见 `ensureThread` 的注释。 */
export function deriveRemoteThreadId(chatThreadId: string): string {
  const hex = createHash("sha256").update(`workspacex:deep-agent:${chatThreadId}`).digest("hex");
  // RFC 4122 形状：版本位固定 4、变体位固定 8——格式合法即可，唯一性来自 sha256。
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function fetchWithTransportErrors(url: string, init: { method: string; body?: string }): Promise<Response> {
  try {
    return await fetch(url, { ...init, headers: { "content-type": "application/json" } });
  } catch {
    // Same redaction discipline as `DeepResearchModelProvider`'s identical helper: no host/
    // port detail leaves this process.
    throw new ModelCallError("MODEL_CALL_FAILED", "deep agent service transport failure");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
