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
 * `tool_call_id`).
 *
 * ## #742 Gap 1（CopilotKit 对标）—— `in_progress` 不再是"猜"，是真事件
 *
 * 这条头注曾经写着"a call announced but not yet answered is not reported early as a
 * guess"——那是在 `AgentRunStepStatus` 只有两个终态值的年代做的取舍：没有第三种状态可以
 * 承载"已宣布、还没结果"，提前报告就只能落成一个撒谎的 `succeeded`。CopilotKit 的 Tool
 * Call Rendering / State Rendering 模式要求至少 `inProgress`/`complete` 两态迁移
 * （#742 Gap 1），账本加了 `in_progress` 状态之后，"announced but not answered" 不再是一个
 * 要猜的结论，是一个可以如实记录的真实阶段——`extractToolCallEvents` 现在为每个
 * `tool_calls[]` 条目在被宣布的那一刻就报一次 `phase: "in_progress"`，结果到达时再报一次
 * `phase: "complete"`，两次事件共享同一个 `toolCallId`。`agent_run_steps` 是 append-only
 * 账本（DB 级强制，见 `AppendedRunStep.toolCallId` 的头注），这两次事件因此落成两行，
 * 由读端按 `toolCallId` 折叠回一张卡片，不是同一行被原地改写。
 */
import { createHash } from "node:crypto";
import { DEEP_AGENT_HITL_TOOL_NAME, DEEP_AGENT_HITL_ARGS_MAX_CHARS } from "@repo/contracts/deep-agent-hitl";
import {
  AGENT_INTERRUPTS_TOOL_NAME_LIST,
  AGENT_INTERRUPTS_ARGS_MAX_CHARS,
} from "@repo/contracts/agent-interrupts";
import { AguiTodosSnapshot } from "@repo/contracts/agui-state-events";
import type { kernelGateway as KG } from "@repo/contracts";
import { KERNEL_INTERJECTION_CONFIGURABLE_KEY } from "@repo/contracts/artifacts-steering";
import { KERNEL_HITL_SKILLS_CONFIGURABLE_KEY } from "@repo/contracts/plan-permissions";

import type {
  ModelCallCompletion,
  ModelCallInput,
  ModelCallProgressEvent,
  PinnedSkillContent,
} from "../../application/agent-run/ports";
import {
  DEEP_AGENT_PROVIDER_NAME,
  ModelCallError,
  type ModelCallPort,
} from "../../application/agent-run/ports";

/**
 * Re-exported, not declared here anymore -- design-delta `skill-lazy-loading` moved the
 * one declaration to `application/agent-run/ports.ts` so `execute-run.ts` (an
 * `application`-layer file, may not import `infrastructure`) can reach it too. See that
 * constant's own doc comment for the full reasoning. Existing importers of this module
 * keep working unchanged.
 */
export { DEEP_AGENT_PROVIDER_NAME };
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
  /**
   * issue #2664 -- 这个 API 进程自身、从 `apps/deep-agent-service` 容器可达的地址。
   * `spawn_async_task` 工具用它拼出 `POST <subtaskCallbackBaseUrl>/internal/subtask-runs`
   * 把子任务信息写回来。空字符串（默认，同 `baseUrl` 自己的"没有已知真实部署"纪律）
   * ⇒ `configurable.subtask_callback_base_url` 这个键根本不出现，Python 侧
   * `spawn_async_task` 按其自身文档降级为"收到但无法派发"的诚实结果，不静默假装成功。
   */
  readonly subtaskCallbackBaseUrl?: string;
  /**
   * 与 `subtask-run.controller.ts` 读取的**同一个**环境变量值（`x-deep-agent-internal-key`
   * 请求头）——单一事实源是 `DEEP_AGENT_SERVICE_INTERNAL_KEY` 这个环境变量本身，两侧
   * 各自读一次，不在代码里互相复制字面量。空字符串 ⇒ 同上，键不出现。
   *
   * ⚠ 两个字段都是**可选**（不是 `readDeepAgentProviderConfig` 返回值里其余字段的形状）：
   * 这个接口在本次改动之前已经被多个既有测试直接手写字面量构造过
   * （`deep-agent-stream.test.ts` 等），补两个必填字段会让那些测试的字面量突然不完整而
   * 编译失败——它们与 issue #2664 无关，不该被这次改动波及。缺省按空字符串处理
   * （`this.config.subtaskCallbackBaseUrl ?? ""`），与"没配置"的行为逐字相同。
   */
  readonly subtaskCallbackKey?: string;
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
    subtaskCallbackBaseUrl: (env.KERNEL_SUBTASK_CALLBACK_BASE_URL ?? "").trim().replace(/\/+$/, ""),
    subtaskCallbackKey: (env.DEEP_AGENT_SERVICE_INTERNAL_KEY ?? "").trim(),
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

