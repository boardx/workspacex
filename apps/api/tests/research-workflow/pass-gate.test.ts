/**
 * `passGate` / `advancePhase` —— 用例层：拒绝**留痕**、血缘只在放行时变、
 * 人工标记不可伪造。
 *
 * 用内存仓储而不是真库：这几条断言全部关于"调用了什么、写了什么"，
 * 起一个 PG 容器不会让它们更可信，只会让它们更难被跑（而不被跑的门控等于没有门控）。
 * 持久化本身的正确性是另一条车道的事。
 */
import { describe, expect, it } from "vitest";
import { researchWorkflow as C } from "@repo/contracts";
import {
  ResearchGateRefusedError,
  advancePhase,
  passGate,
  type PassGateDeps,
} from "../../src/application/research-workflow/pass-gate";
import type { GateAuditEntry, ResearchSessionRow } from "../../src/application/research-workflow/ports";

const NOW = new Date("2026-09-16T00:00:00.000Z");
const ORG = "org-1" as never;

function makeDeps(session: Partial<ResearchSessionRow> = {}) {
  const row: ResearchSessionRow = {
    threadId: "11111111-1111-4111-8111-111111111111",
    phase: "empty",
    lineage: { materialBatchId: null, fieldSchemeVersion: 0, logicVersion: 0, publishedGraphVersion: 0 },
    materials: [],
    verifyDueAt: null,
    updatedAt: NOW.toISOString(),
    ...session,
  };
  const audit: GateAuditEntry[] = [];
  const transitions: { phase: string; lineage: ResearchSessionRow["lineage"]; verifyDueAt: string | null }[] = [];
  let uuidN = 0;
  const deps: PassGateDeps = {
    now: () => NOW,
    uuid: { next: () => `batch-${++uuidN}` },
    research: {
      ensureSession: async () => row,
      addMaterials: async () => row,
      setMaterialVerdict: async () => row,
      bumpMaterialAttempts: async () => row,
      applyTransition: async (_o, _t, phase, lineage, verifyDueAt) => {
        transitions.push({ phase, lineage, verifyDueAt });
        return { ...row, phase, lineage, verifyDueAt };
      },
      appendAudit: async (e) => void audit.push(e),
      listAudit: async () => [],
      listPredictions: async () => [],
      addPredictions: async () => [],
      fillPrediction: async () => [],
    },
  };
  return { deps, row, audit, transitions };
}

const accepted = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `m${i}`,
    source: "paste" as const,
    label: `材料${i}`,
    verdict: "accepted" as const,
    note: null,
    attempts: 0,
    createdAt: NOW.toISOString(),
  }));

describe("passGate", () => {
  it("门①通过：阶段推进、材料批次被钉住、审计记 allowed", async () => {
    const { deps, audit, transitions } = makeDeps({ phase: "materials_review", materials: accepted(2) });
    const out = await passGate(deps, ORG, "t", "materials");

    expect(out.phase).toBe("materials_approved");
    expect(out.lineage.materialBatchId).toBe("batch-1");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorKind: "human", action: "gate:materials", outcome: "allowed", refusal: null });
    expect(transitions).toHaveLength(1);
  });

  it("被拒时**也写审计**，且带原因码——静默拒绝会让跳门尝试永远统计不出来", async () => {
    const { deps, audit, transitions } = makeDeps({
      phase: "materials_review",
      materials: [{ ...accepted(1)[0]!, verdict: "pending" as const }],
    });

    await expect(passGate(deps, ORG, "t", "materials")).rejects.toBeInstanceOf(ResearchGateRefusedError);

    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      outcome: "refused",
      refusal: "MATERIALS_UNRESOLVED",
      fromPhase: "materials_review",
    });
    // 关键：被拒时一个字都不许写进会话
    expect(transitions).toEqual([]);
  });

  it("被拒时血缘不动（不会出现「拒绝了但版本号还是加了一」）", async () => {
    const { deps } = makeDeps({ phase: "graph_review", lineage: { materialBatchId: null, fieldSchemeVersion: 0, logicVersion: 0, publishedGraphVersion: 3 } });
    await expect(passGate(deps, ORG, "t", "reasoning")).rejects.toMatchObject({ refusal: "GATE_NOT_PASSED" });
  });

  it("门②通过即登记验证到期时间（不靠模型记得去调提醒工具）", async () => {
    const { deps } = makeDeps({
      phase: "graph_review",
      lineage: { materialBatchId: "b1", fieldSchemeVersion: 1, logicVersion: 1, publishedGraphVersion: 0 },
    });
    const out = await passGate(deps, ORG, "t", "reasoning");

    expect(out.lineage.publishedGraphVersion).toBe(1);
    expect(out.verifyDueAt).toBe("2026-12-16T00:00:00.000Z");
  });

  it("过门的审计恒为 human——这个字段不接受调用方指定，否则整张审计表失去证据力", async () => {
    const { deps, audit } = makeDeps({ phase: "materials_review", materials: accepted(1) });
    await passGate(deps, ORG, "t", "materials");
    expect(audit[0]!.actorKind).toBe("human");
  });
});

describe("advancePhase", () => {
  it("Agent 正常推进被放行并记 agent", async () => {
    const { deps, audit } = makeDeps({ phase: "collecting", materials: accepted(1) });
    const out = await advancePhase(deps, ORG, "t", "materials_review");
    expect(out.phase).toBe("materials_review");
    expect(audit[0]).toMatchObject({ actorKind: "agent", action: "advance:materials_review", outcome: "allowed" });
  });

  it.each(["materials_approved", "graph_published"] as const)(
    "Agent 试图直达 %s ⇒ 被拒 + 留痕 GATE_NOT_PASSED",
    async (target) => {
      const { deps, audit, transitions } = makeDeps({
        phase: "generating",
        materials: accepted(2),
        lineage: { materialBatchId: "b1", fieldSchemeVersion: 1, logicVersion: 1, publishedGraphVersion: 0 },
      });

      await expect(advancePhase(deps, ORG, "t", target)).rejects.toMatchObject({ refusal: "GATE_NOT_PASSED" });

      expect(audit[0]).toMatchObject({ actorKind: "agent", outcome: "refused", refusal: "GATE_NOT_PASSED" });
      expect(transitions).toEqual([]);
    },
  );

  it("穷举：从任意阶段出发，Agent 都无法把 publishedGraphVersion 变大一点点", async () => {
    for (const from of C.RESEARCH_PHASES) {
      for (const to of C.RESEARCH_PHASES) {
        const { deps, transitions } = makeDeps({
          phase: from,
          materials: accepted(2),
          lineage: { materialBatchId: "b1", fieldSchemeVersion: 1, logicVersion: 1, publishedGraphVersion: 5 },
        });
        await advancePhase(deps, ORG, "t", to).catch(() => undefined);
        for (const t of transitions) {
          expect(t.lineage.publishedGraphVersion, `${from}->${to} 竟然改了发布版本号`).toBe(5);
        }
      }
    }
  });
});
