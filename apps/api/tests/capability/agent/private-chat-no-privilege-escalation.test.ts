/**
 * F59 / AC2 / V2 -- 私聊不构成提权：三层权限（F56）与项目级 AI 权限在私聊中同样生效。
 *
 * `user_visible_behavior`: 「私聊仍受三层权限与项目级 AI 权限约束（请求白名单外工具被拒、
 * 项目级关掉画布落笔后私聊也不能落笔），不构成提权」。
 *
 * ## Reverse assertions first
 *
 * The risk this feature exists to prevent is specific: a private-chat-only code path that
 * grants something the main thread would deny. So before any "allowed" case, this file
 * asserts each of the three layers can independently deny a private-chat action -- an
 * implementation that hard-codes `allowed: true` for private chat passes zero of these.
 */
import { describe, expect, it } from "vitest";
import {
  authorizePrivateChatEntry,
  authorizePrivateChatAction,
  type PrivateChatActionInput,
} from "../../../src/domain/agent/private-chat";
import { intersectAgentPermission } from "../../../src/domain/agent/three-layer-permission";
import type { ToolWhitelistEntryT } from "../../../src/domain/agent/definition";
import type { AgentDefinition } from "../../../src/domain/agent/definition";

const inRangeEntry: ToolWhitelistEntryT = {
  toolFullName: "mcp:crm.searchAccount",
  state: "在授权范围内",
  elevationDecision: null,
};

const grantedAll: PrivateChatActionInput = {
  threeLayer: {
    layer1: { granted: true },
    whitelistEntry: inRangeEntry,
    layer3: { granted: true, taskId: "task-1" },
  },
  isCanvasWriteAction: false,
  projectCanvasWriteEnabled: true,
};

describe("F59 AC2 / V2 -- 私聊里的三层权限求交，与主线程逐字节相同", () => {
  it("反向断言：① MCP 授权范围拒绝 ⇒ 私聊里同样被拒（不是私聊独立放行）", () => {
    const result = authorizePrivateChatAction({
      ...grantedAll,
      threeLayer: { ...grantedAll.threeLayer, layer1: { granted: false } },
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("TOOL_NOT_WHITELISTED");
    expect(result.threeLayer.deniedBy).toBe(1);
  });

  it("反向断言：② 工具不在 agent 白名单里 ⇒ 私聊里同样被拒", () => {
    const result = authorizePrivateChatAction({
      ...grantedAll,
      threeLayer: { ...grantedAll.threeLayer, whitelistEntry: null },
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("TOOL_NOT_WHITELISTED");
    expect(result.threeLayer.deniedBy).toBe(2);
  });

  it("反向断言：③ 任务权限包未授权 ⇒ 私聊里同样被拒", () => {
    const result = authorizePrivateChatAction({
      ...grantedAll,
      threeLayer: { ...grantedAll.threeLayer, layer3: { granted: false, taskId: "task-1" } },
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("TOOL_NOT_WHITELISTED");
    expect(result.threeLayer.deniedBy).toBe(3);
  });

  it("私聊的求交结果与直接调用 intersectAgentPermission 完全一致（不是另一套等价但独立的实现）", () => {
    const direct = intersectAgentPermission(grantedAll.threeLayer);
    const viaPrivateChat = authorizePrivateChatAction(grantedAll);
    expect(viaPrivateChat.threeLayer).toEqual(direct);
  });

  it("三层全部放行且项目级画布开关无关（非画布动作）⇒ 允许", () => {
    const result = authorizePrivateChatAction(grantedAll);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeNull();
  });
});

describe("F59 R2 步骤 2 / V2 -- 项目级「AI 直接在小组画布落笔」关闭时私聊也不能落笔", () => {
  it("反向断言：三层权限全部放行，但项目级画布开关关闭 ⇒ 画布落笔动作仍被拒", () => {
    const result = authorizePrivateChatAction({
      ...grantedAll,
      isCanvasWriteAction: true,
      projectCanvasWriteEnabled: false,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("CANVAS_WRITE_DISABLED_PROJECT_LEVEL");
    // 三层本身仍然是放行的 -- 画布开关是独立的第四条 AND，不是把三层结果篡改成"拒绝"
    expect(result.threeLayer.allowed).toBe(true);
  });

  it("项目级画布开关打开时，同一个画布落笔动作被允许", () => {
    const result = authorizePrivateChatAction({
      ...grantedAll,
      isCanvasWriteAction: true,
      projectCanvasWriteEnabled: true,
    });
    expect(result.allowed).toBe(true);
  });

  it("非画布动作不受项目级画布开关影响，即使开关关闭", () => {
    const result = authorizePrivateChatAction({
      ...grantedAll,
      isCanvasWriteAction: false,
      projectCanvasWriteEnabled: false,
    });
    expect(result.allowed).toBe(true);
  });

  it("三层已经拒绝时优先报三层的拒绝理由，不被画布开关掩盖成另一个理由", () => {
    const result = authorizePrivateChatAction({
      ...grantedAll,
      threeLayer: { ...grantedAll.threeLayer, layer1: { granted: false } },
      isCanvasWriteAction: true,
      projectCanvasWriteEnabled: false,
    });
    expect(result.reason).toBe("TOOL_NOT_WHITELISTED");
  });
});

describe("F59 R5 / V5 -- 私聊入口本身的角色矩阵（观察者恒无入口、组员看开关）", () => {
  const runningAgent: Pick<AgentDefinition, "publishState"> = { publishState: "运行中" };
  const disabledAgent: Pick<AgentDefinition, "publishState"> = { publishState: "已停用" };

  it("反向断言：观察者恒拒绝，即使 agent 可见且运行中、即使开关字段被设为 true", () => {
    const result = authorizePrivateChatEntry({
      role: "observer",
      agentVisibleToUser: true,
      agent: runningAgent,
      memberToggleEnabledForThread: true,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("OBSERVER_NO_ENTRY");
  });

  it("反向断言：组员默认（开关未开）不可私聊，即使 agent 可见且运行中", () => {
    const result = authorizePrivateChatEntry({
      role: "member",
      agentVisibleToUser: true,
      agent: runningAgent,
      memberToggleEnabledForThread: false,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("MEMBER_TOGGLE_DISABLED");
  });

  it("组员在引导师打开本场开关后可私聊", () => {
    const result = authorizePrivateChatEntry({
      role: "member",
      agentVisibleToUser: true,
      agent: runningAgent,
      memberToggleEnabledForThread: true,
    });
    expect(result.allowed).toBe(true);
  });

  it("V6：可见性范围未覆盖当前用户 ⇒ 拒绝，与「不存在」同一报告码，不泄露 agent 存在性", () => {
    const result = authorizePrivateChatEntry({
      role: "facilitator",
      agentVisibleToUser: false,
      agent: runningAgent,
      memberToggleEnabledForThread: true,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("NOT_VISIBLE");
  });

  it("agent 非运行中（已停用）⇒ 引导师也不能私聊，与 F55 的 private-chat surface 判定同一份事实", () => {
    const result = authorizePrivateChatEntry({
      role: "facilitator",
      agentVisibleToUser: true,
      agent: disabledAgent,
      memberToggleEnabledForThread: true,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("AGENT_NOT_RUNNING");
  });

  it("引导师 / 组长在 agent 可见且运行中时可私聊，不需要开关", () => {
    for (const role of ["facilitator", "groupLead"] as const) {
      const result = authorizePrivateChatEntry({
        role,
        agentVisibleToUser: true,
        agent: runningAgent,
        memberToggleEnabledForThread: false,
      });
      expect(result.allowed).toBe(true);
    }
  });
});
