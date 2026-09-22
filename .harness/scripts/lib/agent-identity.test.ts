/**
 * #1142：身份命名空间的反证，跑在**仓库的真实文件**上而不是 fixture。
 *
 * 理由：这道门的失效方式不是「判定逻辑写错」（那由 feature-owner.test.ts 的纯函数
 * 反证守着），而是「registry.yaml 的结构变了，读出来是空集」——那一刻每一个 owner
 * 都会被判成非法，整个 doctor 变成一片红，而每条红都长得像真的。
 * 这两条是那个失效模式的反证，必须读真文件才有意义。
 */
import { describe, it, expect } from "vitest";
import { readRegistryIdentities, readSubagentSpecIdentities, readKnownAgentIdentities } from "./agent-identity";

describe("readRegistryIdentities —— registry.yaml 的全部身份分组", () => {
  it("反证：agents: 分组读得到（coord-main 是主协调者，registry 里一定有）", () => {
    expect(readRegistryIdentities().has("coord-main")).toBe(true);
  });

  // 拆掉「扫描所有数组顶层键」改回只读 `agents:` ⇒ 本条红。
  // 这正是 role-scorecard 第一版踩过的坑：reviewers 被误判成「不在 registry」。
  it("反证：reviewers: 分组同样读得到（rev-feature 在 reviewers 下，不在 agents 下）", () => {
    expect(readRegistryIdentities().has("rev-feature")).toBe(true);
  });

  it("active: false 不会被吞掉，缺省视为在编", () => {
    const ident = readRegistryIdentities().get("coord-main");
    expect(ident?.active).toBe(true);
    expect(ident?.kind).toBe("coordinator");
  });
});

describe("readSubagentSpecIdentities —— 便携 subagent 规格也是合法身份来源", () => {
  // 拆掉这个来源 ⇒ 本条红。rev-uiux 只有 .harness/agents/rev-uiux.yaml，
  // 它根本不需要 registry 那套授权凭据——只认 registry 会把它误判成不存在。
  it("反证：rev-uiux 只在 .harness/agents/*.yaml 里，也是真实身份", () => {
    expect(readSubagentSpecIdentities().has("rev-uiux")).toBe(true);
  });

  it("registry.yaml 自己不会被当成一份 subagent 规格", () => {
    expect(readSubagentSpecIdentities().has("registry")).toBe(false);
  });
});

describe("readKnownAgentIdentities —— 并集", () => {
  it("两个来源都在里面，且不会退化成空集", () => {
    const known = readKnownAgentIdentities();
    expect(known.has("coord-main")).toBe(true);   // registry
    expect(known.has("rev-uiux")).toBe(true);     // subagent 规格
    expect(known.has("rev-feature")).toBe(true);  // registry 的 reviewers 分组
    // 空集是这道门最危险的失效形态：它会把每一个 owner 都判成非法。
    expect(known.size).toBeGreaterThan(10);
  });

  it("编造的把手不在命名空间里（#1142 的 sprint 期一次性把手正是这一档）", () => {
    const known = readKnownAgentIdentities();
    expect(known.has("w2-chat4")).toBe(false);
    expect(known.has("agt_01KZRABCZ99M2NGN20C7YWEASG")).toBe(false);
  });
});
