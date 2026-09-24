/**
 * backlog E3 —— 把一条 assistant 回答携带的引用落进 `chat_citations`（F111 的持久层）。
 *
 * 此前这张表没有任何写入方（见 `ports.ts` 上 `ChatCitationRow` 的注释），于是
 * `firstValueEvents` 的价值时刻 `cited_answer_own_material` 永远记不下来。本文件是写入侧：
 *
 * 1. **组织内校验**：消息必须在调用方组织内（`messageExists`，租户内读）；`sourceArtifactId`
 *    非空时该 artifact 必须在同一组织内（`artifactExists`）——跨组织引用整批拒绝
 *    （`CrossOrgCitationError`），一行也不写。RLS 是第二道闸，不是唯一一道。
 * 2. **幂等**：写入走 `(org_id, message_id, idx)` 唯一索引 + ON CONFLICT DO NOTHING，
 *    重放同一条回答的写回不会产生第二行；价值时刻记录本身也是先写者胜。
 * 3. **价值时刻**：至少一条引用指向本组织的 artifact ⇒ 记 `cited_answer_own_material`
 *    （fire-and-forget，失败不冒泡）。
 *
 * ⚠ 已知边界：目前没有区分「示例项目材料」与「自己上传的材料」的事实源，
 *   所以任何本组织 artifact 都算「自己的材料」。
 */
import type { OrgId } from "../../domain/org-id";
import { recordFirstValue, type FirstValueRecorder } from "../first-value/first-value-recorder";

export interface NewAssistantCitation {
  /** 界面角标编号，同一条消息内唯一，> 0。 */
  readonly index: number;
  readonly sourceFullName: string;
  readonly anchorKind: "page" | "transcript" | "message";
  readonly anchorPage: number | null;
  readonly anchorRange: string | null;
  readonly anchorMessageId: string | null;
  readonly sourceArtifactId: string | null;
}

/** 写入端口：只写，不判权（调用方已校验）。返回实际新插入的行数。 */
export interface ChatCitationWriter {
  messageExists(orgId: OrgId, messageId: string): Promise<boolean>;
  artifactExists(orgId: OrgId, artifactId: string): Promise<boolean>;
  insertCitations(orgId: OrgId, messageId: string, citations: readonly NewAssistantCitation[]): Promise<number>;
}

export class CrossOrgCitationError extends Error {
  constructor(readonly reason: "message_not_in_org" | "source_not_in_org") {
    super("cross_org_citation");
  }
}

export class InvalidCitationError extends Error {
  constructor(readonly reason: string) {
    super("invalid_citation");
  }
}

export interface PersistAssistantCitationsDeps {
  readonly citations: ChatCitationWriter;
  readonly firstValue?: FirstValueRecorder;
}

function validate(citations: readonly NewAssistantCitation[]): void {
  const seen = new Set<number>();
  for (const c of citations) {
    if (!Number.isInteger(c.index) || c.index <= 0) throw new InvalidCitationError("index_not_positive");
    if (seen.has(c.index)) throw new InvalidCitationError("duplicate_index");
    seen.add(c.index);
    if (c.sourceFullName.length === 0) throw new InvalidCitationError("empty_source_name");
    const ok =
      (c.anchorKind === "page" && c.anchorPage !== null && c.anchorPage > 0) ||
      (c.anchorKind === "transcript" && c.anchorRange !== null) ||
      (c.anchorKind === "message" && c.anchorMessageId !== null);
    if (!ok) throw new InvalidCitationError("anchor_field_mismatch");
  }
}

export async function persistAssistantCitations(
  deps: PersistAssistantCitationsDeps,
  input: { readonly orgId: OrgId; readonly messageId: string; readonly citations: readonly NewAssistantCitation[] },
): Promise<{ readonly inserted: number }> {
  if (input.citations.length === 0) return { inserted: 0 };
  validate(input.citations);
  if (!(await deps.citations.messageExists(input.orgId, input.messageId))) {
    throw new CrossOrgCitationError("message_not_in_org");
  }
  const sourceIds = [...new Set(input.citations.map((c) => c.sourceArtifactId).filter((s): s is string => s !== null))];
  for (const id of sourceIds) {
    if (!(await deps.citations.artifactExists(input.orgId, id))) throw new CrossOrgCitationError("source_not_in_org");
  }
  const inserted = await deps.citations.insertCitations(input.orgId, input.messageId, input.citations);
  if (sourceIds.length > 0) recordFirstValue(deps.firstValue, input.orgId, "cited_answer_own_material");
  return { inserted };
}
