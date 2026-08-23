/**
 * `generateFollowUpSuggestions` —— UIUX gap #2（CopilotKit 对标清单）：
 * `chat-live-message-panel.tsx` 的 `computeFollowUpSuggestions` 此前是纯前端确定性
 * 规则（见该文件头注、issue #712），不是真实模型推荐。这里补上真实推理调用。
 *
 * ## 复用点：`trialRunAgent` 的最小形状，不是 `agent_runs` 整条状态机
 *
 * 与 `trial-run-agent.ts` 头注同一个判断：这次调用**不需要**写回某条 Chat 消息，
 * 不需要 `queued → running → succeeded` 那条状态机，只需要「读线程正文 → 拼一段
 * 简短 system prompt → 调一次 `ModelCallPort.complete`」。复用的两块与 `trialRunAgent`
 * 完全一致：`PublishedAgentReader.resolvePublished` 拿 `modelProvider`/`modelId`，
 * `ModelCallPort`（全仓唯一真的发 HTTP 请求调模型的实现）。
 *
 * `agentId` 由调用方（前端 composer）传入，同 `acceptHumanMessage.in.agentId`
 * 一样的信任级别——是这条线程当前选中的 Agent，不是本用例自己去猜的。
 *
 * ## 可见性
 *
 * 与 `summarizePersonaFromThread` 同一条判权路径：`resolveVisibility` 通过后才
 * `findMessages`，未通过一律 404（`ThreadNotVisibleError`，I-3：不存在与不可见
 * 用同一个出口）。
 *
 * ## 失败即优雅降级，不是本函数的责任
 *
 * 本函数对模型调用失败/解析失败一律抛 `FollowUpSuggestionsDependencyFailedError`
 * （503）。前端在这一失败上退回既有的确定性规则兜底——降级逻辑刻意留在前端
 * （`computeFollowUpSuggestions`），因为「没有真实建议时该说什么」是一个 UI 决定，
 * 不是这个用例该管的事。
 */
import type { OrgId } from "../../domain/org-id";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import type { ChatRepository } from "./ports";
import { resolveVisibility, type ResolveVisibilityDeps } from "./resolve-visibility";
import { ThreadNotVisibleError } from "./get-thread";
import type { PublishedAgentReader } from "./message-command-ports";
import type { ModelCallPort, ThreadHistoryMessage } from "../agent-run/ports";
import { ModelCallError } from "../agent-run/ports";

/** 依赖方（选定的 Agent 未发布 / 模型调用失败 / 回复解析不出任何建议）一律走这一档。 */
export class FollowUpSuggestionsDependencyFailedError extends Error {
  constructor(readonly detail: string) {
    super("FOLLOWUP_SUGGESTIONS_DEPENDENCY_FAILED");
    this.name = "FollowUpSuggestionsDependencyFailedError";
  }
}

export interface GenerateFollowUpSuggestionsDeps extends ResolveVisibilityDeps {
  readonly chat: ChatRepository;
  readonly publishedAgents: PublishedAgentReader;
  readonly model: ModelCallPort;
  readonly log: (message: string, detail: Record<string, unknown>) => void;
}

export interface GenerateFollowUpSuggestionsInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly threadId: string;
  /** 用来生成建议的 Agent——同 `acceptHumanMessage.in.agentId`，composer 当前选中的那个。 */
  readonly agentId: string;
}

export interface GenerateFollowUpSuggestionsResult {
  readonly suggestions: readonly string[];
}

/** 只取最近这么多轮进 prompt——追问建议不需要整条线程，且要控制 prompt 体积。 */
const HISTORY_TURN_LIMIT = 8;

/**
 * 导出只为 `scripts/loopback-model-provider.ts` 的取证分支——同 `RUN_SCRIPT_PROTOCOL_PROMPT`
 * 的既有先例（该文件头注：不新写第二份，从产品源码 import），loopback 靠这段文字**逐字匹配**
 * 系统 prompt 来识别「这是一次追问建议请求」，回显它在 history 里真的看到的对话正文——
 * 证明的是「这条 HTTP 调用真的带着线程正文」，不是伪造一条看起来对的回复。
 */
