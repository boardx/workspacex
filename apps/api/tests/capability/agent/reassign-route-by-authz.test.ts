/**
 * F58 -- 改派路由：判据是三层权限求交后的授权集（复用 F56 `intersectAgentPermission`），
 * 理由须写出具体授权名，改派必须人点 `[改派]` 确认。
 *
 * `user_visible_behavior`: 「这条更适合 Scout：它有行业数据库授权」…改派必须人点 [改派]、
 * [×] 可忽略；把行业数据库 MCP 置为已隔离后该建议不再出现。
 */
import { describe, expect, it } from "vitest";
import {
  suggestRedispatch,
  applyRedispatch,
  type RedispatchCandidate,
} from "../../../src/domain/agent/reassign-route";
import type {
  Layer1Fact,
  Layer3Fact,
} from "../../../src/domain/agent/three-layer-permission";
import type { ToolWhitelistEntryT } from "../../../src/domain/agent/definition";

const grantedLayer1: Layer1Fact = { granted: true };
const grantedLayer3: Layer3Fact = { granted: true, taskId: "task-1" };

const industryDbEntry: ToolWhitelistEntryT = {
  toolFullName: "mcp:industry-db.forecast",
  state: "在授权范围内",
  elevationDecision: null,
};

const scoutCandidate: RedispatchCandidate = {
  agentId: "agt-scout",
  authorityLabel: "行业数据库授权",
  permission: { layer1: grantedLayer1, whitelistEntry: industryDbEntry, layer3: grantedLayer3 },
};

describe("F58 -- suggestRedispatch：判据是三层求交后的授权集，理由是具体授权名", () => {
  it("① 当前 agent 因白名单未命中被拒（层②），候选三层全放行 ⇒ 建议改派给候选", () => {
    const result = suggestRedispatch({
      currentPermission: { layer1: grantedLayer1, whitelistEntry: null, layer3: grantedLayer3 },
      candidates: [scoutCandidate],
    });
    expect(result.suggestedAgentId).toBe("agt-scout");
    expect(result.reasonAuthorityName).toBe("行业数据库授权");
  });

  it("② 理由是具体授权名，不是模糊的「更合适」", () => {
    const result = suggestRedispatch({
      currentPermission: { layer1: grantedLayer1, whitelistEntry: null, layer3: grantedLayer3 },
      candidates: [scoutCandidate],
    });
    expect(result.reasonAuthorityName).not.toMatch(/更合适/);
    expect(result.reasonAuthorityName).toBe(scoutCandidate.authorityLabel);
  });

  it("③ 反向断言：当前 agent 本就三层全放行 ⇒ 无建议，即使候选也放行", () => {
    const result = suggestRedispatch({
      currentPermission: {
        layer1: grantedLayer1,
        whitelistEntry: industryDbEntry,
        layer3: grantedLayer3,
      },
      candidates: [scoutCandidate],
    });
    expect(result.suggestedAgentId).toBeNull();
    expect(result.reasonAuthorityName).toBeNull();
  });

  it("④ 把行业数据库 MCP 置为已隔离后（层①转拒绝）：该建议不再出现", () => {
    const quarantinedCandidate: RedispatchCandidate = {
      ...scoutCandidate,
      // 隔离 = 该 MCP 源层①不再放行 —— 不是本模块另开一个「已隔离」特判分支
      permission: { layer1: { granted: false }, whitelistEntry: industryDbEntry, layer3: grantedLayer3 },
    };
    const result = suggestRedispatch({
      currentPermission: { layer1: grantedLayer1, whitelistEntry: null, layer3: grantedLayer3 },
      candidates: [quarantinedCandidate],
    });
    expect(result.suggestedAgentId).toBeNull();
    expect(result.reasonAuthorityName).toBeNull();
  });

  it("⑤ 唯一候选也被拒绝 ⇒ 无建议，不回退到「随便建议一个」", () => {
    const deniedCandidate: RedispatchCandidate = {
      agentId: "agt-other",
      authorityLabel: "某授权",
      permission: { layer1: grantedLayer1, whitelistEntry: null, layer3: grantedLayer3 },
    };
    const result = suggestRedispatch({
      currentPermission: { layer1: grantedLayer1, whitelistEntry: null, layer3: grantedLayer3 },
      candidates: [deniedCandidate],
    });
    expect(result.suggestedAgentId).toBeNull();
  });

  it("⑥ 多个候选按顺序取第一个三层全放行的，不是任意一个", () => {
    const deniedFirst: RedispatchCandidate = {
      agentId: "agt-denied-first",
      authorityLabel: "某授权",
      permission: { layer1: grantedLayer1, whitelistEntry: null, layer3: grantedLayer3 },
    };
    const result = suggestRedispatch({
      currentPermission: { layer1: grantedLayer1, whitelistEntry: null, layer3: grantedLayer3 },
      candidates: [deniedFirst, scoutCandidate],
    });
    expect(result.suggestedAgentId).toBe("agt-scout");
  });
});

describe("F58 -- applyRedispatch：改派是建议，必须人点 [改派] 确认", () => {
  it("① accept: false（点了 [×]）⇒ 不应用，即使建议存在", () => {
    const result = applyRedispatch({ accept: false, suggestedAgentId: "agt-scout" });
    expect(result.applied).toBe(false);
    expect(result.newAgentId).toBeNull();
  });

  it("② accept: true 且建议存在 ⇒ 应用，newAgentId 是建议的那个", () => {
    const result = applyRedispatch({ accept: true, suggestedAgentId: "agt-scout" });
    expect(result.applied).toBe(true);
    expect(result.newAgentId).toBe("agt-scout");
  });

  it("③ 反向断言：accept: true 但建议已经是 null（条件已变化）⇒ 不应用，不是「有 accept 就硬改派」", () => {
    const result = applyRedispatch({ accept: true, suggestedAgentId: null });
    expect(result.applied).toBe(false);
    expect(result.newAgentId).toBeNull();
  });
});
