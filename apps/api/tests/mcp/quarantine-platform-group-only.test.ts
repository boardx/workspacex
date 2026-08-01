import { describe, expect, it } from "vitest";
import { quarantineBlocks } from "../../src/domain/mcp/authorize-scope";
import { authorizeMcpScopeLayer1 } from "../../src/application/mcp/authorize-layer1";
import { recordQuarantineCallTrace } from "../../src/application/mcp/record-quarantine-call";
import type { InterceptCounterPort } from "../../src/application/mcp/ports";
import type { ProvenanceWriter } from "../../src/application/provenance/ports";
import { toOrgId } from "../../src/domain/org-id";

/**
 * F131 (UC-21.1 R3 步骤 3 补 / I-30′) -- 隔离期内仅平台组可调用 + 全量留痕。
 *
 * ⚠ **双向断言不可省**：只写「被拒」那一侧，一个「隔离期内谁都不能调用」的实现全绿，
 *   而原型明说平台组可以。这份文件因此逐条配对：非平台组拒 / 平台组过，两条都写。
 * ⚠ 留痕断言打在「不受开关二影响」上——即便调用方传入一个「涉客户数据留痕」已关闭的
 *   语境，`recordQuarantineCallTrace` 也无条件写，因为它的留痕义务来自"处于隔离期"
 *   这件事本身，与开关二正交（见该文件文件头）。
 */

function fakeCounter(): InterceptCounterPort & { events: unknown[] } {
  const events: unknown[] = [];
  return {
    events,
    async recordDenied(event) {
      events.push(event);
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
    async appendWithin(_s, input) {
      events.push(input);
      return `ev-${events.length}`;
    },
  };
}

const quarantineUntil = "2026-08-15T00:00:00.000Z";
const withinWindow = new Date("2026-08-05T00:00:00Z");

describe("F131 · quarantineBlocks -- 隔离期内仅平台组可调用（纯判定）", () => {
  it("非平台组身份 ⇒ 拒", () => {
    expect(
      quarantineBlocks({ quarantineUntil, now: withinWindow, isPlatformGroup: false }),
    ).toBe(true);
  });

  it("⭐ 平台组身份 ⇒ 过（反向断言，缺这一格「隔离期内谁都不能调用」也会全绿）", () => {
    expect(
      quarantineBlocks({ quarantineUntil, now: withinWindow, isPlatformGroup: true }),
    ).toBe(false);
  });

  it("期满之后，非平台组也不再被本条判定拦——隔离期已经过去", () => {
    expect(
      quarantineBlocks({
        quarantineUntil,
        now: new Date("2026-09-01T00:00:00Z"),
        isPlatformGroup: false,
      }),
    ).toBe(false);
  });
});

describe("F131 · authorizeMcpScopeLayer1 -- 隔离期门在服务端强制、双向可证", () => {
  it("非平台组在隔离期内调用 ⇒ 拒绝 MCP_SERVER_IN_QUARANTINE 且计入越权拦截计数", async () => {
    const counter = fakeCounter();
    const r = await authorizeMcpScopeLayer1(
      { intercepts: counter },
      {
        serverId: "mcp-eu-reg",
        toolFullName: "mcp:eu-reg.search",
        actorId: "u-consultant",
        toolAuthScope: "全体成员",
        reviewStatus: "待安全评审",
        connectionStatus: "已隔离",
        quarantineUntil,
        now: withinWindow,
        actor: { isProjectOwner: true, isInAuthorizedTeam: true, isPlatformGroup: false },
      },
    );
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason).toBe("MCP_SERVER_IN_QUARANTINE");
    expect(counter.events).toHaveLength(1);
  });

  it("⭐ 平台组在隔离期内调用同一台服务器 ⇒ 通过（越过隔离期这一条闸门）", async () => {
    const counter = fakeCounter();
    const r = await authorizeMcpScopeLayer1(
      { intercepts: counter },
      {
        serverId: "mcp-eu-reg",
        toolFullName: "mcp:eu-reg.search",
        actorId: "u-platform",
        toolAuthScope: "全体成员",
        // ⚠ 平台组越过的是隔离期这一条，connectionStatus 仍须为非「已隔离」才能真正放行——
        //   与 quarantineBlocks 的文件头注释一致："平台组身份不放宽任何其它层"。
        reviewStatus: "已放行",
        connectionStatus: "已连接",
        quarantineUntil,
        now: withinWindow,
        actor: { isProjectOwner: true, isInAuthorizedTeam: true, isPlatformGroup: true },
      },
    );
    expect(r.allowed).toBe(true);
    expect(counter.events).toHaveLength(0);
  });
});

describe("F131 · recordQuarantineCallTrace -- 全量留痕，不受开关二影响", () => {
  const baseInput = {
    orgId: toOrgId("org-f131"),
    serverId: "mcp-eu-reg",
    toolFullName: "mcp:eu-reg.search",
    actorId: "u-consultant",
    quarantineUntil,
    at: withinWindow,
  };

  it("被拒的尝试也写留痕（不是只留成功的那一半）", async () => {
    const provenance = fakeProvenance();
    await recordQuarantineCallTrace(
      { provenance },
      { ...baseInput, allowed: false, isPlatformGroup: false },
    );
    expect(provenance.events).toHaveLength(1);
    const detail = (provenance.events[0] as { detail: Record<string, unknown> }).detail;
    expect(detail.allowed).toBe(false);
  });

  it("放行的尝试（平台组）同样写留痕", async () => {
    const provenance = fakeProvenance();
    await recordQuarantineCallTrace(
      { provenance },
      { ...baseInput, actorId: "u-platform", allowed: true, isPlatformGroup: true },
    );
    expect(provenance.events).toHaveLength(1);
    const detail = (provenance.events[0] as { detail: Record<string, unknown> }).detail;
    expect(detail.allowed).toBe(true);
    expect(detail.isPlatformGroup).toBe(true);
  });

  it("⚠ 不受「涉客户数据才留痕」的开关二影响：本函数不接受、也不查询该开关，无条件写", async () => {
    // 本函数的签名里根本没有 `logCustomerDataCalls` / `involvesCustomerData` 这类参数——
    // 这正是"不受影响"在类型层面唯一能长成的样子：调用方无法把开关传进来让它生效。
    const provenance = fakeProvenance();
    await recordQuarantineCallTrace(
      { provenance },
      { ...baseInput, allowed: false, isPlatformGroup: false },
    );
    expect(provenance.events).toHaveLength(1);
  });

  it("留痕失败 ⇒ 错误原样向上传播（同 F54 R7 的「没有留痕就没有调用」纪律）", async () => {
    const failingProvenance: ProvenanceWriter = {
      async append() {
        throw new Error("provenance store down");
      },
      async appendWithin() {
        throw new Error("provenance store down");
      },
    };
    await expect(
      recordQuarantineCallTrace(
        { provenance: failingProvenance },
        { ...baseInput, allowed: false, isPlatformGroup: false },
      ),
    ).rejects.toThrow(/provenance store down/);
  });
});
