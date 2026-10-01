/**
 * #4615（PROP-PROJECT-WORKSPACE-001 §3.2）白板便签 / 文本块 → 证据单元（`source_kind = whiteboard_note`）。
 *
 * 粒度：**一张便签 / 一个文本块一条**（`sourceRef = <boardId>:<objectId>`——对象 id 只在一块白板内唯一，
 * 幂等键 `(org_id, source_kind, source_ref)` 因此带上白板 id）。摘录经 `clipExcerpt`（≤ 280）；
 * `resourceTitle` = 白板名；`locator.ordinal` = 白板上的阅读顺序；说话人 = 作者显示名，拿不到就 null（不猜）。
 * 空白便签跳过（`upsertAll` 对空摘录不写）。只采白板上**活着**的对象（已删除的不在快照读出的集合里）。
 */
import type { UpsertEvidenceCommand } from "../project-evidence-ports";
import { clipExcerpt, disclosedOrNull, EMPTY_RESULT, upsertAll, type CollectorDeps, type CollectorInput, type CollectResult } from "./shared";

export function whiteboardNoteRef(boardId: string, objectId: string): string {
  return `${boardId}:${objectId}`;
}

export async function collectWhiteboardEvidence(deps: CollectorDeps, input: CollectorInput): Promise<CollectResult> {
  const docs = disclosedOrNull(await deps.sources.whiteboardsOf(input.orgId, input.projectId), input.decision);
  if (docs === null) return EMPTY_RESULT;
  const commands: UpsertEvidenceCommand[] = [];
  for (const doc of docs) {
    for (const note of doc.notes) {
      commands.push({
        orgId: input.orgId,
        projectId: input.projectId,
        sourceKind: "whiteboard_note",
        resourceId: doc.boardId,
        sourceRef: whiteboardNoteRef(doc.boardId, note.objectId),
        excerpt: clipExcerpt(note.text),
        locator: note.ordinal > 0 ? { ordinal: note.ordinal } : {},
        speakerLabel: note.authorLabel,
        resourceTitle: doc.title,
      });
    }
  }
  return upsertAll(deps.evidence, commands);
}
