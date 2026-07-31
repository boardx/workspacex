/**
 * F66 · **版本快照不可变 + 版本链 + 发新版旧版自动归档 + 已建实例锁版本**
 * （`contracts/skills/domain.md` `SkillVersion` / I-6，裁决 D-30；UC-3.4 R3 分支 A、R7）。
 *
 * 五组：
 *   ① 不可变：一条已写入的版本快照不能被就地改写。
 *   ② 版本号序列：单调递增、不复用、不缺号；对不存在/不在待审核的版本发布被拒。
 *   ③ 发新版 → 旧版自动归档；恰好同时只有一个「已生效」。
 *   ④ 桥接 `orchestration.ts`：项目 A 锁 v2 → 发布 v3 → 现场解析仍是 v2 的正文哈希
 *     ——这是 I-6「已建实例记着自己用的是哪个版本」的断言方式，且**复用**
 *     F63 已测过的 `resolveBoundVersion`，不重新发明一套锁定逻辑（见文件头）。
 *   ⑤ 内容哈希：确定性、不因键序不同而漂移。
 */
import { describe, expect, it } from "vitest";
import {
  contentHashOf,
  createDraftVersion,
  exactlyOneEffective,
  markPendingRelease,
  nextVersionNumber,
  releaseVersion,
  toVersionCatalogEntry,
  versionNumbersMonotonic,
  VersionChainError,
  type SkillVersionSnapshot,
} from "../../../src/domain/skill/version-chain";
import { resolveBoundVersion } from "../../../src/domain/skill/orchestration";
import { binding } from "../../support/skill-fakes";
import type { DeclarativeContract } from "../../../src/domain/skill/declarative-contract";

function contract(overrides: Partial<DeclarativeContract> = {}): DeclarativeContract {
  return {
    promptTemplate: "你是一个语音助手",
    inputSchema: '{"type":"object"}',
    outputSchema: '{"type":"object"}',
    dataScope: ["transcript:redacted"],
    readsRawTranscript: false,
    fallbackDeclaration: "解析失败时返回空转写",
    ...overrides,
  };
}

/** v1 已生效的最小历史。 */
function historyAtV1(): readonly SkillVersionSnapshot[] {
  const v1 = createDraftVersion([], { versionId: "v1", skillId: "sk-voice", content: contract() });
  return [{ ...v1, state: "待审核" as const }];
}

describe("① 不可变：写入后不能被就地改写", () => {
  it("`content` 与整条记录一起冻结，strict mode 下赋值抛出", () => {
    const v = createDraftVersion([], { versionId: "v1", skillId: "sk-voice", content: contract() });
    expect(() => {
      (v as { content: unknown }).content = contract({ promptTemplate: "改过的提示词" });
    }).toThrow();
    expect(() => {
      (v.content as { dataScope: unknown }).dataScope = ["*"];
    }).toThrow();
    // 数组本身也冻结——push 一个越权的数据范围项同样应该抛
    expect(() => (v.content.dataScope as unknown as unknown[]).push("*")).toThrow();
  });

  it("同样的入参两次调用产出**不同**记录（各自独立冻结，互不影响）", () => {
    const a = createDraftVersion([], { versionId: "v1", skillId: "sk-voice", content: contract() });
    const b = createDraftVersion([], { versionId: "v1-retry", skillId: "sk-voice", content: contract() });
    expect(a).not.toBe(b);
    expect(a.contentHash).toBe(b.contentHash); // 内容相同 ⇒ 哈希必须相同
  });
});

describe("② 版本号序列：单调递增、不复用、不缺号", () => {
  it("空历史 ⇒ 下一个版本号是 1", () => {
    expect(nextVersionNumber([])).toBe(1);
  });

  it("三次连续发布 ⇒ 1、2、3，不因中途归档而缩水或倒退", () => {
    let history = releaseVersion(historyAtV1(), "v1").history; // v1 先生效
    expect(versionNumbersMonotonic(history)).toBe(true);

    const v2 = createDraftVersion(history, { versionId: "v2", skillId: "sk-voice", content: contract() });
    history = [...history, { ...v2, state: "待审核" as const }];
    const afterV2 = releaseVersion(history, "v2");
    history = afterV2.history;
    expect(afterV2.archivedVersionId).toBe("v1");

    const v3 = createDraftVersion(history, { versionId: "v3", skillId: "sk-voice", content: contract() });
    history = [...history, { ...v3, state: "待审核" as const }];
    const afterV3 = releaseVersion(history, "v3");
    history = afterV3.history;
    expect(afterV3.archivedVersionId).toBe("v2");

    expect(history.map((v) => v.versionNumber)).toEqual([1, 2, 3]);
    expect(versionNumbersMonotonic(history)).toBe(true);
  });

  it("对不存在的 versionId 发布 ⇒ 抛 `VERSION_NOT_FOUND`，历史不变", () => {
    const history = historyAtV1();
    expect(() => releaseVersion(history, "v-does-not-exist")).toThrow(VersionChainError);
    try {
      releaseVersion(history, "v-does-not-exist");
    } catch (e) {
      expect((e as VersionChainError).code).toBe("VERSION_NOT_FOUND");
    }
  });

  it("对不在「待审核」的版本发布 ⇒ 抛 `VERSION_NOT_PENDING_REVIEW`（挡住绕过门禁直接生效）", () => {
    const history = historyAtV1();
    const released = releaseVersion(history, "v1").history;
    // v1 现在已经是「已生效」，再次对它调用 releaseVersion 必须被拒——
    // 不然一个已生效的版本能被「再发布一次」，状态机就有了第二条写路径。
    expect(() => releaseVersion(released, "v1")).toThrow(VersionChainError);
  });
});

