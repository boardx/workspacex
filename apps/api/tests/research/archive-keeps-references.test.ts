/**
 * F146 —— N-7：归档不是删除。归档后仍能被「已归档」标签筛出，且被引用的证据
 * 仍可解析（`research` 束 domain.md N-7，`uc-24-3` R7.3 / V4，
 * `packages/contracts/src/research.ts` `RESEARCH_FORBIDDEN_ROUTES` 注释逐字）。
 *
 * ⚠ 纯逻辑单测，不连数据库（issue #74：本地不跑任何需要 Postgres 的测试）。
 *
 * ## 两半都要断言（只测前半的实现会漏掉后半）
 *
 * `research.ts` 顶部注释逐字：「只断言『列表里筛得到』的实现会漏掉后半条」——
 * 后半条（被引证据在归档后仍可解析）才是 D-20「研究 Studio 是 09-kg 证据的
 * 主要生产者」这条立论的依据。本文件因此把两半拆成两个 describe 块，
 * 且专门加一个"两半同时成立"的联合断言，防止两半各自造不同的 fixture 而互相绕过。
 */
import { describe, expect, it } from "vitest";
import {
  archiveResearch,
  filterByArchived,
  resolveEvidenceById,
  type ArchivableResearch,
} from "../../src/domain/research/archive";

interface FixtureResearch extends ArchivableResearch {
  readonly title: string;
  readonly tags: readonly string[];
}

interface FixtureEvidence {
  readonly id: string;
  readonly researchId: string;
  readonly claim: string;
}

function makeItems(): FixtureResearch[] {
  return [
    { id: "r1", title: "德国工商储电价机制", archivedAt: null, tags: ["客户", "高优先级"] },
    { id: "r2", title: "欧洲并网审批流程", archivedAt: null, tags: ["客户"] },
    { id: "r3", title: "本地化率补贴口径（2023 版）", archivedAt: "2026-01-01T00:00:00.000Z", tags: ["内部"] },
  ];
}

function makeEvidence(): FixtureEvidence[] {
  return [
    { id: "e1", researchId: "r1", claim: "审批周期中位数 11 个月" },
    { id: "e2", researchId: "r1", claim: "材料一次过可省约 6 周" },
    { id: "e3", researchId: "r3", claim: "本地化率口径引用（来自已归档研究）" },
  ];
}

describe("F146 · N-7 前半：归档只置位 archivedAt，不从集合移除、不清空其余字段", () => {
  it("归档 r1 后：集合长度不变，r1 的其余字段（title/tags）原样保留", () => {
    const items = makeItems();
    const archivedAt = "2026-08-01T09:00:00.000Z";
    const after = archiveResearch(items, "r1", archivedAt);

    expect(after).toHaveLength(items.length);
    const r1 = after.find((r) => r.id === "r1")!;
    expect(r1.archivedAt).toBe(archivedAt);
    expect(r1.title).toBe("德国工商储电价机制");
    expect(r1.tags).toEqual(["客户", "高优先级"]);
    // 其余条目不受影响
    expect(after.find((r) => r.id === "r2")!.archivedAt).toBeNull();
  });

  it("归档后它仍能被「已归档」标签筛出（filterByArchived(true) 命中它）", () => {
    const items = makeItems();
    const after = archiveResearch(items, "r1", "2026-08-01T09:00:00.000Z");

    const archivedOnly = filterByArchived(after, true);
    expect(archivedOnly.map((r) => r.id).sort()).toEqual(["r1", "r3"]);

    const activeOnly = filterByArchived(after, false);
    expect(activeOnly.map((r) => r.id)).toEqual(["r2"]);

    // archived: null（不过滤）两者都要——归档不等于从"全部"视图消失
    const all = filterByArchived(after, null);
    expect(all).toHaveLength(3);
    expect(all.some((r) => r.id === "r1")).toBe(true);
  });

  it("反空转：归档前 r1 不在「已归档」筛选结果里——证明上面的断言不是凑巧命中", () => {
    const items = makeItems();
    const beforeArchived = filterByArchived(items, true);
    expect(beforeArchived.map((r) => r.id)).toEqual(["r3"]);
    expect(beforeArchived.some((r) => r.id === "r1")).toBe(false);
  });
});

describe("F146 · N-7 后半：被引用的证据在归档后仍可解析（D-20 的立论依据）", () => {
  it("r3 已归档，但它产出的证据 e3 依然能按 id 解析出来", () => {
    const evidenceStore = makeEvidence();
    const archivedResearchId = "r3";
    // 确认 fixture 本身就是"归档研究产出的证据"这个场景
    expect(makeItems().find((r) => r.id === archivedResearchId)!.archivedAt).not.toBeNull();

    const resolved = resolveEvidenceById(evidenceStore, "e3");
    expect(resolved, "已归档研究的证据不该解析不到——那是把归档实现成了删除").not.toBeUndefined();
    expect(resolved?.claim).toBe("本地化率口径引用（来自已归档研究）");
    expect(resolved?.researchId).toBe(archivedResearchId);
  });

  it("对一条本来未归档的研究执行归档动作后，它此前产出的证据依然可解析", () => {
    const items = makeItems();
    const evidenceStore = makeEvidence();

    // e1/e2 挂在 r1 上，此刻 r1 未归档
    expect(resolveEvidenceById(evidenceStore, "e1")).not.toBeUndefined();

    const afterArchive = archiveResearch(items, "r1", "2026-08-01T09:00:00.000Z");
    expect(afterArchive.find((r) => r.id === "r1")!.archivedAt).not.toBeNull();

    // 归档动作本身不触碰证据存储——e1/e2 在归档前后一样能解析
    expect(resolveEvidenceById(evidenceStore, "e1")?.claim).toBe("审批周期中位数 11 个月");
    expect(resolveEvidenceById(evidenceStore, "e2")?.claim).toBe("材料一次过可省约 6 周");
  });
});

describe("F146 · 两半同时成立（同一个 fixture 上联合断言，防止各自造数据互相绕过）", () => {
  it("归档 r1 之后：① 能被已归档筛选筛出 ② 它的证据 e1/e2 仍可解析，一次性成立", () => {
    const items = makeItems();
    const evidenceStore = makeEvidence();
    const archivedAt = "2026-08-01T09:00:00.000Z";

    const afterArchive = archiveResearch(items, "r1", archivedAt);

    // 前半
    expect(filterByArchived(afterArchive, true).map((r) => r.id)).toContain("r1");
    // 后半
    expect(resolveEvidenceById(evidenceStore, "e1")).not.toBeUndefined();
    expect(resolveEvidenceById(evidenceStore, "e2")).not.toBeUndefined();
  });
});

describe("F146 · N-7 的对照：本域没有 unarchive，也不该有硬删除的形状", () => {
  it("archiveResearch 找不到目标 id 时原样返回，不抛异常、不删除任何条目", () => {
    const items = makeItems();
    const after = archiveResearch(items, "not-exist", "2026-08-01T09:00:00.000Z");
    expect(after).toHaveLength(items.length);
    expect(after).toEqual(items);
  });

  it("resolveEvidenceById 查不到的 id 返回 undefined，而不是抛异常吞掉这个信号", () => {
    const evidenceStore = makeEvidence();
    expect(resolveEvidenceById(evidenceStore, "not-exist")).toBeUndefined();
  });
});