export const FOLLOWUP_SUGGESTIONS_SYSTEM_PROMPT =
  "你是一个对话助手的“追问建议”生成器。根据用户提供的最近对话内容，生成 2 到 3 条简短、" +
  "具体、与这段对话直接相关的追问问题——每条不超过 20 个汉字，站在用户角度提出（例如" +
  "“能否展开第二点？”而不是重复用户已经问过的话）。只输出一个 JSON 数组，数组元素是字符" +
  "串，不要输出任何数组之外的文字、不要用 markdown 代码块包裹。";

/**
 * 把模型回复解析成建议列表。模型偶尔不会老实只回 JSON（多余的说明文字、代码块围栏），
 * 所以先试着找出文本里第一个 `[...]` 片段再解析，而不是要求整段严格是 JSON——但
 * **不**做「按行猜」的宽松兜底：猜不出结构就是没有建议，交给上层判失败，而不是把模型
 * 说的某一行文字硬当成建议塞给用户（那会是编造，不是真实解析）。
 */
export function parseFollowUpSuggestions(text: string): readonly string[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const suggestions = parsed
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return suggestions.slice(0, 3);
}

export async function generateFollowUpSuggestions(
  deps: GenerateFollowUpSuggestionsDeps,
  input: GenerateFollowUpSuggestionsInput,
): Promise<GenerateFollowUpSuggestionsResult> {
  const facts = await deps.chat.findThreadFacts(input.orgId, input.threadId);
  if (facts === null) throw new ThreadNotVisibleError();
  const outcome = await resolveVisibility(deps, {
    userId: input.userId,
    orgId: input.orgId,
    projectId: facts.projectId,
    threadId: input.threadId,
  });
  if (outcome.kind !== "allow") throw new ThreadNotVisibleError();

  const guarded = await deps.chat.findMessages(input.orgId, input.threadId);
  if (guarded === null) throw new ThreadNotVisibleError();
  const disclosed = discloseDecided(guarded, outcome.base);
  if (!isDisclosed(disclosed)) throw new ThreadNotVisibleError();

  const ordered = [...disclosed.payload].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const recent = ordered.slice(-HISTORY_TURN_LIMIT);
  const history: ThreadHistoryMessage[] = recent.map((message) => ({
    role: message.authorKind === "human" ? "user" : "assistant",
    content: message.body,
  }));

  const snapshot = await deps.publishedAgents.resolvePublished(input.orgId, input.agentId);
  if (snapshot === null) {
    throw new FollowUpSuggestionsDependencyFailedError("agent has no published version");
  }

  let completion: { readonly text: string };
  try {
    completion = await deps.model.complete({
      modelProvider: snapshot.modelProvider,
      modelId: snapshot.modelId,
      threadId: input.threadId,
      system: FOLLOWUP_SUGGESTIONS_SYSTEM_PROMPT,
      user: "请基于以上对话生成追问建议。只输出 JSON 数组。",
      history,
    });
  } catch (e) {
    const detail = e instanceof ModelCallError ? e.detail : "unexpected model call failure";
    deps.log("followup suggestions model call failed", {
      threadId: input.threadId,
      agentId: input.agentId,
      modelProvider: snapshot.modelProvider,
      modelId: snapshot.modelId,
      code: e instanceof ModelCallError ? e.code : "MODEL_CALL_FAILED",
      detail,
    });
    throw new FollowUpSuggestionsDependencyFailedError(detail);
  }

  const suggestions = parseFollowUpSuggestions(completion.text);
  if (suggestions.length === 0) {
    deps.log("followup suggestions model reply unparseable", {
      threadId: input.threadId,
      agentId: input.agentId,
    });
    throw new FollowUpSuggestionsDependencyFailedError("model reply carried no parseable suggestions");
  }

  return { suggestions };
}