/** One entry of the deepagents `TodoListMiddleware`'s `state.todos` -- real shape confirmed
 * against a live run's `GET /threads/:id/state` capture (`.harness/state/deepagent-eval/
 * 2026-08-23-3d327c13/sse-and-thread-state-evidence-v2/02-thread-state.json`, `.values.todos`).
 * Read as `unknown` here, same discipline `ThreadMessage`'s own fields use -- validated for
 * real by `AguiTodosSnapshot` (imported above) before anything downstream trusts it. */
interface ThreadStateTodo {
  readonly content?: unknown;
  readonly status?: unknown;
}

/** One value of the deepagents `FilesystemMiddleware`'s `state.files` dict (keyed by an
 * in-sandbox path, e.g. `/large_tool_results/<call_id>`) -- shape is `deepagents==0.7.6`'s
 * own `FileData` (`deepagents/backends/protocol.py`, verified by extracting the published
 * wheel: `content`/`encoding` required, `created_at`/`modified_at` optional). NOT the same
 * namespace as this deployment's own VFS (`apps/api/src/domain/vfs/vfs-uri.ts`'s
 * `vfs://<attachment|artifact>/<id>`) -- see that file's own header and this provider's
 * DA-16 investigation notes for why the two are not interchangeable. Declared here for
 * type-level correctness of what `readState` actually reads back; not yet consumed by any
 * producer (no downstream feature depends on this shape yet -- see PR body). */
interface ThreadStateFileData {
  readonly content?: unknown;
  readonly encoding?: unknown;
  readonly created_at?: unknown;
  readonly modified_at?: unknown;
}

interface ThreadStateResponse {
  readonly values?: {
    readonly messages?: readonly ThreadMessage[];
    readonly todos?: readonly ThreadStateTodo[];
    readonly files?: { readonly [path: string]: ThreadStateFileData };
  };
}

/**
 * DA-16 -- the write_todos tool-call event's `toolArgsSummary` used to be a re-serialization
 * of the model's own `tool_calls[].args` (what the model ASKED to set). This reads the
 * REAL post-write state instead (`state.values.todos`, populated by deepagents'
 * `TodoListMiddleware` from that same call) -- ground truth, not a reconstruction of the
 * request that produced it. In the happy path the two are byte-for-byte the same JSON
 * (`TodoListMiddleware` applies the call's args verbatim), so this is not a behaviour
 * change for `parseWriteTodosSnapshot`'s consumers; it stops being true only if something
 * OTHER than the write_todos call itself could still be reflected in args but not state
 * (there is no such path in deepagents 0.7.6), or if the args were truncated/malformed
 * before reaching state (the real state read is immune to that by construction).
 *
 * Returns `null` -- not a guess, not the args fallback -- when `values.todos` is absent or
 * fails `AguiTodosSnapshot` validation (same "parse failure ⇒ no event" discipline
 * `parseWriteTodosSnapshot` itself documents). Caller decides whether to keep the
 * args-derived summary in that case (see `emitNewToolEvents`).
 */
