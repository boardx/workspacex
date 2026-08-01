import { describe, expect, it } from "vitest";
import {
  applyAiRound,
  hashContent,
  isAvaAuthored,
  rollbackAiRound,
  type AiRoundVersionSnapshot,
} from "../../src/domain/canvas/ai-round-rollback";

/**
 * F106 — AVA 角标 + 轮次级原子回滚（D-10 / I-24）。
 *
 * ## 这份测试在防什么
 *
 * ① **AVA 角标可分辨**：一轮 AI 落笔产生的每条便签，`authorRef` 都带着具体 agent
 *    （不是「AI 落笔了但角标是个占位符」），且与人工便签在同一份 `stickies` 列表里
 *    能用 `isAvaAuthored` 逐条区分——这不是界面画的一层皮，是数据形状本身的断言。
 * ② **回滚是原子的**（I-24）：回滚后内容与落笔前**逐字节一致**——直接对 `content`
 *    字符串做全等比较，而不是「差不多」或「结构上等价」。
 * ③ **部分成功 ⟹ 整轮不落笔**：一轮内若有一条便签写入失败，断言返回的版本与
 *    `baseVersion` 是同一个对象（同引用），不存在「补了 2 张、第 3 张失败」的半成品——
 *    用引用相等而不只是内容相等，是为了堵住「深拷贝一份看起来一样但其实是新对象」
 *    这种实现仍然让某些字段半写的漏洞。
 * ④ **该轮之后已被超越 ⟹ 拒绝直接回滚**（`AI_ROUND_SUPERSEDED`），不是回滚到某个
 *    介于两者之间的折中状态——断言拒绝时完全不触碰 `content`。
 */

function baseVersion(): AiRoundVersionSnapshot {
  const content = "human-1\thuman:alice\t人工写的原始内容";
  return {
    versionId: "v0",
    content,
    contentHash: hashContent(content),
    stickies: [{ stickyId: "human-1", authorRef: "human:alice", aiGenerated: false, text: "人工写的原始内容" }],
  };
}

describe("F106 · AVA 角标 + 轮次级原子回滚", () => {
  it("应用一轮：新增便签全部带 AVA 角标（authorRef = ava:<agentId>），与人工便签可分辨", () => {
    const base = baseVersion();
    const result = applyAiRound(base, "round-1", [
      { stickyId: "d1", agentId: "ava-canvas", text: "AI 起草的便签 A" },
      { stickyId: "d2", agentId: "ava-canvas", text: "AI 起草的便签 B" },
    ]);
    expect(result.outcome).toBe("applied");
    if (result.outcome !== "applied") throw new Error("unreachable");

    const ai = result.version.stickies.filter((s) => s.stickyId === "d1" || s.stickyId === "d2");
    expect(ai).toHaveLength(2);
    for (const s of ai) {
      expect(isAvaAuthored(s)).toBe(true);
      expect(s.authorRef).toBe("ava:ava-canvas");
    }
    const human = result.version.stickies.find((s) => s.stickyId === "human-1")!;
    expect(isAvaAuthored(human)).toBe(false);
  });

  it("一条写入失败 ⟹ 整轮不落笔：返回的版本与 baseVersion 是同一对象，没有半成品", () => {
    const base = baseVersion();
    const result = applyAiRound(base, "round-2", [
      { stickyId: "d1", agentId: "ava-canvas", text: "这条会成功" },
      { stickyId: "d2", agentId: "ava-canvas", text: "" }, // 空文本 = 该条写入失败
      { stickyId: "d3", agentId: "ava-canvas", text: "这条也不该落笔" },
    ]);
    expect(result.outcome).toBe("rolled-back");
    expect(result.version).toBe(base); // 同引用——不是「深拷贝出一份内容相同的对象」
    expect(result.version.stickies).toHaveLength(1); // 仍只有那条人工便签，d1/d3 都没进去
  });

  it("回滚后内容与落笔前逐字节一致（I-24 原子性）", () => {
    const base = baseVersion();
    const applied = applyAiRound(base, "round-3", [{ stickyId: "d1", agentId: "ava-canvas", text: "AI 落笔" }]);
    expect(applied.outcome).toBe("applied");
    if (applied.outcome !== "applied") throw new Error("unreachable");

    const rollback = rollbackAiRound(base, applied.version, applied.version.versionId);
    expect(rollback.ok).toBe(true);
    if (!rollback.ok) throw new Error("unreachable");
    expect(rollback.content).toBe(base.content); // 全等字符串比较——逐字节一致
    expect(rollback.contentHash).toBe(base.contentHash);
    expect(rollback.restoredVersionId).toBe(base.versionId);
  });

  it("该轮之后已有更新版本（他人改动/后续轮次）⟹ 拒绝直接回滚，不触碰内容", () => {
    const base = baseVersion();
    const applied = applyAiRound(base, "round-4", [{ stickyId: "d1", agentId: "ava-canvas", text: "AI 落笔" }]);
    expect(applied.outcome).toBe("applied");
    if (applied.outcome !== "applied") throw new Error("unreachable");

    const laterHeadVersionId = "v-someone-edited-after-this-round";
    const rollback = rollbackAiRound(base, applied.version, laterHeadVersionId);
    expect(rollback).toEqual({ ok: false, code: "AI_ROUND_SUPERSEDED" });
  });

  it("hashContent 是确定性的纯函数：同内容同哈希、不同内容不同哈希", () => {
    expect(hashContent("同一份内容")).toBe(hashContent("同一份内容"));
    expect(hashContent("内容 A")).not.toBe(hashContent("内容 B"));
  });
});
