/**
 * chat 消息证据 → 证据单元回填（`source_kind = chat_message`，B3-T1 第 5 项）。
 *
 * 抽取器（F06）把消息锚点写进 `claim_message_evidence` 之前，这里对**项目作用域线程**（`chat_threads.project_id`
 * 非空）的每个消息锚点同步 `upsert` 一条 `project_evidence`（`resourceId = threadId`，`sourceRef = messageId`，
 * 摘录就是锚点的摘录），并把单元 id 写回批次（`evidenceId`）——执行器落表时一并写进 `evidence_id` 列。
 * 个人线程 / 非会话作用域的批次原样返回，不采。只对新入图数据，不迁移旧数据。
 *
 * ⚠ 这里没有用户判定可用（后台 worker）：读的只是线程归属 + 标题（`chatThreadProject`），消息正文来自批次本身。
 * 说话人：批次里没有作者信息，本切片记 null（B3-T5 观察者脱敏时再议要不要带人名）。
 */
import type { OntologyBatch, OntologyClaimInput, OntologyEvidenceInput } from "../../../domain/knowledge-graph/ontology-batch";
import type { OrgId } from "../../../domain/org-id";
import type { ProjectEvidencePort } from "../project-evidence-ports";
import type { ProjectEvidenceSourcePort } from "./ports";
import { clipExcerpt } from "./shared";

export interface ChatEvidenceDeps {
  readonly sources: Pick<ProjectEvidenceSourcePort, "chatThreadProject">;
  readonly evidence: Pick<ProjectEvidencePort, "upsert">;
}

/**
 * 返回带 `evidenceId` 的新批次；不该采的批次**原样**返回（同一个引用，调用方可据此判断有没有动过）。
 * 同一条消息在批次里出现多次（多条结论引用它）只 upsert 一次。
 */
export async function attachChatMessageEvidence(deps: ChatEvidenceDeps, orgId: OrgId, batch: OntologyBatch): Promise<OntologyBatch> {
  if (batch.scope.kind !== "chat_session") return batch;
  const hasMessageEvidence = batch.claims.some((c) => c.evidence.some((e) => "messageId" in e));
  if (!hasMessageEvidence) return batch;
  const thread = await deps.sources.chatThreadProject(orgId, batch.scope.id);
  if (thread === null) return batch;

  const ids = new Map<string, string>();
  const claims: OntologyClaimInput[] = [];
  for (const c of batch.claims) {
    const evidence: OntologyEvidenceInput[] = [];
    for (const e of c.evidence) {
      if (!("messageId" in e)) { evidence.push(e); continue; }
      const excerpt = clipExcerpt(e.excerpt);
      // 没有摘录的锚点不成证据单元（执行器那边会用消息开头补锚点的摘录，但单元不该存一句空话）。
      if (excerpt === "") { evidence.push(e); continue; }
      let evidenceId = ids.get(e.messageId);
      if (evidenceId === undefined) {
        const out = await deps.evidence.upsert({
          orgId,
          projectId: thread.projectId,
          sourceKind: "chat_message",
          resourceId: batch.scope.id,
          sourceRef: e.messageId,
          excerpt,
          locator: {},
          speakerLabel: null,
          resourceTitle: thread.title,
        });
        evidenceId = out.id;
        ids.set(e.messageId, evidenceId);
      }
      evidence.push({ ...e, evidenceId });
    }
    claims.push({ ...c, evidence });
  }
  return { ...batch, claims };
}
