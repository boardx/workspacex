import { describe, expect, it } from "vitest";
import {
  mergePendingChangeUseCase,
  MergePendingChangeError,
} from "../../src/application/templates/merge-pending-change";
import type { MergePendingChangeRepository, MergeIntoDraftCommand } from "../../src/application/templates/merge-pending-change-ports";
import { canMergePendingChange, siblingsOnSameKey, type PendingChangeRecord } from "../../src/domain/templates/pending-change";
import type { ProvenanceAppendInput, ProvenanceWriter } from "../../src/application/provenance/ports";
import { toOrgId } from "../../src/domain/org-id";

/**
 * F29 —— **只有蓝本维护者能合并**（`uc-2-3` R3 步骤 4 / Backlog `edge` 原文 / V5）。
 *
 * 三条性质：
 *   ① 非维护者（含提出回提的引导师本人）调用一律拒绝为 `NOT_BLUEPRINT_MAINTAINER`，
 *      且拒绝路径**完全不触碰**蓝本草稿（`mergeIntoDraft` 未被调用），并写审计。
 *   ② 维护者调用成功：蓝本草稿被更新，且返回的 `traceable` 四要素齐全、非空（AC1/V1）。
 *   ③ 同一处被多场改过时并排显示各自理由，不自动择一（I-12/V6）。
 */

function changeRequest(overrides: Partial<PendingChangeRecord> = {}): PendingChangeRecord {
  return {
    changeRequestId: "cr-1",
    blueprintId: "bp-1",
    designFacetKey: "flow-agenda",
    beforeValue: "3 segments",
    afterValue: "4 segments",
    sourceProjectId: "p-1",
    proposedBy: "facilitator-1",
    proposedAt: "2026-08-01T00:00:00.000Z",
    rationale: "现场跑下来 4 段更合理",
    baseVersionId: "v-1",
    status: "pending",
    ...overrides,
  };
}

function makeDeps() {
  const mergedCommands: MergeIntoDraftCommand[] = [];
  const auditEvents: ProvenanceAppendInput[] = [];
  const repo: MergePendingChangeRepository = {
    async mergeIntoDraft(cmd) {
      mergedCommands.push(cmd);
    },
  };
  const provenance: ProvenanceWriter = {
    async append(input) {
      auditEvents.push(input);
      return `evt-${auditEvents.length}`;
    },
    async appendWithin(_session, input) {
      auditEvents.push(input);
      return `evt-${auditEvents.length}`;
    },
  };
  return { deps: { repo, provenance }, mergedCommands, auditEvents };
}

describe("① 非维护者一律拒绝，且不触碰蓝本草稿，写审计", () => {
  it("非维护者调用 ⇒ NOT_BLUEPRINT_MAINTAINER，mergeIntoDraft 从未被调用", async () => {
    const { deps, mergedCommands } = makeDeps();
    await expect(
      mergePendingChangeUseCase(deps, {
        orgId: toOrgId("org-1"),
        actorId: "some-other-user",
        isMaintainer: false,
        changeRequest: changeRequest(),
      }),
    ).rejects.toMatchObject({ reasonCode: "NOT_BLUEPRINT_MAINTAINER" } satisfies Partial<MergePendingChangeError>);
    expect(mergedCommands).toHaveLength(0);
  });

  it("含提出回提的引导师本人在内——同一 actorId 提出又尝试合并，仍按 isMaintainer 判定拒绝", async () => {
    const { deps, mergedCommands } = makeDeps();
    const cr = changeRequest({ proposedBy: "facilitator-1" });
    await expect(
      mergePendingChangeUseCase(deps, {
        orgId: toOrgId("org-1"),
        actorId: "facilitator-1", // 提出人本人尝试合并
        isMaintainer: false, // 提出人不是维护者
        changeRequest: cr,
      }),
    ).rejects.toMatchObject({ reasonCode: "NOT_BLUEPRINT_MAINTAINER" });
    expect(mergedCommands).toHaveLength(0);
  });

  it("非维护者的尝试写入一条 unauthorized-attempt 审计事件", async () => {
    const { deps, auditEvents } = makeDeps();
    await expect(
      mergePendingChangeUseCase(deps, {
        orgId: toOrgId("org-1"),
        actorId: "some-other-user",
        isMaintainer: false,
        changeRequest: changeRequest(),
      }),
    ).rejects.toThrow();
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]!.type).toBe("unauthorized-attempt");
    expect(auditEvents[0]!.actorId).toBe("some-other-user");
    expect(auditEvents[0]!.detail).toMatchObject({ reasonCode: "NOT_BLUEPRINT_MAINTAINER" });
  });
});

describe("② 维护者合并成功：草稿更新 + 四要素可反查（AC1/V1）", () => {
  it("维护者调用 ⇒ 草稿被更新为 afterValue，且四要素缺一不可全部非空", async () => {
    const { deps, mergedCommands } = makeDeps();
    const cr = changeRequest();
    const out = await mergePendingChangeUseCase(deps, {
      orgId: toOrgId("org-1"),
      actorId: "maintainer-1",
      isMaintainer: true,
      changeRequest: cr,
    });

    expect(out.blueprintDraftUpdated).toBe(true);
    expect(mergedCommands).toHaveLength(1);
    expect(mergedCommands[0]).toEqual({
      blueprintId: "bp-1",
      changeRequestId: "cr-1",
      designFacetKey: "flow-agenda",
      afterValue: "4 segments",
    });

    // 四要素，缺一即失败——逐个非空断言
    expect(out.traceable.sourceProjectId).toBe("p-1");
    expect(out.traceable.proposedBy).toBe("facilitator-1");
    expect(out.traceable.proposedAt).toBe("2026-08-01T00:00:00.000Z");
    expect(out.traceable.rationale).toBe("现场跑下来 4 段更合理");
    for (const value of Object.values(out.traceable)) {
      expect(typeof value === "string" && value.length > 0).toBe(true);
    }
  });
});

describe("③ 同一处被多场改过时并排显示，不自动择一（I-12/V6）", () => {
  it("siblingsOnSameKey 找出同一 designFacetKey 的其它 pending 记录，原样并排", () => {
    const a = changeRequest({ changeRequestId: "cr-a", sourceProjectId: "p-1", rationale: "理由 A" });
    const b = changeRequest({ changeRequestId: "cr-b", sourceProjectId: "p-2", rationale: "理由 B" });
    const c = changeRequest({
      changeRequestId: "cr-c",
      designFacetKey: "survey", // 不同 key，不该出现
      sourceProjectId: "p-3",
      rationale: "理由 C",
    });
    const merged = changeRequest({ changeRequestId: "cr-d", status: "merged" }); // 已合并，不该出现

    const siblings = siblingsOnSameKey(a, [a, b, c, merged]);
    expect(siblings.map((r) => r.changeRequestId)).toEqual(["cr-b"]);
    expect(siblings[0]!.rationale).toBe("理由 B");
  });

  it("canMergePendingChange 是外部判定的直通消费，不自行猜测谁是维护者", () => {
    expect(canMergePendingChange(true)).toBe(true);
    expect(canMergePendingChange(false)).toBe(false);
  });
});
