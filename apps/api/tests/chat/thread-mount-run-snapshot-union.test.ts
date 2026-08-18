/**
 * #1559 —— 「线程挂载 ∪ agent 版本自带」这条合并语义的单元门。
 *
 * ## 为什么它不能只靠 e2e
 *
 * `chat-agent-skill-context.spec.ts` 那条真栈反证跑的夹具里，agent 版本自带的
 * `skill_version_ids` 恰好是空数组 —— 于是「agent 自带在前、挂载追加在后」和
 * 「同一个版本两边都有时去重」这两条在那条链上**根本走不到**。把它们留给
 * 「读代码看得出来」，正是本仓反复记录的那种「规范有、门控没有」。
 *
 * 三条语义各有一条断言，且每条都能红：
 *   · 并集（不是覆盖）—— UC-3.3 是「临时**加减**」，`unmount` 只撤销自己加过的。
 *   · 顺序 —— ordering 是 `skillVersionIds` 的语义属性（`execute-run.ts` 的
 *     `buildSystemPrompt` 头注：按快照顺序拼 system prompt）。
 *   · 去重 —— 同一份 `SKILL.md` 不该在 system prompt 里出现两遍。
 */
import { describe, expect, it } from "vitest";
import { withThreadMounts } from "../../src/application/chat/message-roundtrip";
import type { PublishedAgentSnapshot } from "../../src/application/chat/message-command-ports";

function snapshot(skillVersionIds: readonly string[]): PublishedAgentSnapshot {
  return {
    agentId: "agent-1",
    agentVersionId: "agent-1-v1",
    skillVersionIds,
    modelProvider: "test-provider",
    modelId: "test-model",
    instructions: "irrelevant to this file",
  };
}

describe("#1559 run 快照 = agent 自带 ∪ 线程挂载", () => {
  it("并集：agent 自带的那些一个都不少（挂载是「加」，不是「换」）", () => {
    const merged = withThreadMounts(snapshot(["agent-skill-a", "agent-skill-b"]), ["mounted-c"]);
    // 覆盖语义会让这条红：那时结果只有 ["mounted-c"]。
    expect(merged.skillVersionIds).toContain("agent-skill-a");
    expect(merged.skillVersionIds).toContain("agent-skill-b");
    expect(merged.skillVersionIds).toContain("mounted-c");
  });

  it("顺序：agent 自带**在前**、线程挂载**追加在后**，各自内部原序不变", () => {
    const merged = withThreadMounts(
      snapshot(["agent-skill-a", "agent-skill-b"]),
      ["mounted-c", "mounted-d"],
    );
    // 断言的是完整序列而不是「包含」——「包含」对任何排序都成立，证明不了 ordering。
    expect(merged.skillVersionIds)
      .toEqual(["agent-skill-a", "agent-skill-b", "mounted-c", "mounted-d"]);
  });

  it("去重：同一个版本两边都有时只留一份，且留在 agent 自带的那个位置上", () => {
    const merged = withThreadMounts(
      snapshot(["shared", "agent-only"]),
      ["mounted-first", "shared"],
    );
    expect(merged.skillVersionIds).toEqual(["shared", "agent-only", "mounted-first"]);
    expect(merged.skillVersionIds.filter((id) => id === "shared")).toHaveLength(1);
  });

  it("没有任何挂载时，快照逐字段等同 agent 版本自己（不引入任何差异）", () => {
    const base = snapshot(["agent-skill-a"]);
    const merged = withThreadMounts(base, []);
    expect(merged).toEqual(base);
  });

  it("agent 自带为空时，run 就跑挂载的那些（这正是 #1559 之前恒为空的那条）", () => {
    expect(withThreadMounts(snapshot([]), ["mounted-c"]).skillVersionIds).toEqual(["mounted-c"]);
  });
});
