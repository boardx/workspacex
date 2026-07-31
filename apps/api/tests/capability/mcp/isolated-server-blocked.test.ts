import { describe, expect, it } from "vitest";
import { initialStatusOnRegister } from "../../../src/domain/mcp/server-status";
import { quarantineBlocks } from "../../../src/domain/mcp/authorize-scope";
import { authorizeMcpScopeLayer1 } from "../../../src/application/mcp/authorize-layer1";
import type { InterceptCounterPort } from "../../../src/application/mcp/ports";

/**
 * F53 (UC-21.1 R7) -- 新注册默认隔离的**运行时阻断**, 与 F131 的隔离期阻断.
 *
 * `user_visible_behavior`：「新注册服务器默认已隔离，其工具不进 agent 白名单可选池、
 * 任何调用被拒并计入越权拦截计数（后台数据总览可见）」。
 *
 * F52 已经证明"注册时状态落成已隔离"（`initialStatusOnRegister`，见
 * `three-orthogonal-fields.test.ts`）；这里证明的是**下一步**——处于该状态时，
 * 一次真实的工具调用会在服务端被挡下来，而不是停在一个没人读的状态字段上。
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

describe("F53 · 新注册默认隔离 ⇒ 运行时阻断", () => {
  it("开关一为开时的初始状态（已隔离）拿去调用 ⇒ 服务端拒绝 MCP_SERVER_ISOLATED", async () => {
    const initial = initialStatusOnRegister(true);
    const counter = fakeCounter();

    const r = await authorizeMcpScopeLayer1(
      { intercepts: counter },
      {
        serverId: "mcp-new",
        toolFullName: "mcp:new.search",
        actorId: "u-any",
        toolAuthScope: "全体成员", // ⚠ 即便授权范围本身是最宽的「全体成员」，隔离仍然挡下
        reviewStatus: initial.reviewStatus,
        connectionStatus: initial.connectionStatus,
        quarantineUntil: null,
        now: new Date("2026-07-31T00:00:00Z"),
        actor: { isProjectOwner: true, isInAuthorizedTeam: true, isPlatformGroup: false },
      },
    );

    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason).toBe("MCP_SERVER_ISOLATED");
  });

  it("该次拒绝计入越权拦截计数", async () => {
    const initial = initialStatusOnRegister(true);
    const counter = fakeCounter();

    await authorizeMcpScopeLayer1(
      { intercepts: counter },
      {
        serverId: "mcp-new",
        toolFullName: "mcp:new.search",
        actorId: "u-any",
        toolAuthScope: "全体成员",
        reviewStatus: initial.reviewStatus,
        connectionStatus: initial.connectionStatus,
        quarantineUntil: null,
        now: new Date("2026-07-31T00:00:00Z"),
        actor: { isProjectOwner: true, isInAuthorizedTeam: true, isPlatformGroup: false },
      },
    );

    expect(counter.events).toHaveLength(1);
    expect(counter.events[0]).toMatchObject({ serverId: "mcp-new", reason: "MCP_SERVER_ISOLATED" });
  });

  it("反证：开关一为关时的初始状态（已连接）拿去调用 ⇒ 不被隔离阻断（授权范围仍照常判）", async () => {
    const initial = initialStatusOnRegister(false);
    const counter = fakeCounter();

    const r = await authorizeMcpScopeLayer1(
      { intercepts: counter },
      {
        serverId: "mcp-new-2",
        toolFullName: "mcp:new-2.search",
        actorId: "u-any",
        toolAuthScope: "全体成员",
        reviewStatus: initial.reviewStatus, // 「待安全评审」——不是 F53 的码，但至少不是隔离
        connectionStatus: initial.connectionStatus, // 「已连接」
        quarantineUntil: null,
        now: new Date("2026-07-31T00:00:00Z"),
        actor: { isProjectOwner: true, isInAuthorizedTeam: true, isPlatformGroup: false },
      },
    );

    // 未隔离，授权范围「全体成员」放行——这里没有触发 MCP_SERVER_ISOLATED
    expect(r.allowed || (!r.allowed && r.reason !== "MCP_SERVER_ISOLATED")).toBe(true);
    expect(counter.events).toEqual([]);
  });
});

describe("F53 / F131 · 隔离期（quarantineUntil）阻断，与「已隔离」是两条不同的门", () => {
  const now = new Date("2026-08-01T00:00:00Z");
  const future = "2026-08-14T00:00:00Z";
  const past = "2026-07-20T00:00:00Z";

  it("quarantineBlocks：截止时刻未到 + 非平台组 ⇒ 阻断", () => {
    expect(quarantineBlocks({ quarantineUntil: future, now, isPlatformGroup: false })).toBe(true);
  });

  it("quarantineBlocks：平台组身份越过隔离期这一条门（反向断言，I-30′ 明写不可省）", () => {
    expect(quarantineBlocks({ quarantineUntil: future, now, isPlatformGroup: true })).toBe(false);
  });

  it("quarantineBlocks：截止时刻已过 ⇒ 不再阻断（到期后的复核状态不归这个函数管）", () => {
    expect(quarantineBlocks({ quarantineUntil: past, now, isPlatformGroup: false })).toBe(false);
  });

  it("quarantineBlocks：`null` 恒不阻断——「非第三方源/未进入隔离期」，不是「隔离期已过」", () => {
    expect(quarantineBlocks({ quarantineUntil: null, now, isPlatformGroup: false })).toBe(false);
  });

  it("authorizeMcpScopeLayer1：隔离期内非平台组调用 ⇒ MCP_SERVER_IN_QUARANTINE，且计入拦截计数", async () => {
    const counter = fakeCounter();
    const r = await authorizeMcpScopeLayer1(
      { intercepts: counter },
      {
        serverId: "mcp-third-party",
        toolFullName: "mcp:third-party.fetch",
        actorId: "u-member",
        toolAuthScope: "全体成员",
        reviewStatus: "待安全评审",
        connectionStatus: "已隔离",
        quarantineUntil: future,
        now,
        actor: { isProjectOwner: true, isInAuthorizedTeam: true, isPlatformGroup: false },
      },
    );
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    // 隔离期比「已隔离」更具体，判定顺序上先报隔离期
    expect(r.reason).toBe("MCP_SERVER_IN_QUARANTINE");
    expect(counter.events).toHaveLength(1);
  });

  it("反证：同一台服务器，平台组身份调用 ⇒ 通过（隔离期不挡平台组，但仍受连接状态影响，这里连接状态是已隔离所以改用未隔离配置验证「通过」分支）", async () => {
    const counter = fakeCounter();
    const r = await authorizeMcpScopeLayer1(
      { intercepts: counter },
      {
        serverId: "mcp-third-party",
        toolFullName: "mcp:third-party.fetch",
        actorId: "u-platform",
        toolAuthScope: "全体成员",
        reviewStatus: "已放行",
        connectionStatus: "已连接",
        quarantineUntil: future,
        now,
        actor: { isProjectOwner: true, isInAuthorizedTeam: true, isPlatformGroup: true },
      },
    );
    expect(r.allowed).toBe(true);
    expect(counter.events).toEqual([]);
  });
});
