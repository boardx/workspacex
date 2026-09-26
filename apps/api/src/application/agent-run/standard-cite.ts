/**
 * #4227 —— `wx_cite`：让 chat 回答的引用真的流到 `chat_citations`。
 *
 * ## id 校验取哪一种（设计取舍）
 *
 * 候选有两种：(a) id 必须在本次 run 的检索/工具结果里出现过；(b) id 是调用方当前能看到的
 * 本组织来源。仓库里**没有**「本 run 检索结果」的服务端账本（`wx_knowledge_search` 的返回只
 * 流回模型，不落库），要做 (a) 就得新建第二份检索记录——而那份记录本身又要单独判权。
 *
 * 所以取 (b) 的严格版：每条引用都经 `StandardKnowledgeSource.read(actor, {sourceId, versionId})`
 * **重读一次**——与 `wx_knowledge_read` 完全同一条路径：租户（`actor.orgId` 来自受信的 run
 * 回调，不来自模型参数）、项目/附件可见性、内容版本逐字一致，三者任一不过 ⇒ 拒绝。
 * 于是模型只能引用「它此刻真能读到、且版本没变」的来源；编造的 id、别的组织的 id、
 * 已撤权/已改版的来源一律进 `rejected`。`quote` 若给出，必须真的出现在重读到的正文里。
 *
 * `sourceArtifactId` 只取服务端重读返回的 `citationAnchor.artifactId`（indexed-segment），
 * 永不采信模型给的 artifact id；聊天附件没有 artifact，记 `null`。
 *
 * ## 副作用边界
 *
 * 唯一的写是把通过校验的条目追加到本 run 的引用账本（`agent_runs.cited_sources`），
 * 不写消息、不写 `chat_citations`——那由写回事务之后的 `persistAssistantCitations` 做。
 * 因此在 `tool-risk-tier.ts` 登记为 L0。
 */
import type { z } from "zod";
import type { CiteInput, CiteOutput, KnowledgeReadOutput } from "@repo/contracts/standard-context-tools";
import type { OrgId } from "../../domain/org-id";
import type { NewAssistantCitation } from "../chat/persist-assistant-citations";
import type { StandardKnowledgeSource, TrustedContextActor } from "./standard-context-tools";

/** 记在 run 上的一条引用（尚未编号）。`key` 用来折叠重复引用。 */
export interface RunCitation {
  readonly key: string;
  readonly sourceFullName: string;
  readonly anchorKind: NewAssistantCitation["anchorKind"];
  readonly anchorPage: number | null;
  readonly anchorRange: string | null;
  readonly anchorMessageId: string | null;
  readonly sourceArtifactId: string | null;
}

export interface RunCitationLedger {
  /**
   * 把条目追加到 run 的引用账本（已存在的 key 不重复追加），返回追加后账本里全部 key 的顺序。
   * run 不在 `running` 态 ⇒ `null`，什么也不写。
   */
  appendRunCitations?(orgId: OrgId, runId: string, items: readonly RunCitation[]): Promise<readonly string[] | null>;
}

type Read = z.infer<typeof KnowledgeReadOutput>;
type Item = z.infer<typeof CiteInput>["citations"][number];
type Output = z.infer<typeof CiteOutput>;
type Reject = Output["rejected"][number]["reason"];
type Anchor = Pick<RunCitation, "anchorKind" | "anchorPage" | "anchorRange" | "anchorMessageId">;

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** 模型给的锚点优先；没给就从服务端重读到的来源锚点推一个。两者都没有 ⇒ `null`（拒绝）。 */
function anchorOf(item: Item, read: Read): Anchor | null {
  const a = item.anchor;
  if (a) {
    if (a.kind === "page" && a.page !== undefined) return { anchorKind: "page", anchorPage: a.page, anchorRange: null, anchorMessageId: null };
    if (a.kind === "transcript" && a.range !== undefined) return { anchorKind: "transcript", anchorPage: null, anchorRange: a.range, anchorMessageId: null };
    if (a.kind === "message" && a.messageId !== undefined) return { anchorKind: "message", anchorPage: null, anchorRange: null, anchorMessageId: a.messageId };
    return null;
  }
  const c = read.citationAnchor;
  if (c.kind !== "indexed-segment") return null;
  if (c.anchor.kind === "page" && /^[1-9]\d{0,6}$/.test(c.anchor.locator)) {
    return { anchorKind: "page", anchorPage: Number(c.anchor.locator), anchorRange: null, anchorMessageId: null };
  }
  if (c.anchor.kind === "timecode" && c.anchor.locator) return { anchorKind: "transcript", anchorPage: null, anchorRange: c.anchor.locator, anchorMessageId: null };
  if (c.anchor.kind === "message-id" && c.anchor.locator) return { anchorKind: "message", anchorPage: null, anchorRange: null, anchorMessageId: c.anchor.locator };
  return null;
}

