import { describe, expect, it } from "vitest";
import {
  submitBlueprintChangeRequestUseCase,
  SubmitChangeRequestError,
  canSubmitChangeRequest,
} from "../../src/application/templates/submit-blueprint-change-request";
import type { SubmitChangeRequestRepository } from "../../src/application/templates/submit-change-request-ports";
import type { PendingChangeRecord } from "../../src/domain/templates/pending-change";
import type { Deviation } from "../../src/domain/templates/deviation-diff";
import { toOrgId } from "../../src/domain/org-id";

/**
 * F29 —— **提交 ≠ 生效**（`uc-2-3` R7 逐字 / I-10 / V3）。
 *
 * 三条性质：
 *   ① 提交回提**只新增待审改动记录**，蓝本内容与版本号**均未变**——
 *      仓储端口的形状本身就没有能碰到蓝本表的入参，这里断言假仓储真的从未被
 *      要求接触任何"蓝本"或"版本"相关的东西。
 *   ② 理由必填（V4）：不填理由的提交被拒绝，且不产生任何记录。
 *   ③ 未勾选的偏离项不产生任何蓝本侧记录；`pendingNotice` 明示"已提交，等待…审阅"（A1）。
 */

const deviations: Deviation[] = [
  { designFacetKey: "flow-agenda", beforeValue: "3 segments", afterValue: "4 segments" },
  { designFacetKey: "survey", beforeValue: "old survey", afterValue: "new survey" },
];

function makeDeps() {
  const created: PendingChangeRecord[] = [];
  let idSeq = 0;
  const repo: SubmitChangeRequestRepository = {
    async create(_orgId, records) {
      created.push(...records);
      return records;
    },
  };
  return {
    deps: {
      repo,
      ids: { next: () => `cr-${++idSeq}` },
      clock: { now: () => "2026-08-01T00:00:00.000Z" },
    },
    created,
  };
}

describe("① 提交只新增记录，不改蓝本内容/版本（I-10）", () => {
  it("SubmitChangeRequestRepository 的端口形状里没有任何字段能表达'改蓝本'", () => {
    // 类型层面的断言：create() 的参数是 PendingChangeRecord[]，不含 blueprint content/version 字段
    const sample: PendingChangeRecord = {
      changeRequestId: "cr-x",
      blueprintId: "bp-1",
      designFacetKey: "flow-agenda",
      beforeValue: "a",
      afterValue: "b",
      sourceProjectId: "p-1",
      proposedBy: "u-1",
      proposedAt: "2026-08-01T00:00:00.000Z",
      rationale: "现场验证过更合理",
      baseVersionId: "v-1",
      status: "pending",
    };
    expect(Object.keys(sample).sort()).not.toContain("content");
    expect(Object.keys(sample).sort()).not.toContain("versionNumber");
  });

  it("提交后：只调用了 repo.create 一次，产生的记录 status 恒为 pending，不是 merged", async () => {
    const { deps, created } = makeDeps();
    const out = await submitBlueprintChangeRequestUseCase(deps, {
      actorProjectRole: "facilitator",
      actorId: "u-1",
      orgId: toOrgId("org-1"),

      projectId: "p-1",
      blueprintId: "bp-1",
      baseVersionId: "v-1",
      deviations,
      selections: [{ designFacetKey: "flow-agenda", rationale: "现场验证过更合理" }],
    });

    expect(created).toHaveLength(1);
    expect(created[0]!.status).toBe("pending");
    expect(created[0]!.beforeValue).toBe("3 segments");
    expect(created[0]!.afterValue).toBe("4 segments");
    expect(out.changeRequestIds).toEqual(["cr-1"]);
  });

  it("pendingNotice 明示'已提交，等待…审阅'，不是看起来像成功的 {ok:true}（A1）", async () => {
    const { deps } = makeDeps();
    const out = await submitBlueprintChangeRequestUseCase(deps, {
      actorProjectRole: "facilitator",
      actorId: "u-1",
      orgId: toOrgId("org-1"),

      projectId: "p-1",
      blueprintId: "bp-1",
      baseVersionId: "v-1",
      deviations,
      selections: [{ designFacetKey: "flow-agenda", rationale: "理由" }],
    });
    expect(out.pendingNotice).toContain("已提交");
    expect(out.pendingNotice).toContain("审阅");
  });
});

