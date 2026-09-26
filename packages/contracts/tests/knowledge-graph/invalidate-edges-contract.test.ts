/**
 * Phase 18 F07 —— 09-kg 对 files 束出站端口 `invalidateOntologyEdges` 的契约核对（uc-18-5 R7-3）。
 *
 * 端口形状只有一份：`files.ts` 的 `OUTBOUND_PORTS.invalidateOntologyEdges`；知识图谱束只实现它，
 * 不另声明第二份（chat-knowledge-graph.ts 文件头「不包含」一节）。
 *
 * 真实现在 apps/api（`kg_invalidate_segment_evidence`，真实数据库测试见
 * apps/api/tests/knowledge-graph/invalidate-ontology-edges.test.ts）。这里用同一语义的内存参照模型
 * ——软失效：行保留、status 置 invalidated、返回这些版本上全部已失效的边——跑 files 束那套
 * 对任意实现都成立的契约断言，证明「软失效」与端口契约（形状 / 幂等 / 空集拒绝）相容。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as files from "../../src/files";
import { assertPortInput } from "../../src/files-outbound-stubs";
import { VALID_INPUT, callPort, runPortConformance } from "../files/outbound-port-conformance";

const PORT = "invalidateOntologyEdges" as const;

interface Edge { id: string; versionId: string | null; status: "active" | "invalidated" }

/** 与迁移 20260924250000 同一语义的内存参照实现。 */
function softInvalidationModel(edges: Edge[]) {
  return async (input: unknown) => {
    assertPortInput(PORT, input);
    const { versionIds } = input as { versionIds: string[] };
    for (const e of edges) if (e.versionId !== null && versionIds.includes(e.versionId)) e.status = "invalidated";
    return {
      invalidatedEdgeIds: edges.filter((e) => e.versionId !== null && versionIds.includes(e.versionId) && e.status === "invalidated")
        .map((e) => e.id).sort(),
    };
  };
}

const seed = (): Edge[] => [
  { id: "e-a", versionId: "ver-1", status: "active" },
  { id: "e-b", versionId: "ver-2", status: "active" },
  { id: "e-keep", versionId: "ver-9", status: "active" },
  { id: "e-object", versionId: null, status: "active" },
];

runPortConformance(PORT, "09-kg 软失效参照模型", softInvalidationModel(seed()));

describe("F07: invalidateOntologyEdges 的软失效语义", () => {
  it("失效是软的：行一条不少，只有相关边的 status 变了", async () => {
    const edges = seed();
    const out = await callPort(softInvalidationModel(edges), VALID_INPUT[PORT]);
    expect(out).toEqual({ kind: "ok", value: { invalidatedEdgeIds: ["e-a", "e-b"] } });
    expect(edges).toHaveLength(4);
    expect(edges.map((e) => [e.id, e.status])).toEqual([
      ["e-a", "invalidated"], ["e-b", "invalidated"], ["e-keep", "active"], ["e-object", "active"],
    ]);
  });

  it("重试返回同一组 id（不是空集）：retryCascade 依赖幂等，空集也就不会被误读成「没干活」", async () => {
    const impl = softInvalidationModel(seed());
    const a = await callPort(impl, VALID_INPUT[PORT]);
    const b = await callPort(impl, VALID_INPUT[PORT]);
    expect(b).toEqual(a);
    expect((b as { value: { invalidatedEdgeIds: string[] } }).value.invalidatedEdgeIds).not.toHaveLength(0);
  });

  it("端口形状单一来源：out 只有 invalidatedEdgeIds，知识图谱束不另声明这个端口", () => {
    expect(Object.keys(files.OUTBOUND_PORTS[PORT].out.shape)).toEqual(["invalidatedEdgeIds"]);
    expect(files.OUTBOUND_PORTS[PORT].cascadeKind).toBe("ontology-edges");
    const kg = readFileSync(fileURLToPath(new URL("../../src/chat-knowledge-graph.ts", import.meta.url)), "utf8");
    expect(kg).not.toMatch(/invalidateOntologyEdges\s*[:=]/);
    expect(kg).toMatch(/OUTBOUND_PORTS\.invalidateOntologyEdges/);
  });
});
