/**
 * #2514（2026-09-02 人类裁决）—— 「agent 默认加载全部已启用 skill；具体 agent 的编排
 * 覆盖全局」这条解析规则的单元门。
 *
 * ## 为什么它不能只靠 e2e
 *
 * `copilotkit-v2-skill-mount.spec.ts` 那条真栈反证跑的夹具里，agent 版本自带的
 * `skill_version_ids` 恒为空——「钉了 skill 的 agent **覆盖**（而不是并入）全局列表」
 * 这条在那条链上根本走不到。把它留给「读代码看得出来」正是本仓反复记录的形状。
 *
 * 三条语义各有一条断言，且每条都能红：
 *   · 默认加载——agent 没钉时，run 用组织全部已启用 skill。
 *   · 覆盖，不是并集——agent 钉了时，全局列表一个都不进。
 *   · 空列表——组织一个已启用 skill 都没有、agent 也没钉时，run 就是空的（不伪造）。
 * 外加一条：线程挂载仍然是追加（旧轨道 `/chat/legacy` 保留），语义与 #1559 相同。
 */
import { describe, expect, it } from "vitest";
import { resolveRunSkillVersionIds } from "../../src/application/chat/message-roundtrip";

describe("#2514 run 快照 = (agent 自带 ?? 组织全部已启用) ∪ 线程挂载", () => {
  it("默认加载：agent 没钉任何 skill 时，run 加载组织全部已启用 skill，且保持库序", () => {
    const resolved = resolveRunSkillVersionIds({
      agentPinned: [],
      orgEnabled: ["org-skill-a", "org-skill-b", "platform-skill-c"],
      mounted: [],
    });
    // 断言完整序列而不是「包含」——顺序是 `buildSystemPrompt` 的语义属性。
    expect(resolved).toEqual(["org-skill-a", "org-skill-b", "platform-skill-c"]);
  });

  it("覆盖：agent 钉了 skill 时只用它钉的那些，全局列表一个都不进（不是并集）", () => {
    const resolved = resolveRunSkillVersionIds({
      agentPinned: ["curated-x"],
      orgEnabled: ["org-skill-a", "org-skill-b", "curated-x"],
      mounted: [],
    });
    // 并集语义会让这条红：那时结果里会多出 org-skill-a / org-skill-b。
    expect(resolved).toEqual(["curated-x"]);
    expect(resolved).not.toContain("org-skill-a");
  });

  it("空列表：组织没有任何已启用 skill、agent 也没钉时，run 就是空的，不伪造默认", () => {
    expect(resolveRunSkillVersionIds({ agentPinned: [], orgEnabled: [], mounted: [] })).toEqual([]);
  });

  it("线程挂载仍是追加：默认加载之后追加、去重（挂一个已经默认加载的 skill 是幂等的）", () => {
    const resolved = resolveRunSkillVersionIds({
      agentPinned: [],
      orgEnabled: ["org-skill-a", "org-skill-b"],
      mounted: ["org-skill-b", "mounted-c"],
    });
    expect(resolved).toEqual(["org-skill-a", "org-skill-b", "mounted-c"]);
  });

  it("线程挂载对钉了 skill 的 agent 是「在编排之上临时加一个」，而不是回落到全局", () => {
    const resolved = resolveRunSkillVersionIds({
      agentPinned: ["curated-x"],
      orgEnabled: ["org-skill-a"],
      mounted: ["mounted-c"],
    });
    expect(resolved).toEqual(["curated-x", "mounted-c"]);
  });
});