describe("② 理由必填（V4）", () => {
  it("空理由的提交被拒绝为 RATIONALE_REQUIRED，且不产生任何记录", async () => {
    const { deps, created } = makeDeps();
    await expect(
      submitBlueprintChangeRequestUseCase(deps, {
        actorProjectRole: "facilitator",
        actorId: "u-1",
        orgId: toOrgId("org-1"),

        projectId: "p-1",
        blueprintId: "bp-1",
        baseVersionId: "v-1",
        deviations,
        selections: [{ designFacetKey: "flow-agenda", rationale: "" }],
      }),
    ).rejects.toMatchObject({ reasonCode: "RATIONALE_REQUIRED" } satisfies Partial<SubmitChangeRequestError>);
    expect(created).toHaveLength(0);
  });

  it("纯空白理由同样视为未填", async () => {
    const { deps, created } = makeDeps();
    await expect(
      submitBlueprintChangeRequestUseCase(deps, {
        actorProjectRole: "facilitator",
        actorId: "u-1",
        orgId: toOrgId("org-1"),

        projectId: "p-1",
        blueprintId: "bp-1",
        baseVersionId: "v-1",
        deviations,
        selections: [{ designFacetKey: "flow-agenda", rationale: "   " }],
      }),
    ).rejects.toMatchObject({ reasonCode: "RATIONALE_REQUIRED" });
    expect(created).toHaveLength(0);
  });
});

describe("③ 未勾选的偏离项不产生任何蓝本侧记录", () => {
  it("两条偏离，只勾选一条：只产生 1 条待审记录", async () => {
    const { deps, created } = makeDeps();
    await submitBlueprintChangeRequestUseCase(deps, {
      actorProjectRole: "facilitator",
      actorId: "u-1",
      orgId: toOrgId("org-1"),

      projectId: "p-1",
      blueprintId: "bp-1",
      baseVersionId: "v-1",
      deviations,
      selections: [{ designFacetKey: "survey", rationale: "问卷这版更贴近本场" }],
    });
    expect(created).toHaveLength(1);
    expect(created[0]!.designFacetKey).toBe("survey");
  });
});

describe("④ 权限门槛：只有引导师能提交", () => {
  it("canSubmitChangeRequest 只认 facilitator", () => {
    expect(canSubmitChangeRequest("facilitator")).toBe(true);
    expect(canSubmitChangeRequest("groupLead")).toBe(false);
    expect(canSubmitChangeRequest("member")).toBe(false);
    expect(canSubmitChangeRequest("observer")).toBe(false);
    expect(canSubmitChangeRequest(null)).toBe(false);
  });

  it("无项目角色 ⇒ NO_PROJECT_ROLE", async () => {
    const { deps } = makeDeps();
    await expect(
      submitBlueprintChangeRequestUseCase(deps, {
        actorProjectRole: null,
        actorId: "u-1",
        orgId: toOrgId("org-1"),

        projectId: "p-1",
        blueprintId: "bp-1",
        baseVersionId: "v-1",
        deviations,
        selections: [{ designFacetKey: "flow-agenda", rationale: "理由" }],
      }),
    ).rejects.toMatchObject({ reasonCode: "NO_PROJECT_ROLE" });
  });

  it("非引导师角色（如 observer）⇒ ROLE_INSUFFICIENT", async () => {
    const { deps } = makeDeps();
    await expect(
      submitBlueprintChangeRequestUseCase(deps, {
        actorProjectRole: "observer",
        actorId: "u-1",
        orgId: toOrgId("org-1"),

        projectId: "p-1",
        blueprintId: "bp-1",
        baseVersionId: "v-1",
        deviations,
        selections: [{ designFacetKey: "flow-agenda", rationale: "理由" }],
      }),
    ).rejects.toMatchObject({ reasonCode: "ROLE_INSUFFICIENT" });
  });
});
