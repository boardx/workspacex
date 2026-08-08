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
 */
import type { ModelCallInput, PinnedSkillContent } from "../../application/agent-run/ports";
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

    while (true) {
      const status = await this.readRunStatus(baseUrl, threadId, runId);
      if (status === "success") break;
      if (status === "error" || status === "timeout" || status === "interrupted") {
        throw new ModelCallError("MODEL_CALL_FAILED", `deep agent run ended with status "${status}"`);
      }
      if (Date.now() >= deadline) {
        throw new ModelCallError("MODEL_CALL_FAILED", `deep agent run did not reach a terminal state within ${timeoutMs}ms`);
      }
      await sleep(pollIntervalMs);
    }

    const text = await this.readFinalReply(baseUrl, threadId);
    if (text.trim() === "") {
      throw new ModelCallError("MODEL_CALL_FAILED", "deep agent run succeeded but produced no assistant message");
    }
    return { text };
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

  private async readFinalReply(baseUrl: string, threadId: string): Promise<string> {
    const response = await fetchWithTransportErrors(`${baseUrl}/threads/${threadId}/state`, { method: "GET" });
    if (!response.ok) {
      throw new ModelCallError("MODEL_CALL_FAILED", `deep agent thread state read failed with HTTP ${response.status}`);
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
    // Same redaction discipline as `DeepResearchModelProvider`'s identical helper: no host/
    // port detail leaves this process.
    throw new ModelCallError("MODEL_CALL_FAILED", "deep agent service transport failure");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
