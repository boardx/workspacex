/**
 * Phase 18 知识图谱测试的共享夹具：一个 org + 一个会话 + 两条证据段。
 */
import type { OntologyBatch } from "../../src/domain/knowledge-graph/ontology-batch";
import { addSegment, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

export async function seedKgOrg(orgId: string): Promise<{ segments: [string, string] }> {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(orgId);
  await seedOrg({ orgId, projectId: `${orgId}-p` });
  const segments: [string, string] = [`${orgId}-seg-1`, `${orgId}-seg-2`];
  await addSegment({ orgId, segmentId: segments[0], artifactId: `${orgId}-art`, versionId: `${orgId}-art-v1`, ordinal: 0 });
  await addSegment({ orgId, segmentId: segments[1], artifactId: `${orgId}-art`, versionId: `${orgId}-art-v1`, ordinal: 1 });
  return { segments };
}

let seq = 0;
/** 一批「模型从一条消息里抽出来的」候选：一个人、一条决定、一条边。 */
export function modelBatch(orgId: string, segmentId: string, over: Partial<OntologyBatch> = {}): OntologyBatch {
  seq += 1;
  const n = `${orgId}-${seq}`;
  return {
    actionId: `act-${n}`,
    scope: { kind: "chat_session", id: `thread-${orgId}` },
    actor: { kind: "model", id: "kg-extractor" },
    actionType: "extract",
    sourceRef: `msg-${n}`,
    pipelineVersion: "kg-extract@1",
    objects: [{ id: `obj-${n}`, objectKind: "person", name: "张三", aliases: ["老张"] }],
    claims: [{
      id: `clm-${n}`, claimKind: "decision", statement: "张三决定 9/29 上线", status: "proposed", confidence: 0.8,
      evidence: [{ segmentId, stance: "supporting" }],
    }],
    edges: [{ id: `edg-${n}`, srcKind: "claim", srcId: `clm-${n}`, dstKind: "object", dstId: `obj-${n}`, relation: "decided_by" }],
    ...over,
  };
}
