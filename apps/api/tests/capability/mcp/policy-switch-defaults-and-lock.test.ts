import { describe, expect, it } from "vitest";
import { AUTH_POLICY } from "@repo/contracts/auth";
import { SecurityPolicy } from "@repo/contracts/agent-runtime";
import {
  defaultSecurityPolicy,
  evaluateSecurityPolicySwitchChange,
} from "../../../src/domain/mcp/security-policy";
import {
  setSecurityPolicy,
  PolicySwitchLockedError,
} from "../../../src/application/mcp/set-security-policy";
import type { ProvenanceWriter } from "../../../src/application/provenance/ports";
import type { SecurityPolicyStore } from "../../../src/application/mcp/ports";
import { toOrgId } from "../../../src/domain/org-id";

/**
 * F54 (UC-21.2 R7 / R12 V1 / V2 / V2a) -- 安全策略四开关：默认值 + 可关闭性 + 真控制。
 *
 * 反向断言优先：每条"允许"都配一条"拒绝"，且拒绝路径逐条覆盖 V2a 的四行表格。
 */

function fakePolicyStore(initial = defaultSecurityPolicy()): SecurityPolicyStore & {
  current: ReturnType<typeof defaultSecurityPolicy>;
} {
  let policy = initial;
  return {
    get current() {
      return policy;
    },
    async get() {
      return policy;
    },
    async set(next) {
      policy = next;
    },
  };
}

function fakeProvenance(): ProvenanceWriter & { events: unknown[] } {
  const events: unknown[] = [];
  return {
    events,
    async append(input) {
      events.push(input);
      return `ev-${events.length}`;
    },
    async appendWithin(_session, input) {
      events.push(input);
      return `ev-${events.length}`;
    },
  };
}

describe("F54 · V1 -- 新组织初始化后，四个开关默认值为「开/开/开/关」", () => {
  it("默认策略与原型一致", () => {
    const p = defaultSecurityPolicy();
    expect(p.isolateNewServers).toBe(true);
    expect(p.logCustomerDataCalls).toBe(true);
    expect(p.confidentialLocalOnly).toBe(true);
    expect(p.agentSelfDiscoversMcp).toBe(false);
  });

  it("默认策略满足契约 schema（不是恰好长得像，而是真的能通过校验）", () => {
    expect(() => SecurityPolicy.parse(defaultSecurityPolicy())).not.toThrow();
  });

  it("保留期天数取自 O-01 的单一事实源 AUTH_POLICY.orgRetentionDays，不是本文件另开的常量", () => {
    expect(defaultSecurityPolicy().provenanceRetentionDays).toBe(AUTH_POLICY.orgRetentionDays);
  });
});

describe("F54 · V2a -- 可关闭性：逐条覆盖 O-19 的四行裁决", () => {
  it("开关 1 打开：恒允许，不需要 confirmToken", () => {
    const r = evaluateSecurityPolicySwitchChange({ switchNo: 1, enabled: true, hasConfirmToken: false });
    expect(r.ok).toBe(true);
  });

  it("开关 1 关闭且带 confirmToken：允许", () => {
    const r = evaluateSecurityPolicySwitchChange({ switchNo: 1, enabled: false, hasConfirmToken: true });
    expect(r.ok).toBe(true);
  });

  it("反证：开关 1 关闭但缺 confirmToken ⇒ POLICY_SWITCH_LOCKED", () => {
    const r = evaluateSecurityPolicySwitchChange({ switchNo: 1, enabled: false, hasConfirmToken: false });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("POLICY_SWITCH_LOCKED");
  });

  it("开关 2 同开关 1 的规则（涉客户数据留痕）", () => {
    expect(evaluateSecurityPolicySwitchChange({ switchNo: 2, enabled: false, hasConfirmToken: true }).ok).toBe(true);
    expect(evaluateSecurityPolicySwitchChange({ switchNo: 2, enabled: false, hasConfirmToken: false }).ok).toBe(false);
  });

  it("开关 3：任何关闭尝试都被锁死，即便带着 confirmToken 也不放行", () => {
    const withToken = evaluateSecurityPolicySwitchChange({ switchNo: 3, enabled: false, hasConfirmToken: true });
    const withoutToken = evaluateSecurityPolicySwitchChange({ switchNo: 3, enabled: false, hasConfirmToken: false });
    expect(withToken.ok).toBe(false);
    expect(withoutToken.ok).toBe(false);
  });

  it("反证：开关 3 打开（保持默认）恒允许——不是「永远拒绝」，只是「不能变成 false」", () => {
    expect(evaluateSecurityPolicySwitchChange({ switchNo: 3, enabled: true, hasConfirmToken: false }).ok).toBe(true);
  });

  it("开关 4：任何打开尝试都被锁死，phase-1 无打开入口，即便带着 confirmToken 也不放行", () => {
    const withToken = evaluateSecurityPolicySwitchChange({ switchNo: 4, enabled: true, hasConfirmToken: true });
    const withoutToken = evaluateSecurityPolicySwitchChange({ switchNo: 4, enabled: true, hasConfirmToken: false });
    expect(withToken.ok).toBe(false);
    expect(withoutToken.ok).toBe(false);
  });

  it("反证：开关 4 保持关闭（默认态）恒允许", () => {
    expect(evaluateSecurityPolicySwitchChange({ switchNo: 4, enabled: false, hasConfirmToken: false }).ok).toBe(true);
  });
});

