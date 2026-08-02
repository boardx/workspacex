/**
 * F60 / I-46 / I-47 / V4 / V21 -- agent 互调调用链：深度上限 2（O-36 第 4 项），深度 3 在第
 * 3 层被终止并留痕；被调方不继承主调方权限，独立按三层权限求交（F56）。
 *
 * `user_visible_behavior`: 「agent 互调记录调用链与深度（上限 2，深度 3 在第 3 层被终止
 * 留痕），被调方不继承主调方权限、需批准的动作暂停等批准。」
 */
import { describe, expect, it } from "vitest";
import {
  CALL_CHAIN_MAX_DEPTH,
  CallDepthExceededError,
  AgentDisabledError,
  EffectivePermissionDeniedError,
  ProvenanceWriteFailedError,
  recordCallChainHop,
  type RecordCallChainHopInput,
} from "../../../src/domain/agent/call-chain";
import {
  intersectAgentPermission,
  type Layer1Fact,
  type Layer3Fact,
} from "../../../src/domain/agent/three-layer-permission";
import type { ToolWhitelistEntryT } from "../../../src/domain/agent/definition";

const grantedLayer1: Layer1Fact = { granted: true };
const deniedLayer1: Layer1Fact = { granted: false };
const grantedLayer3: Layer3Fact = { granted: true, taskId: "task-1" };

const calleeHasTool: ToolWhitelistEntryT = {
  toolFullName: "mcp:crm.searchAccount",
  state: "在授权范围内",
  elevationDecision: null,
};

const calleePermissionGranted = intersectAgentPermission({
  layer1: grantedLayer1,
  whitelistEntry: calleeHasTool,
  layer3: grantedLayer3,
});

function baseInput(over: Partial<RecordCallChainHopInput> = {}): RecordCallChainHopInput {
  return {
    callerAgentId: "agt-ava",
    calleeAgentId: "agt-ledger",
    taskName: "现金流对比",
    depth: 2,
    tokens: 412_000,
    requiresApproval: true,
    calleeRunning: true,
    calleePermission: calleePermissionGranted,
    ...over,
  };
}

describe("F60 O-36 第 4 项 -- 深度上限恒为 2", () => {
  it("阈值来自 thresholds.ts 的裁决值，等于 2", () => {
    expect(CALL_CHAIN_MAX_DEPTH).toBe(2);
  });
});

describe("F60 I-46 / V21 -- 深度 2 内允许，深度 3 在第 3 层被终止并留痕", () => {
  it("深度 1（原始调用本身）允许", () => {
    const writer = { write: () => ({ ok: true }) };
    const result = recordCallChainHop(baseInput({ depth: 1 }), writer);
    expect(result.chainId).toContain("d1");
  });

  it("深度 2（Ava → Ledger，原型逐字「深度 2」）允许", () => {
    const writer = { write: () => ({ ok: true }) };
    const result = recordCallChainHop(baseInput({ depth: 2 }), writer);
    expect(result.chainId).toContain("d2");
  });

  it("深度 3 ⇒ 抛 CallDepthExceededError（在第 3 层终止，不静默放行）", () => {
    const writer = { write: () => ({ ok: true }) };
    expect(() => recordCallChainHop(baseInput({ depth: 3 }), writer)).toThrow(
      CallDepthExceededError,
    );
  });

  it("深度超限时仍写审计留痕（终止不是静默的）", () => {
    const writes: unknown[] = [];
    const writer = {
      write: (event: unknown) => {
        writes.push(event);
        return { ok: true };
      },
    };
    expect(() => recordCallChainHop(baseInput({ depth: 3 }), writer)).toThrow();
    expect(writes).toHaveLength(1);
    expect((writes[0] as { kind: string }).kind).toBe("depth-exceeded");
  });

  it("深度超限且审计写入本身失败 ⇒ 抛 ProvenanceWriteFailedError 而不是 CallDepthExceededError（I-44 的调用链侧同款硬前置）", () => {
    const writer = { write: () => ({ ok: false }) };
    expect(() => recordCallChainHop(baseInput({ depth: 3 }), writer)).toThrow(
      ProvenanceWriteFailedError,
    );
  });
});

describe("F60 I-47 / V4 -- 被调方不继承主调方权限，独立按三层权限求交", () => {
  it("即使调用发生在合法深度内，被调方自己的三层权限求交被拒 ⇒ 整次互调仍被拒", () => {
    const calleeDenied = intersectAgentPermission({
      // 被调方自己的第①层：故意收紧，证明这不是从主调方继承来的判定
      layer1: deniedLayer1,
      whitelistEntry: calleeHasTool,
      layer3: grantedLayer3,
    });
    const writer = { write: () => ({ ok: true }) };
    expect(() =>
      recordCallChainHop(baseInput({ calleePermission: calleeDenied }), writer),
    ).toThrow(EffectivePermissionDeniedError);
  });

  it("给主调方一个被调方没有的工具授权，被调方仍无法使用它——拒绝理由指向被调方自身的三层权限（V4 原文场景）", () => {
    // 被调方白名单里没有这个工具（null），即使假设主调方本身被授权，也不构成被调方的授权。
    const calleeMissingTool = intersectAgentPermission({
      layer1: grantedLayer1,
      whitelistEntry: null,
      layer3: grantedLayer3,
    });
    expect(calleeMissingTool.allowed).toBe(false);
    expect(calleeMissingTool.deniedBy).toBe(2);

    const writer = { write: () => ({ ok: true }) };
    expect(() =>
      recordCallChainHop(baseInput({ calleePermission: calleeMissingTool }), writer),
    ).toThrow(EffectivePermissionDeniedError);
  });

  it("拒绝时仍写审计留痕，approvalState 为「已拒绝」", () => {
    const calleeDenied = intersectAgentPermission({
      layer1: deniedLayer1,
      whitelistEntry: calleeHasTool,
      layer3: grantedLayer3,
    });
    const writes: { approvalState: string }[] = [];
    const writer = {
      write: (event: { approvalState: string }) => {
        writes.push(event);
        return { ok: true };
      },
    };
    expect(() =>
      recordCallChainHop(baseInput({ calleePermission: calleeDenied }), writer),
    ).toThrow();
    expect(writes[0]?.approvalState).toBe("已拒绝");
  });
});

describe("F60 R3 步骤 4 -- 需批准的动作暂停等批准", () => {
  it("requiresApproval=true ⇒ approvalState = 已暂停", () => {
    const writer = { write: () => ({ ok: true }) };
    const result = recordCallChainHop(baseInput({ requiresApproval: true }), writer);
    expect(result.approvalState).toBe("已暂停");
  });

  it("反向断言：requiresApproval=false ⇒ 直接人已批准，不是恒暂停的实现", () => {
    const writer = { write: () => ({ ok: true }) };
    const result = recordCallChainHop(baseInput({ requiresApproval: false }), writer);
    expect(result.approvalState).toBe("人已批准");
  });
});

describe("F60 E4 -- 被调 agent 已不在运行中 ⇒ 调用被拒并留痕，主调方明确失败", () => {
  it("calleeRunning=false ⇒ 抛 AgentDisabledError（不静默换 agent）", () => {
    const writer = { write: () => ({ ok: true }) };
    expect(() => recordCallChainHop(baseInput({ calleeRunning: false }), writer)).toThrow(
      AgentDisabledError,
    );
  });
});