function realTodosSummary(todos: readonly ThreadStateTodo[] | undefined): string | null {
  if (todos === undefined) return null;
  const result = AguiTodosSnapshot.safeParse({ todos });
  return result.success ? JSON.stringify(result.data) : null;
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
 * #742 Gap 1 -- two running sets, one per phase, so a call gets reported exactly once
 * per phase it actually passes through: `inProgress` = ids that already got an
 * `in_progress` event, `complete` = ids that already got their terminal event. Kept
 * separate (not one "seen" set) because a call legitimately fires BOTH events over its
 * lifetime -- collapsing them would either re-announce a completed call as in-progress or,
 * worse, skip the terminal event because the id "was already emitted".
 */
export interface ToolCallEmittedIds {
  readonly inProgress: Set<string>;
  readonly complete: Set<string>;
}

/**
 * Walk `messages` (the FULL array, fresh every call -- see this file's own header on why
 * that is simpler and safe here) and report:
 *  - an `in_progress` `ModelCallProgressEvent` the FIRST time an `AIMessage.tool_calls[]`
 *    entry is seen that has not already gotten one (#742 Gap 1 -- previously a call
 *    announced but not yet answered was not reported at all: "not reported early as a
 *    guess". It now IS reported, exactly once, as `in_progress`, precisely because a
 *    client watching a run in progress is the whole point of that phase existing.)
 *  - a `"complete"` `ModelCallProgressEvent` once both the `AIMessage.tool_calls[]` entry
 *    AND the `ToolMessage` that answers it (paired by `tool_call_id`) are present, same as
 *    before this feature.
 *
 * Both event kinds carry `toolCallId` so `execute-run.ts` can correlate the pair into one
 * ledger group without them ever needing to be the SAME database row (`agent_run_steps` is
 * append-only -- see `AppendedRunStep.toolCallId`'s own doc).
 *
 * `emittedIds` is the caller's running record of what has already gone out on earlier
 * polls; this function neither reads nor mutates it beyond skipping ids already in the
 * relevant set -- the caller owns when an id is added, so a rejected `onProgress` (see
 * `ModelCallPort.completeWithProgress`'s own doc: "not best effort") does not leave an id
 * marked emitted for an event that never actually made it out.
 */
function extractToolCallEvents(
  messages: readonly ThreadMessage[],
  emittedIds: ToolCallEmittedIds,
): readonly { readonly id: string; readonly phase: "in_progress" | "complete"; readonly event: ModelCallProgressEvent }[] {
  const pending = new Map<string, {
    readonly name: string; readonly argsSummary: string | null; readonly planningNote: string | null;
    /** Phase 14 F03 -- the real, untruncated args object, carried through to the "complete"
     * event so `ToolCallStartEvent.args`/the WS bus can have full fidelity (`ports.ts`'s own
     * doc on `ModelCallProgressEvent.toolArgsFull`). */
    readonly argsFull: unknown;
  }>();
  const found: { readonly id: string; readonly phase: "in_progress" | "complete"; readonly event: ModelCallProgressEvent }[] = [];

  for (const message of messages) {
    if (message.type === "ai" && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      const planningNote = typeof message.content === "string" && message.content.trim() !== ""
        ? summarizeProgressText(message.content)
        : null;
      for (const call of message.tool_calls) {
        const id = typeof call.id === "string" ? call.id : null;
        const name = typeof call.name === "string" ? call.name : null;
        if (id === null || name === null) continue;
        // DA-06（#1749，rubric D1）：write_todos 的参数是**结构化数据**，前端规划条
        // 要 JSON.parse 它渲染 todo 列表——500 字符截断会把它切成非法 JSON，规划条
        // 直接瞎掉。todos 由 TodoListMiddleware 生成、条目数有实际上限，4000 字符
        // 足够容纳而不至于失控（DB 列是 text，无长度约束）。其他工具保持 500 截断
        // 纪律不变——它们的 argsSummary 是给人读的摘要，不是给程序解析的数据。
        // issue #2017：待批工具（HITL）的 args 与 write_todos 同理——**要被前端
        // `JSON.parse`**，不是给人读的摘要。审批卡要显示真实参数、edit 决策要把参数
        // 改了再提交，两件事都要求这个 delta 是合法 JSON；而 500 字符截断会在尾部接一个
        // `…` 把它切成非法 JSON。`call_skill` 的 `task` 是自由文本、天然会超 500 字符
        // （其 docstring 明确要求"写清全部上下文"），所以短任务 e2e 会绿、真实长任务会坏。
        // 上限取自契约，与工具名同一个事实源。
        // F212（agent-interrupts 契约内核）：三个新 HITL 虚拟工具（confirm_task_intent/
        // fill_run_params/choose_execution_option）与 call_skill 同一个坑——
        // fill_params 多字段+依据文案、choose_option 2-3 张选项卡三项对照，都大概率
        // 超过 500 字符默认截断。豁免清单是封闭清单，不能整类放行，逐一加名字
        // （`domain.md` 缺口 AI-3，`agent-interrupts.ts` 文件头同一纪律）。
        const maxChars =
          name === "write_todos" ||
          name === DEEP_AGENT_HITL_TOOL_NAME ||
          AGENT_INTERRUPTS_TOOL_NAME_LIST.includes(name)
            ? Math.max(4000, DEEP_AGENT_HITL_ARGS_MAX_CHARS, AGENT_INTERRUPTS_ARGS_MAX_CHARS)
            : undefined;
        const argsSummary = call.args === undefined
          ? null
          : summarizeProgressText(JSON.stringify(call.args), maxChars);
        pending.set(id, { name, argsSummary, planningNote, argsFull: call.args });
        // #742 Gap 1: report "announced, not yet answered" exactly once per id.
        if (!emittedIds.inProgress.has(id)) {
          found.push({
            id,
            phase: "in_progress",
            event: {
              toolName: name, toolArgsSummary: argsSummary, toolResultSummary: null,
              planningNote, phase: "in_progress", toolCallId: id, toolArgsFull: call.args,
            },
          });
        }
      }
      continue;
    }
    if (message.type === "tool" && typeof message.tool_call_id === "string") {
      const id = message.tool_call_id;
      const call = pending.get(id);
      if (call === undefined || emittedIds.complete.has(id)) continue;
      const resultSummary = typeof message.content === "string" && message.content.trim() !== ""
        ? summarizeProgressText(message.content)
        : null;
      found.push({
        id,
        phase: "complete",
        event: {
          toolName: call.name, toolArgsSummary: call.argsSummary,
          toolResultSummary: resultSummary, planningNote: call.planningNote,
          phase: "complete", toolCallId: id,
          toolArgsFull: call.argsFull, toolResultFull: message.content,
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
   * Phase 14 F01 (`kernel-gateway` 契约束 UC-3，R4 A1 / I-3) -- 下发前健康检查,
   * `execute-run.ts` 在真正转发 run 之前调用。不配置地址（同 `startRun` 的既有判据）
   * 是 "unavailable"；探测本身不失败,只报告状态（`kernel-gateway.ts` 的 `err: 无`）。
   *
   * ⚠ 判据是**连得上**，不是**这条路径答"healthy"**：R4 A1 描述的故障是
   * 「服务未启动/网络故障」——传输层的不可达（连接被拒绝/超时/DNS 失败），不是
   * 「这个具体路径没有实现」。一个真正在运行、只是没长出 `/healthz` 这条路由的进程
   * （本仓大量测试用极简 `http.createServer` 直接内联替身 deep-agent-service,只认
   * `/threads` 系列几条路径，其它一律 404——不是每个测试作者都知道要补一条健康检查
   * 路由）仍然是"这个内核活着"，用 HTTP 状态码去判定会把"没实现这条路由"误判成
   * "服务不可用"，让一个原本会成功的 run 在下发前就被挡下。`fetch` 本身抛出
   * （连接被拒绝/DNS 失败/超时）才是唯一的 "unavailable" 判据；拿到任何 HTTP
   * 响应（即使是 404）都说明传输层是通的，报 "healthy"。
   *
   * `/healthz` 路径仍然按本仓约定探测（`health.controller.ts`、
   * `loopback-deep-agent-provider.ts`/`loopback-model-provider.ts` 都实现它）——真实
   * `apps/deep-agent-service` 部署预期也会长出这条路由，只是**探测判据不依赖它答
   * 2xx**，这样即使真部署这条路由暂时挂了（而进程本身没死），也不会被这道门误伤。
   */
  async checkKernelHealth(): Promise<KG.KernelHealthStatus> {
    if (this.config.baseUrl === "") return "unavailable";
    try {
      await fetch(`${this.config.baseUrl}/healthz`, { method: "GET" });
      return "healthy";
    } catch {
      return "unavailable";
    }
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
    // #742 Gap 1: two sets, not one -- see `ToolCallEmittedIds`'s own doc for why a call
    // legitimately needs to pass through both phases without either suppressing the other.
    const emitted: ToolCallEmittedIds = { inProgress: new Set<string>(), complete: new Set<string>() };

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
        if (status === "interrupted") {
          // DA-07b：停在 interrupt_on 等人裁决——不是失败。读 state 找出待批的调用。
          await this.emitNewToolEvents(baseUrl, threadId, onProgress, emitted);
          return { text: "", interrupted: await this.readPendingApproval(baseUrl, threadId) };
        }
        if (status === "error" || status === "timeout") {
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
      if (status === "interrupted") {
        // DA-07b：等人裁决，不是失败。
        await emitNewEvents();
        return { text: "", interrupted: await this.readPendingApproval(baseUrl, threadId) };
      }
      if (status === "error" || status === "timeout") {
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
    emitted: ToolCallEmittedIds,
  ): Promise<void> {
    const state = await this.readState(baseUrl, threadId);
    const messages = state.values?.messages ?? [];
    // DA-16: ground-truth override -- see `realTodosSummary`'s own doc. `undefined` (real
    // state validation failed or todos absent) leaves the completed write_todos event's
    // args-derived `toolArgsSummary` exactly as `extractToolCallEvents` built it -- this is
    // additive, never a new way for the event to go missing.
    const realTodos = realTodosSummary(state.values?.todos);
    for (const { id, phase, event } of extractToolCallEvents(messages, emitted)) {
      const withRealTodos = phase === "complete" && event.toolName === "write_todos" && realTodos !== null
        ? { ...event, toolArgsSummary: realTodos }
        : event;
      await onProgress(withRealTodos);
      (phase === "in_progress" ? emitted.inProgress : emitted.complete).add(id);
    }
  }

  /**
   * DA-03：`POST /threads/:id/runs/stream?` 的 SSE 消费。返回 true = 流打开过且正常读完
   * （不保证 run 成功——终态判定归调用方）；false = 流根本没打开（HTTP 非 2xx / 传输错），
   * 调用方落回轮询。
   *
   * 解析刻意只认三种形状、其余静默跳过（fail-open 到轮询而不是猜）：
   *   · `event: messages` 且 data 为 `[chunk, metadata]`、chunk.content 是非空字符串、
   *     chunk 无 tool_call_id → 当作 AIMessageChunk 的 token 片段 → onDelta
   *   · 同一形状但 chunk 带 `tool_call_id` → 有 ToolMessage 落地 → 事件驱动地读一次
   *     state 提取 tool 事件对（语义与旧的定时轮询同源：仍从 state 提取、仍按 emitted
   *     去重）—— ⚠ 2026-08-23 人类第二轮引擎重评实测（D2）证实这条分支在真实 run 里
   *     几乎从不命中：90 条 messages-tuple chunk 里 0 条带 `tool_call_id`，工具调用
   *     实际只靠下面轮询循环的 `pollIntervalMs` 兜底读一次 state，不是逐次事件驱动。
   *   · `event: updates` 的 data 是 `{node_name: patch}` 形状的对象（不是数组）——同一份
   *     实测证据显示 engine 真的会在这个 stream_mode 下把 `tools` 节点的 patch 独立
   *     发出来（`{"tools":{"messages":[ToolMessage...],"todos":[...]}}`），一次 patch
   *     对应一次工具调用真正落地。见到 "tools" 键就立刻触发一次 state 读——这是上面
   *     那条"事实上失效"的分支之外，真正能让工具调用事件实时驱动记账（而不是等轮询
   *     周期）的信号。复用同一个 `emitNewToolEvents`/`extractToolCallEvents` 配对逻辑，
   *     不新建第二套解析或记账路径。
   *
   * ⚠ 事件形状按 LangGraph Platform 文档 + loopback 测试 + 2026-08-23 对真实
   * `apps/deep-agent-service` 的实测 SSE 采集（`.harness/state/deepagent-eval/
   * 2026-08-23-3d327c13/sse-and-thread-state-evidence-v2/01-sse-stream.txt`）锚定。
   * 形状不匹配的后果被设计成「退化为无 delta/无提前信号的轮询语义」，不会丢终稿、
   * 不会伪造流式。
   */
  private async tryStreamRun(
    baseUrl: string,
    threadId: string,
    runId: string,
    onDelta: (delta: string) => Promise<void>,
    onProgress: (event: ModelCallProgressEvent) => Promise<void>,
    emitted: ToolCallEmittedIds,
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
        // issue #2098 —— **归一化行尾，再找帧边界**。SSE 规范（WHATWG）允许行以
        // CRLF / CR / LF 结束，而上游 `apps/deep-agent-service` 用的 sse-starlette
        // 3.3.4 默认就是 **CRLF**：真实帧分隔符是 `\r\n\r\n`，里面**不含** `\n\n`
        // 子串。所以下面那句 `indexOf("\n\n")` 对真引擎的字节**一帧都切不出来**——
        // 整条流被读完却一个事件都没解析出来，`tryStreamRun` 仍返回 true（流确实
        // 正常读完了），调用方于是直接走终态 → `readCompletion` 取整段终稿，
        // `agui-bridge` 零 delta → 控制器 `sawAnyDelta === false` → 前端收到**一条**
        // 装着整段答案的 `TEXT_MESSAGE_CONTENT`。这正是「全空十几秒后整段一次性出现、
        // 同时工具卡才冒出来」的真根因（工具卡同理：`emitNewToolEvents` 只剩终态那
        // 一次兜底调用）。
        //
        // ⚠ 这个 bug 能活下来，是因为**所有替身都说 LF**：`loopback-deep-agent-
        //   provider.ts:428` 与本目录反证套件 `deep-agent-stream.test.ts` 写的都是
        //   `\n\n`，于是「逐 token 真流式」的反证测试全绿，而真引擎零 delta。
        //   取证：`.harness/state/deepagent-eval/2026-08-23-3d327c13/sse-and-thread-
        //   state-evidence-v2/01-sse-stream.txt` 345 行**全部**以 `0d0a` 结尾；把
        //   那份原始字节逐帧回放给本解析器，CRLF 原样 → onDelta 0 次，仅把 `\r`
        //   剥掉 → onDelta 34 次（243 字符，+12.31s~+14.42s）。一位之差。
        //
        // 归一化放在**每轮对整个剩余 buffer** 做，而不是只对本次 decode 的分片做：
        // 一个 `\r\n` 可能被 TCP 分片从中间劈开（`\r` 落在上一片尾、`\n` 落在下一片
        // 头），只归一化分片会漏掉它；对整个 buffer 重复归一化是幂等的，那个残留的
        // `\r` 会在下一轮与新到的 `\n` 合并后被正确吃掉。
        //
        // 逐行解析那侧不需要动：`l.slice(5).trim()` 本来就会把行尾残留的 `\r` 吃掉，
        // 坏掉的**只有帧边界**这一处。
        buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
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
          if (Array.isArray(parsed)) {
            // messages-tuple 形状：[chunk, metadata]。
            if (parsed.length === 0) continue;
            const chunk = parsed[0] as { content?: unknown; tool_call_id?: unknown };
            if (typeof chunk.tool_call_id === "string" && chunk.tool_call_id !== "") {
              await this.emitNewToolEvents(baseUrl, threadId, onProgress, emitted);
              continue;
            }
            if (typeof chunk.content === "string" && chunk.content !== "") {
              await onDelta(chunk.content);
            }
            continue;
          }
          // updates 形状：`{node_name: patch}`——一个 pregel 步骤更新了哪些节点。
          // 只认 "tools" 键，其余节点（各种 middleware 的 before_agent/before_model、
          // "model" 节点自身等）与工具调用可见性无关，静默跳过；`patch` 的具体字段
          // （`messages`/`todos`）留给 `emitNewToolEvents` 内部已有的 state 读 + 配对
          // 逻辑消费，这里不重新解析它。
          if (typeof parsed === "object" && parsed !== null) {
            const patch = parsed as Record<string, unknown>;
            if ("tools" in patch && patch.tools !== null && patch.tools !== undefined) {
              await this.emitNewToolEvents(baseUrl, threadId, onProgress, emitted);
            }
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

  /** DA-07b：从 thread state 找待批的调用——最后一个没有 ToolMessage 回应的 tool_call。
   * 找不到时如实返回占位名（"unknown"），绝不编参数。 */
  private async readPendingApproval(
    baseUrl: string, threadId: string,
  ): Promise<{ toolName: string; argsSummary: string | null; skillStableName?: string | null }> {
    const state = await this.readState(baseUrl, threadId);
    const messages = state.values?.messages ?? [];
    const answered = new Set<string>();
    for (const m of messages) {
      if (m.type === "tool" && typeof m.tool_call_id === "string") answered.add(m.tool_call_id);
    }
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i]!;
      if (m.type !== "ai" || !Array.isArray(m.tool_calls)) continue;
      for (const call of m.tool_calls) {
        const id = typeof call.id === "string" ? call.id : null;
        const name = typeof call.name === "string" ? call.name : null;
        if (id === null || name === null || answered.has(id)) continue;
        // issue #2767 -- 直接从原始 args 对象读 `skill_stable_name`，不是从下面
        // `argsSummary`（可能被截断的摘要文本）反解析。非 call_skill 的中断
        // （三个具名虚拟工具）没有这个字段，`skillStableName` 保持 undefined。
        const args = call.args;
        const skillStableName = name === DEEP_AGENT_HITL_TOOL_NAME
          && typeof args === "object" && args !== null && !Array.isArray(args)
          && typeof (args as Record<string, unknown>).skill_stable_name === "string"
          ? (args as Record<string, unknown>).skill_stable_name as string
          : undefined;
        return {
          toolName: name,
          argsSummary: call.args === undefined ? null : summarizeProgressText(JSON.stringify(call.args), 4000),
          ...(skillStableName === undefined ? {} : { skillStableName }),
        };
      }
    }
    return { toolName: "unknown", argsSummary: null };
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
    // DA-07b：resume 模式——向停在 interrupt 的既有 run 提交裁决，绝不重发用户输入
    // （重发会让引擎把同一条消息处理两遍）。resume 形状 {"decisions":[...]} 是 0.7.6
    // HumanInTheLoopMiddleware 的实测契约（裸列表 TypeError，见 deep-agent-service
    // 的 test_harness.py 存档）。
    // UX-9 D4：edit 决策的实测形状（同一中间件源码的 EditDecision TypedDict）：
    // {type:"edit", edited_action:{name:str, args:dict}}。args 在这里从存储的 JSON
    // 文本解析并校验为普通对象——坏 JSON / 非对象抛 ModelCallError（fail closed），
    // 绝不静默降级成 approve 放行一个没人看过的动作。
    if (input.resume !== undefined) {
      let decision: Record<string, unknown>;
      if (input.resume.decision === "edit") {
        let args: unknown;
        try {
          args = JSON.parse(input.resume.editedAction.argsJson);
        } catch {
          throw new ModelCallError("MODEL_CALL_FAILED", "HITL edit resume: stored editedArgs is not valid JSON");
        }
        if (typeof args !== "object" || args === null || Array.isArray(args)) {
          throw new ModelCallError("MODEL_CALL_FAILED", "HITL edit resume: stored editedArgs is not a JSON object");
        }
        decision = { type: "edit", edited_action: { name: input.resume.editedAction.name, args } };
      } else {
        decision = { type: input.resume.decision };
      }
      const response = await fetchWithTransportErrors(`${baseUrl}/threads/${threadId}/runs`, {
        method: "POST",
        body: JSON.stringify({
          assistant_id: ASSISTANT_ID,
          command: { resume: { decisions: [decision] } },
          // issue #2768 -- a resume is the SAME run's next model call, and `call_skill`'s
          // ONLY source of "which skills are pinned to this run" is `configurable.org_skills`
          // (`tools.py`'s `_read_org_skills`, read fresh from THIS request's config -- it is
          // NOT carried over from the run's first, pre-interrupt request). Before this fix,
          // resume sent no `org_skills` at all (see `createRun`'s NEW-run branch below,
          // which always sends it): the very call that was interrupted specifically so a
          // human could approve `call_skill` would, once approved, immediately execute
          // `call_skill` against an EMPTY skill table and answer "未知技能" -- the model then
          // reports success anyway (its own words, not a tool result), and no script/file is
          // ever produced. Reproduced against a real `langgraph dev` kernel: identical resume
          // requests, differing only in this `config` key, produce the real skill's script
          // block vs. "未知技能「pdf-create」" (see PR body for the two capture files).
          // `script_protocol` mirrors the SAME "resume is the next model call" fact the
          // NEW-run branch already sends; `org_skills` is the one this bug was about.
          //
          // ⚠ 2026-09-05（#2776 遗留清理，与本 issue #2779 无关）：`ModelCallInput.
          // disableTaskAutoClassify`/`ClaimedAgentRun.disableTaskAutoClassify` 已随
          // "总是先计划"手动开关一起删除（composer: remove manual 任务模式/总是先计划
          // toggles，#2770/#2776），这里之前留了一条悬空引用（`input.disableTaskAutoClassify`
          // 在删除后已经不是 `ModelCallInput` 上的字段），main 上 `pnpm turbo run typecheck
          // --filter=@repo/api` 因此是红的——顺手清掉，不是本 PR 的功能改动。
          config: {
            configurable: {
              org_skills: toWireSkills(input.skills),
              ...(input.scriptProtocol === undefined ? {} : { script_protocol: input.scriptProtocol }),
              // Phase 14 后续 A（#2755）：resume 是同一个 run 的"下一次 ModelCallInput"，上一次
              // 检查点消费到的插话在这里回灌内核——`harness.py` 的 `InterjectionMiddleware`
              // 在恢复后的下一次模型调用前读 `configurable.interjection` 注入并重规划。
              // ⚠ 缺席时这个键不出现，其余键（`org_skills` 等）逐字不受影响。
              ...(input.interjection === undefined ? {} : {
                [KERNEL_INTERJECTION_CONFIGURABLE_KEY]: input.interjection,
              }),
              // issue #2767 -- resume 同样是这个 run 的"下一次内核调用"，`hitl_skill_names`
              // 必须跟着投影，否则 resume 之后内核对 `call_skill` 又会退回"每次都
              // interrupt"的 fail-closed 默认——L2 skill 经编辑/裁决后继续跑还用得上它。
              // ⚠ 缺席时这个键不出现，同上面 `interjection` 的既有纪律。
              ...(input.hitlSkillNames === undefined ? {} : {
                [KERNEL_HITL_SKILLS_CONFIGURABLE_KEY]: input.hitlSkillNames,
              }),
            },
          },
        }),
      });
      const body = (await response.json()) as { run_id?: string };
      if (!response.ok || !body.run_id) {
        throw new ModelCallError("MODEL_CALL_FAILED", `deep agent resume failed with HTTP ${response.status}`);
      }
      input.onRemoteRunStarted?.(body.run_id);
      return body.run_id;
    }

    const messages: { role: string; content: string }[] = [];
    if (input.system.trim() !== "") messages.push({ role: "system", content: input.system });
    for (const turn of input.history ?? []) messages.push({ role: turn.role, content: turn.content });
    messages.push({ role: "user", content: input.user });

    const response = await fetchWithTransportErrors(`${baseUrl}/threads/${threadId}/runs`, {
      method: "POST",
      body: JSON.stringify({
        assistant_id: ASSISTANT_ID,
        // 生产无流式的根因（2026-08-23 人类实测报告 → 静态定位）：创建 run 时不带
        // stream_mode，LangGraph 的 join 流（GET /runs/:id/stream）默认只回放 values
        // 状态快照——没有逐 token 的 messages 事件，tryStreamRun 的解析器（只认
        // messages-tuple 的 [chunk, metadata] 形状）全部跳过，零 delta，按设计静默
        // 回退轮询。修法是在**创建时**声明要什么流：messages-tuple 逐 token。
        // 对不消费流的调用（complete()）无害——事件只是被缓存，没人读而已。
        // 2026-08-23 人类第二轮引擎重评（D2，见 `.harness/state/deepagent-eval/
        // 2026-08-23-3d327c13/scoring-rationale.md`）：activity 探针修好后证实 engine
        // 原生真的会在 `updates` stream_mode 下发出独立的 `tools` 节点事件（每条带
        // tool_call_id/name/content/status，见该目录 `01-sse-stream.txt` 第 118/121/195
        // 行），但这条链路此前只请求了 `messages-tuple`——`tryStreamRun` 里判断"有 Tool
        // Message 落地"的唯一信号是 messages-tuple chunk 携带 `tool_call_id`，而同一份
        // 实测证据显示这个字段在真实 run 里从未出现在 messages-tuple chunk 上（90 条
        // messages 事件里 0 条带 tool_call_id）——那条触发路径形同虚设，工具调用可见性
        // 实际只靠轮询循环每 `pollIntervalMs` 兜底读一次 state，不是逐次事件驱动。
        // 加上 "updates" 后，`tryStreamRun` 新增对象形状（{node_name: patch}）的分支：
        // 见到 "tools" 节点的 patch 就立刻触发一次 `emitNewToolEvents`——复用既有的
        // state 读 + `extractToolCallEvents` 配对逻辑，不新建第二套记账路径。
        stream_mode: ["messages-tuple", "updates"],
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
            /*
             * issue #2770 —— 这里曾按 issue #2667 透传 `disable_task_auto_classify`
             * （前端「每次都先计划」开关关掉这一次 run 的自动判类）。该开关连同它在
             * web → api 的整条来源已删：`TaskClassifierMiddleware` 无条件挂载（Phase 14
             * F02），要不要先计划由内核判。远端 `harness.py` 仍防御性地读这个键（缺席 =
             * 未覆盖，只剩 golden 测试当 seam 用），本层不再产生它。
             */
            /*
             * Phase 14 后续 A（#2755）：待投递内核的插话（形状 = 契约 `KernelInterjection`，
             * 键名 = 契约 `KERNEL_INTERJECTION_CONFIGURABLE_KEY`，两侧 parity 测试机械比对）。
             * 新建 run 这条分支实际很少带它（插话只在 run 已经在跑之后才会有，见
             * `interjection-handling.ts` 头注），但 provider 不该知道这条时序——字段在就投影。
             * ⚠ 缺席时这个键**不出现**（T2 锁：`deep-agent-produces-files.test.ts`）。
             */
            ...(input.interjection === undefined
              ? {}
              : { [KERNEL_INTERJECTION_CONFIGURABLE_KEY]: input.interjection }),
            /*
             * issue #2767 —— 本次 run 挂载集合里等级为 L2 的 skill 名单，键名 = 契约
             * `KERNEL_HITL_SKILLS_CONFIGURABLE_KEY`。`harness.py` 的
             * `_call_skill_requires_hitl` 谓词读它决定要不要为这次 `call_skill`
             * interrupt——键缺席时内核 fail-closed 成"每次都停"，所以这里**只有
             * `execute-run.ts` 真算出了这个列表才投影**，不是无条件传空数组（空数组
             * 与"没有 L2 skill"同义，但"没算过"与"算出来是空"是两件不同的事，前者
             * 缺席更诚实）。
             */
            ...(input.hitlSkillNames === undefined
              ? {}
              : { [KERNEL_HITL_SKILLS_CONFIGURABLE_KEY]: input.hitlSkillNames }),
            /*
             * issue #2664 -- `spawn_async_task` 需要知道①把子任务信息 POST 去哪
             * （`subtask_callback_base_url`，本进程自己的地址）、②带哪把共享密钥
             * （`subtask_callback_key`，`subtask-run.controller.ts` 校验的同一个值）、
             * ③子任务归属哪个父 run（`org_id`/`parent_run_id`，来自这次 `ModelCallInput`
             * 本身——见该类型自己的文档）。三者任一缺席，`spawn_async_task` 都退化为诚实
             * 报告"无法派发"，不是这里要处理的分支（见该工具自己的文档）。
             *
             * ⚠ 这四个键必须**一起**出现或**一起**不出现：`org_id`/`parent_run_id` 只
             * 在配了回调地址时才有意义，之前误写成独立条件，导致没配回调的调用（包括
             * 每次真实执行——`executeQueuedRuns` 总会传 `orgId`/`runId`）也会带上它俩，
             * 破坏了 T2 锁的"没挂 skill 时 configurable 逐字不变"（`deep-agent-produces-
             * files.test.ts`，2026-09-04 CI 抓到）。
             */
            ...((this.config.subtaskCallbackBaseUrl ?? "") === "" ? {} : {
              subtask_callback_base_url: this.config.subtaskCallbackBaseUrl,
              subtask_callback_key: this.config.subtaskCallbackKey ?? "",
              ...(input.orgId === undefined ? {} : { org_id: input.orgId }),
              ...(input.runId === undefined ? {} : { parent_run_id: input.runId }),
            }),
          },
        },
      }),
    });
    const body = (await response.json()) as { run_id?: string };
    if (!response.ok || !body.run_id) {
      throw new ModelCallError("MODEL_CALL_FAILED", `deep agent run submission failed with HTTP ${response.status}`);
    }
    input.onRemoteRunStarted?.(body.run_id);
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
