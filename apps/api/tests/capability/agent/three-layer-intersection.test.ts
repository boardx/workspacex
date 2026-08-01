/**
 * F56 / I-27 / O-23 -- 三层权限求交：`有效权限 = ① MCP 授权范围 ∩ ② agent 工具白名单 ∩
 * ③ 任务权限包`，任一层收紧即生效，**下层不得放宽上层**，且拒绝时**可解释是哪一层**。
 *
 * `user_visible_behavior`: 「有效数据范围 = ① MCP 授权范围 ∩ ② agent 工具白名单 ∩ ③
 * 任务权限包 R1/R2/R3，任一层收紧即生效、下层不得放宽上层，服务端可解释"为什么被拒"」。
 *
 * ## Reverse assertions first (AGENTS.md 纪律)
 *
 * Three independent "this ONE layer denies while the other two grant" cases come before the
 * all-grant case -- an implementation that always returns `allowed: true` passes every
 * positive-only test suite, and would only get caught by a case built specifically to prove
 * a single tightened layer is sufficient to deny.
 */
import { describe, expect, it } from "vitest";
import { agentRuntime as A } from "@repo/contracts";
import {
  intersectAgentPermission,
  whitelistEntryGrants,
  type Layer1Fact,
  type Layer3Fact,
} from "../../../src/domain/agent/three-layer-permission";
import type { ToolWhitelistEntryT } from "../../../src/domain/agent/definition";

const grantedLayer1: Layer1Fact = { granted: true };
const deniedLayer1: Layer1Fact = { granted: false };
const grantedLayer3: Layer3Fact = { granted: true, taskId: "task-1" };
const deniedLayer3: Layer3Fact = { granted: false, taskId: "task-1" };

const inRangeEntry: ToolWhitelistEntryT = {
  toolFullName: "mcp:crm.searchAccount",
  state: "在授权范围内",
  elevationDecision: null,
};

describe("F56 I-27 -- 三层求交：任一层收紧即生效，下层不得放宽上层", () => {
  it("① 拒绝：即使②③都放行，整体仍被拒，且 deniedBy = 1", () => {
    const result = intersectAgentPermission({
      layer1: deniedLayer1,
      whitelistEntry: inRangeEntry,
      layer3: grantedLayer3,
    });
    expect(result.allowed).toBe(false);
    expect(result.deniedBy).toBe(1);
    expect(result.grantingLayers).toEqual([]);
    // ② and ③ are independently reported as granting -- the explanation is not just "denied",
    // it names which layer disagreed with the other two.
    expect(result.layer2.granted).toBe(true);
    expect(result.layer3.granted).toBe(true);
  });

  it("② 拒绝（工具不在白名单里）：即使①③都放行，整体仍被拒，且 deniedBy = 2", () => {
    const result = intersectAgentPermission({
      layer1: grantedLayer1,
      whitelistEntry: null,
      layer3: grantedLayer3,
    });
    expect(result.allowed).toBe(false);
    expect(result.deniedBy).toBe(2);
    expect(result.layer1.granted).toBe(true);
    expect(result.layer3.granted).toBe(true);
  });

  it("③ 拒绝（任务权限包未授权）：即使①②都放行，整体仍被拒，且 deniedBy = 3", () => {
    const result = intersectAgentPermission({
      layer1: grantedLayer1,
      whitelistEntry: inRangeEntry,
      layer3: deniedLayer3,
    });
    expect(result.allowed).toBe(false);
    expect(result.deniedBy).toBe(3);
    expect(result.layer1.granted).toBe(true);
    expect(result.layer2.granted).toBe(true);
  });

  it("三层全部放行 ⇒ 允许，且三层都出现在 grantingLayers 里（反向断言：不是恒拒绝的实现也会绿）", () => {
    const result = intersectAgentPermission({
      layer1: grantedLayer1,
      whitelistEntry: inRangeEntry,
      layer3: grantedLayer3,
    });
    expect(result.allowed).toBe(true);
    expect(result.deniedBy).toBeNull();
    expect(result.grantingLayers).toEqual(["mcp-scope", "whitelist", "task-package"]);
  });

  it("三层都拒绝时，deniedBy 恒为最上层（①），不是随意一层", () => {
    const result = intersectAgentPermission({
      layer1: deniedLayer1,
      whitelistEntry: null,
      layer3: deniedLayer3,
    });
    expect(result.deniedBy).toBe(1);
  });

  it("PermissionLayer 契约枚举与本模块使用的层名字面量一致（防止本模块另起一套命名）", () => {
    for (const name of ["mcp-scope", "whitelist", "task-package"]) {
      expect(A.PermissionLayer.safeParse(name).success).toBe(true);
    }
  });
});

describe("F56 I-29 -- whitelistEntryGrants：白名单条目本身的五态判定", () => {
  it("在授权范围内 ⇒ 授予", () => {
    expect(whitelistEntryGrants(inRangeEntry)).toBe(true);
  });

  it("越权申请待确认 ⇒ 不授予（尚未裁决完毕）", () => {
    const entry: ToolWhitelistEntryT = {
      toolFullName: "mcp:crm.exportAll",
      state: "越权申请待确认",
      elevationDecision: null,
    };
    expect(whitelistEntryGrants(entry)).toBe(false);
  });

  it("已否 ⇒ 不授予", () => {
    const entry: ToolWhitelistEntryT = {
      toolFullName: "mcp:crm.exportAll",
      state: "已否",
      elevationDecision: {
        verdict: "否",
        reason: "涉及客户机密，拒绝",
        securityReviewerSig: "sec-1",
        orgAdminSig: null,
      },
    };
    expect(whitelistEntryGrants(entry)).toBe(false);
  });

  it("签名已变更需重新确认 ⇒ 不授予（I-22，即使此前通过审核）", () => {
    const entry: ToolWhitelistEntryT = {
      toolFullName: "mcp:crm.searchAccount",
      state: "签名已变更需重新确认",
      elevationDecision: null,
    };
    expect(whitelistEntryGrants(entry)).toBe(false);
  });

  it("已准 但只有一条签名 ⇒ 不授予（I-29：两条签名缺一即流程不合规，不是「生效但标记一下」）", () => {
    const entry: ToolWhitelistEntryT = {
      toolFullName: "mcp:crm.exportAll",
      state: "已准",
      elevationDecision: {
        verdict: "准",
        reason: "已审阅",
        securityReviewerSig: "sec-1",
        orgAdminSig: null, // 缺一条
      },
    };
    expect(whitelistEntryGrants(entry)).toBe(false);
  });

  it("已准 且两条签名齐全 ⇒ 授予（反向断言：不是「已准恒不授予」的实现也会挡住这条）", () => {
    const entry: ToolWhitelistEntryT = {
      toolFullName: "mcp:crm.exportAll",
      state: "已准",
      elevationDecision: {
        verdict: "准",
        reason: "已审阅，风险可接受",
        securityReviewerSig: "sec-1",
        orgAdminSig: "admin-1",
      },
    };
    expect(whitelistEntryGrants(entry)).toBe(true);
  });

  it("null（工具完全不在白名单里）⇒ 不授予", () => {
    expect(whitelistEntryGrants(null)).toBe(false);
  });
});