export async function citeSources(
  deps: { readonly knowledge: StandardKnowledgeSource; readonly ledger: RunCitationLedger },
  actor: TrustedContextActor,
  runId: string,
  input: z.infer<typeof CiteInput>,
): Promise<Output> {
  const rejected: { sourceId: string; reason: Reject }[] = [];
  const accepted: { sourceId: string; item: RunCitation }[] = [];
  for (const item of input.citations) {
    let read: Read;
    try {
      read = await deps.knowledge.read(actor, { sourceId: item.sourceId, versionId: item.versionId, ...(item.projectId ? { projectId: item.projectId } : {}) });
    } catch {
      rejected.push({ sourceId: item.sourceId, reason: "source_not_visible" });
      continue;
    }
    const anchor = anchorOf(item, read);
    if (!anchor) { rejected.push({ sourceId: item.sourceId, reason: "anchor_invalid" }); continue; }
    if (item.quote !== undefined && !norm(read.content).includes(norm(item.quote))) {
      rejected.push({ sourceId: item.sourceId, reason: "quote_not_found" });
      continue;
    }
    const locator = anchor.anchorPage ?? anchor.anchorRange ?? anchor.anchorMessageId;
    accepted.push({
      sourceId: item.sourceId,
      item: {
        key: JSON.stringify([item.sourceId, read.sourceVersion, anchor.anchorKind, locator]),
        sourceFullName: read.title && read.title.trim() ? read.title : item.sourceId,
        ...anchor,
        sourceArtifactId: read.citationAnchor.kind === "indexed-segment" ? read.citationAnchor.artifactId : null,
      },
    });
  }
  if (accepted.length === 0) return { accepted: [], rejected };
  const unique = [...new Map(accepted.map(a => [a.item.key, a.item])).values()];
  const keys = deps.ledger.appendRunCitations ? await deps.ledger.appendRunCitations(actor.orgId, runId, unique) : null;
  if (!keys) {
    return { accepted: [], rejected: [...rejected, ...accepted.map(a => ({ sourceId: a.sourceId, reason: "run_not_active" as const }))] };
  }
  const seen = new Set<string>();
  const out: Output["accepted"] = [];
  for (const a of accepted) {
    if (seen.has(a.item.key)) continue;
    seen.add(a.item.key);
    out.push({ index: keys.indexOf(a.item.key) + 1, sourceId: a.sourceId, sourceFullName: a.item.sourceFullName });
  }
  return { accepted: out, rejected };
}

/** 写回侧：账本 → `PendingWriteback.citations`，折叠重复 key，按首次出现编号 1..n。 */
export function numberRunCitations(items: readonly RunCitation[] | null | undefined): NewAssistantCitation[] {
  const seen = new Set<string>();
  const out: NewAssistantCitation[] = [];
  for (const c of items ?? []) {
    if (!c || typeof c.key !== "string" || seen.has(c.key)) continue;
    seen.add(c.key);
    out.push({
      index: out.length + 1,
      sourceFullName: c.sourceFullName,
      anchorKind: c.anchorKind,
      anchorPage: c.anchorPage,
      anchorRange: c.anchorRange,
      anchorMessageId: c.anchorMessageId,
      sourceArtifactId: c.sourceArtifactId,
    });
  }
  return out;
}