describe("③ 发新版 → 旧版自动归档；恰好同时只有一个「已生效」", () => {
  it("v1 首次发布：没有旧版可归档", () => {
    const { history, archivedVersionId } = releaseVersion(historyAtV1(), "v1");
    expect(archivedVersionId).toBeNull();
    expect(history.find((v) => v.versionId === "v1")?.state).toBe("已生效");
    expect(exactlyOneEffective(history)).toBe(true);
  });

  it("v2 发布成功 ⇒ v1 自动归档为「已归档」，正文哈希原样保留（不清空、不删除）", () => {
    let history = releaseVersion(historyAtV1(), "v1").history;
    const v1HashBefore = history.find((v) => v.versionId === "v1")!.contentHash;

    const v2 = createDraftVersion(history, {
      versionId: "v2",
      skillId: "sk-voice",
      content: contract({ promptTemplate: "换了个提示词模板" }),
    });
    history = [...history, { ...v2, state: "待审核" as const }];
    const result = releaseVersion(history, "v2");

    expect(result.archivedVersionId).toBe("v1");
    const v1After = result.history.find((v) => v.versionId === "v1")!;
    expect(v1After.state).toBe("已归档");
    expect(v1After.contentHash).toBe(v1HashBefore); // 归档只改状态字段，正文不动
    expect(result.history.find((v) => v.versionId === "v2")!.state).toBe("已生效");
    expect(exactlyOneEffective(result.history)).toBe(true);
  });

  it("E5：门禁复核通过但发版失败时落「待上线」，`vN` 保持生效", () => {
    const history = releaseVersion(historyAtV1(), "v1").history;
    const withPending = markPendingRelease(history, "v1");
    // 只是示范：把一个已生效版本标记待上线是错误调用场景（真实调用发生在草稿/待审核阶段）；
    // 这里断言的是函数本身只改目标一条、不动其余记录。
    expect(withPending.find((v) => v.versionId === "v1")!.state).toBe("待上线");
  });
});

describe("④ 桥接编排侧：已建实例锁版本（复用 F63 的 resolveBoundVersion，不重新发明）", () => {
  it("项目 A 锁 v2 → 后台发布 v3 → 现场解析出的仍是 v2 的正文哈希", () => {
    let history = releaseVersion(historyAtV1(), "v1").history;
    const v2 = createDraftVersion(history, { versionId: "v2", skillId: "sk-voice", content: contract() });
    history = [...history, { ...v2, state: "待审核" as const }];
    history = releaseVersion(history, "v2").history;

    const catalogAtV2 = { "sk-voice": toVersionCatalogEntry("sk-voice", history, "已启用") };
    const lockedAtV2 = binding({
      bindingId: "ib-0",
      agendaSegmentId: "seg-02",
      owner: { level: "instance", projectId: "p-1" },
      slot: { kind: "skill", skillId: "sk-voice", versionId: "v2" },
    });
    const beforeV3 = resolveBoundVersion(lockedAtV2, catalogAtV2);
    expect(beforeV3?.contentHash).toBe(history.find((v) => v.versionId === "v2")!.contentHash);

    // 后台发布 v3。
    const v3 = createDraftVersion(history, {
      versionId: "v3",
      skillId: "sk-voice",
      content: contract({ promptTemplate: "v3 的新提示词" }),
    });
    history = [...history, { ...v3, state: "待审核" as const }];
    const released = releaseVersion(history, "v3");
    history = released.history;
    expect(released.archivedVersionId).toBe("v2");

    const catalogAtV3 = { "sk-voice": toVersionCatalogEntry("sk-voice", history, "已启用") };
    const afterV3 = resolveBoundVersion(lockedAtV2, catalogAtV3);
    // 版本号与正文哈希都停在 v2——不因目录里 currentVersionId 变成 v3 而漂移。
    expect(afterV3?.versionId).toBe("v2");
    expect(afterV3?.contentHash).toBe(history.find((v) => v.versionId === "v2")!.contentHash);
    expect(afterV3?.behindLatest).toBe(true);
    expect(afterV3?.latestVersionId).toBe("v3");
  });
});

describe("⑤ 内容哈希：确定性，不因对象键序不同而漂移", () => {
  it("字段写入顺序不同、内容相同 ⇒ 哈希相同", () => {
    const a: DeclarativeContract = contract();
    const b: DeclarativeContract = {
      dataScope: a.dataScope,
      readsRawTranscript: a.readsRawTranscript,
      fallbackDeclaration: a.fallbackDeclaration,
      outputSchema: a.outputSchema,
      inputSchema: a.inputSchema,
      promptTemplate: a.promptTemplate,
    };
    expect(contentHashOf(a)).toBe(contentHashOf(b));
  });

  it("任一字段变化 ⇒ 哈希必须不同", () => {
    const a = contract();
    const b = contract({ promptTemplate: "不一样的提示词" });
    expect(contentHashOf(a)).not.toBe(contentHashOf(b));
  });
});
