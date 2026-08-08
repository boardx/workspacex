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
import type { ModelCallInput, ModelCallProgressEvent, PinnedSkillContent } from "../../application/agent-run/ports";
import { ModelCallError, type ModelCallPort } from "../../application/agent-run/ports";

export const DEEP_AGENT_PROVIDER_NAME = "deep-agent";
/** Must match `langgraph.json`'s `graphs` key in `apps/deep-agent-service` verbatim. */
const ASSISTANT_ID = "Deep Agent";

export interface DeepAgentProviderConfig {
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
        const argsSummary = call.args === undefined ? null : summarizeProgressText(JSON.stringify(call.args));
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

  async complete(input: ModelCallInput): Promise<{ readonly text: string; readonly tokens?: number }> {
    const { baseUrl, threadId, runId, deadline, pollIntervalMs, timeoutMs } = await this.startRun(input);
    await this.pollToTerminal(baseUrl, threadId, runId, deadline, pollIntervalMs, timeoutMs);
    const text = await this.readFinalReply(baseUrl, threadId);
    if (text.trim() === "") {
      throw new ModelCallError("MODEL_CALL_FAILED", "deep agent run succeeded but produced no assistant message");
    }
    return { text };
  }

  /**
   * #783 -- same run, same poll loop as `complete()`, plus one extra state read per
   * iteration to report tool-call progress AS IT HAPPENS. See this file's own header for
   * why this is `complete()`'s loop with a read added, not a second implementation of it.
   */
  async completeWithProgress(
    input: ModelCallInput,
    onProgress: (event: ModelCallProgressEvent) => Promise<void>,
  ): Promise<{ readonly text: string; readonly tokens?: number }> {
    const { baseUrl, threadId, runId, deadline, pollIntervalMs, timeoutMs } = await this.startRun(input);
    const emitted = new Set<string>();

    const emitNewEvents = async (): Promise<void> => {
      const state = await this.readState(baseUrl, threadId);
      const messages = state.values?.messages ?? [];
      for (const { id, event } of extractToolCallEvents(messages, emitted)) {
        // Marked emitted ONLY after `onProgress` resolves -- a rejection (the run store
        // append failed, say) must not silently drop this event from a later poll's retry,
        // same "not best effort" discipline `completeStream`'s `onDelta` already keeps.
        await onProgress(event);
        emitted.add(id);
      }
    };

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

    const text = await this.readFinalReply(baseUrl, threadId);
    if (text.trim() === "") {
      throw new ModelCallError("MODEL_CALL_FAILED", "deep agent run succeeded but produced no assistant message");
    }
    return { text };
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
    const threadId = await this.createThread(baseUrl);
    const runId = await this.createRun(baseUrl, threadId, input);
    return { baseUrl, threadId, runId, deadline, pollIntervalMs, timeoutMs };
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
        config: { configurable: { org_skills: toWireSkills(input.skills) } },
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

  private async readFinalReply(baseUrl: string, threadId: string): Promise<string> {
    const state = await this.readState(baseUrl, threadId);
    const messages = state.values?.messages ?? [];
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
    // Same redaction discipline as `DeepResearchModelProvider`'s identical helper: no host/
    // port detail leaves this process.
    throw new ModelCallError("MODEL_CALL_FAILED", "deep agent service transport failure");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
