/**
 * `expandToolCallChain` —— UC-14：展开一条消息的工具调用链。
 *
 * ## `calls.length === provenanceEvents.length`（I-22）是怎么在这里成立的
 *
 * 读出**该线程**下类型为 `TOOL_CALL_AUDIT_TYPE` 的全部事件（`queryProvenance` 只能按
 * `(targetKind, targetId)` 过滤，messageId 走 `detail`，见 `record-tool-call.ts`），
 * 再按 `detail.messageId === messageId` 筛到本条消息——筛选发生在应用层，不是因为
 * 偷懒，是因为共享契约 `queryProvenance.in` 没有 `detail` 过滤这一档（同一个洞，
 * `mutate-thread.ts` 文件头也报过一次）。`toToolCall` 对每一行做 `safeParse`，
 * parse 失败的行**不计入**——不是因为"跳过坏数据"，是因为那些行根本不是工具调用
 * （同一线程下还有 `thread-created` 等其它事件，target 相同、detail 形状不同）。
 * `summary.callCount` 用 `calls.length` 本身算，不是另开一个计数器，这就是
 * I-22/I-25 那条恒等式的实现方式：算错了 calls 数组，callCount 跟着错，两者
 * **不可能**分家。
 *
 * ## 失败条不隐藏（I-25）
 *
 * `toToolCall` 对 `status: "failed"` 的行一视同仁地投影——没有任何按 status 过滤的
 * 分支。想把失败条"先不返回、只在汇总里减一"的实现在这里做不到：函数里根本没有
 * 减法，只有映射。
 */
import type { OrgId } from "../../domain/org-id";
import {
  summarizeToolCalls,
  toToolCall,
  TOOL_CALL_AUDIT_TYPE,
  type ToolCall,
} from "../../domain/chat/tool-call-projection";
import type { ChatRepository } from "./ports";
import { resolveVisibility, type ResolveVisibilityDeps } from "./resolve-visibility";
import { ThreadNotVisibleError } from "./get-thread";
import type { ProvenanceEventRecord, ProvenanceReader } from "../provenance/ports";

export interface ExpandToolCallChainDeps extends ResolveVisibilityDeps {
  readonly chat: ChatRepository;
  readonly provenance: ProvenanceReader;
}

export interface ExpandToolCallChainInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly messageId: string;
}

export interface ExpandToolCallChainResult {
  readonly summary: { readonly callCount: number; readonly readVolume: number; readonly tokens: number };
  readonly calls: readonly ToolCall[];
}

/** 依赖不可用——契约的 `PROVENANCE_UNAVAILABLE`。 */
export class ProvenanceUnavailableError extends Error {
  constructor() {
    super("provenance_unavailable");
  }
}

/** 一次分页读取的安全上限：500（契约允许的单页上限）× 20 页 = 一万条事件。
 *  一个正常线程的调用量远到不了这个数量级；上限存在是为了不让一个游标 bug 死循环。 */
const MAX_PAGES = 20;

export async function expandToolCallChain(
  deps: ExpandToolCallChainDeps,
  input: ExpandToolCallChainInput,
): Promise<ExpandToolCallChainResult> {
  const location = await deps.chat.findMessageLocation(input.orgId, input.messageId);
  if (location === null) throw new ThreadNotVisibleError();

  const outcome = await resolveVisibility(deps, {
    userId: input.userId,
    orgId: input.orgId,
    projectId: location.projectId,
    threadId: location.threadId,
  });
  if (outcome.kind !== "allow") throw new ThreadNotVisibleError();

  let events: readonly ProvenanceEventRecord[];
  try {
    events = await collectThreadEvents(deps.provenance, input.orgId, location.threadId);
  } catch {
    throw new ProvenanceUnavailableError();
  }

  const calls = events
    .filter((e) => e.detail["messageId"] === input.messageId)
    .map((e) => toToolCall({ id: e.id, detail: e.detail }))
    .filter((c): c is ToolCall => c !== null);

  return { summary: summarizeToolCalls(calls), calls };
}

async function collectThreadEvents(
  reader: ProvenanceReader,
  orgId: OrgId,
  threadId: string,
): Promise<readonly ProvenanceEventRecord[]> {
  const all: ProvenanceEventRecord[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await reader.query(orgId, {
      types: [TOOL_CALL_AUDIT_TYPE],
      targetKind: "thread",
      targetId: threadId,
      limit: 500,
      cursor,
    });
    all.push(...result.events);
    if (result.nextCursor === null) break;
    cursor = result.nextCursor;
  }
  return all;
}
