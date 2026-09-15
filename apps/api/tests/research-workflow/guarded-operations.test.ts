/**
 * 可见性前置 —— **穷举每一个对外操作**，而不是挑两个试试。
 *
 * 这份测试的形状是刻意的：它从模块导出里**列举**所有操作，逐个断言"看不见就拒"。
 * 将来有人加第七个操作却忘了写 `assertVisible`，这里会红——因为新操作会自动进入
 * 被测集合，而不是等谁记得补一条用例。
 *
 * 这一点关系不小：读漏可见性是泄露，**写漏是越权改流程状态**——
 * 任何知道 threadId 的人都能替别人点掉"人工确认"，门就形同虚设。
 */
import { describe, expect, it, vi } from "vitest";
import * as ops from "../../src/application/research-workflow/guarded-operations";
import { ThreadNotVisibleError } from "../../src/application/chat/get-thread";

const ORG = "org-1" as never;
const ACTOR = { userId: "u1", orgId: ORG, projectId: null, threadId: "t1" } as const;

/** 每个对外操作 → 一次调用。加了新操作忘了登记，下面那条"覆盖完整"会红。 */
const CALLS: Record<string, (deps: never) => Promise<unknown>> = {
  readSession: (d) => ops.readSession(d, ACTOR),
  addMaterials: (d) => ops.addMaterials(d, ACTOR, [{ source: "paste", label: "x" }]),
  reviewMaterial: (d) => ops.reviewMaterial(d, ACTOR, "m1", "accepted", null),
  passGateGuarded: (d) => ops.passGateGuarded(d, ACTOR, "materials"),
  advancePhaseGuarded: (d) => ops.advancePhaseGuarded(d, ACTOR, "collecting"),
  readAudit: (d) => ops.readAudit(d, ACTOR),
  listPredictions: (d) => ops.listPredictions(d, ACTOR),
  addPredictions: (d) => ops.addPredictions(d, ACTOR, ["2027 年国产 EDA 覆盖 3 个环节"]),
  fillPrediction: (d) => ops.fillPrediction(d, ACTOR, "p1", "只覆盖 1 个", "partial", "execution"),
};

const SESSION = {
  threadId: "t1", phase: "materials_review" as const,
  lineage: { materialBatchId: null, fieldSchemeVersion: 0, logicVersion: 0, publishedGraphVersion: 0 },
  materials: [{ id: "m1", source: "paste" as const, label: "x", verdict: "accepted" as const, note: null, attempts: 0, createdAt: "2026-09-16T00:00:00.000Z" }],
  verifyDueAt: null, updatedAt: "2026-09-16T00:00:00.000Z",
};

/**
 * 假依赖只替换**最外层的事实来源**（线程行、身份绑定行），不 mock 可见性判断本身——
 * 否则这份测试就变成"我 mock 了它返回拒绝，于是它拒绝了"，什么也没证明。
 * `resolveVisibility` 的真实代码在这里是真的跑过一遍的。
 */
function deps(visible: boolean) {
  const repo = {
    ensureSession: vi.fn(async () => SESSION),
    addMaterials: vi.fn(async () => SESSION),
    setMaterialVerdict: vi.fn(async () => SESSION),
    bumpMaterialAttempts: vi.fn(async () => SESSION),
    applyTransition: vi.fn(async () => SESSION),
    appendAudit: vi.fn(async () => undefined),
    listAudit: vi.fn(async () => []),
    listPredictions: vi.fn(async () => []),
    addPredictions: vi.fn(async () => []),
    fillPrediction: vi.fn(async () => []),
  };
  // authorize 真的会跑：给它一个"组织成员、无额外绑定"的常规身份，好让任何拒绝
  // 都只可能来自线程归属判定，而不是来自我顺手把组织层配成了拒绝。
  const identity = {
    findOrgMembership: vi.fn(async () => ({ userId: "u1", orgId: ORG, orgRole: "member" })),
    findProjectMembership: vi.fn(async () => null),
    findBindings: vi.fn(async () => new Map()),
  };
  return {
    repo,
    deps: {
      research: repo,
      repo: identity,
      ids: { next: () => "d1" },
      chat: {
        findThreadFacts: vi.fn(async () =>
          // 不可见的造法是**真实的那一种**：线程存在，但创建者是别人
          // （`resolvePersonalVisibility` 门②：非创建者与"不存在"同一出口）。
          visible
            ? { id: "t1", projectId: null, createdBy: "u1", archived: false, visibilityScope: "private" }
            : { id: "t1", projectId: null, createdBy: "someone-else", archived: false, visibilityScope: "private" },
        ),
      },
      uuid: { next: () => "b1" },
      now: () => new Date("2026-09-16T00:00:00.000Z"),
      // 研判仓储挂在 `repo` 这个名字上（见 PassGateDeps），与 identity 的 `repo`
      // 同名冲突 —— guarded-operations 的 deps 是两个接口的交集，这里如实拼出来。
    } as never,
  };
}

describe("可见性前置", () => {
  it("被测操作集合覆盖了模块导出的全部操作（加了新操作忘登记 ⇒ 这里红）", () => {
    const exported = Object.keys(ops).filter((k) => typeof (ops as never as Record<string, unknown>)[k] === "function");
    expect(new Set(Object.keys(CALLS))).toEqual(new Set(exported));
  });

  it.each(Object.keys(CALLS))("%s 在线程不可见时被拒，且一个字都没写进仓储", async (name) => {
    const { deps: d, repo } = deps(false);
    await expect(CALLS[name]!(d)).rejects.toBeInstanceOf(ThreadNotVisibleError);

    for (const [method, fn] of Object.entries(repo)) {
      expect(fn, `不可见却调用了 repo.${method}`).not.toHaveBeenCalled();
    }
  });
});

describe("reviewMaterial", () => {
  it.each(["missing", "wrong"] as const)(
    "判为 %s 时顺带把重采次数加一（标注缺失/错误与要求重采是同一个动作的两面）",
    async (verdict) => {
      const { deps: d, repo } = deps(true);
      await ops.reviewMaterial(d, ACTOR, "m1", verdict, "缺 2027 那段");
      expect(repo.setMaterialVerdict).toHaveBeenCalledOnce();
      expect(repo.bumpMaterialAttempts).toHaveBeenCalledOnce();
    },
  );

  it.each(["accepted", "pending"] as const)("判为 %s 时不动重采次数", async (verdict) => {
    const { deps: d, repo } = deps(true);
    await ops.reviewMaterial(d, ACTOR, "m1", verdict, null);
    expect(repo.bumpMaterialAttempts).not.toHaveBeenCalled();
  });
});