describe("F54 · V2 -- 真控制：setSecurityPolicy 用例层强制执行，且变更留痕", () => {
  it("开关 1 关闭（带确认）：策略真的翻转，且留下一条 provenance 事件", async () => {
    const store = fakePolicyStore();
    const provenance = fakeProvenance();
    const result = await setSecurityPolicy(
      { policyStore: store, provenance },
      {
        orgId: toOrgId("org-f54"),
        switchNo: 1,
        enabled: false,
        confirmToken: "admin-confirmed-2026-08-01",
        actorId: "u-admin",
      },
    );
    expect(result.isolateNewServers).toBe(false);
    expect(store.current.isolateNewServers).toBe(false);
    expect(provenance.events).toHaveLength(1);
    expect(provenance.events[0]).toMatchObject({
      type: "capability-updated",
      actorId: "u-admin",
      target: { kind: "capability", id: "mcp-security-policy" },
    });
  });

  it("反证：开关 1 关闭但缺 confirmToken ⇒ 抛 PolicySwitchLockedError，策略与留痕均不变", async () => {
    const store = fakePolicyStore();
    const provenance = fakeProvenance();
    await expect(
      setSecurityPolicy(
        { policyStore: store, provenance },
        { orgId: toOrgId("org-f54"), switchNo: 1, enabled: false, confirmToken: null, actorId: "u-admin" },
      ),
    ).rejects.toThrow(PolicySwitchLockedError);
    expect(store.current.isolateNewServers).toBe(true);
    expect(provenance.events).toHaveLength(0);
  });

  it("反证：直调用例尝试关闭开关 3 ⇒ 拒绝，策略保持 true，不产生留痕", async () => {
    const store = fakePolicyStore();
    const provenance = fakeProvenance();
    await expect(
      setSecurityPolicy(
        { policyStore: store, provenance },
        {
          orgId: toOrgId("org-f54"),
          switchNo: 3,
          enabled: false,
          confirmToken: "even-with-a-token",
          actorId: "u-admin",
        },
      ),
    ).rejects.toThrow(PolicySwitchLockedError);
    expect(store.current.confidentialLocalOnly).toBe(true);
    expect(provenance.events).toHaveLength(0);
  });

  it("反证：直调用例尝试打开开关 4 ⇒ 拒绝，策略保持 false，不产生留痕", async () => {
    const store = fakePolicyStore();
    const provenance = fakeProvenance();
    await expect(
      setSecurityPolicy(
        { policyStore: store, provenance },
        { orgId: toOrgId("org-f54"), switchNo: 4, enabled: true, confirmToken: null, actorId: "u-admin" },
      ),
    ).rejects.toThrow(PolicySwitchLockedError);
    expect(store.current.agentSelfDiscoversMcp).toBe(false);
    expect(provenance.events).toHaveLength(0);
  });

  it("留痕写入失败 ⇒ 策略变更整体失败，store 未被调用（没有留痕就没有变更）", async () => {
    const store = fakePolicyStore();
    const failingProvenance: ProvenanceWriter = {
      async append() {
        throw new Error("provenance store unavailable");
      },
      async appendWithin() {
        throw new Error("provenance store unavailable");
      },
    };
    await expect(
      setSecurityPolicy(
        { policyStore: store, provenance: failingProvenance },
        {
          orgId: toOrgId("org-f54"),
          switchNo: 2,
          enabled: false,
          confirmToken: "admin-confirmed",
          actorId: "u-admin",
        },
      ),
    ).rejects.toThrow(/provenance store unavailable/);
    expect(store.current.logCustomerDataCalls).toBe(true);
  });
});
