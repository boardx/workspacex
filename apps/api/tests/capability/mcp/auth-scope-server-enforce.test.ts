import { describe, expect, it } from "vitest";
import { evaluateMcpAuthScope } from "../../../src/domain/mcp/authorize-scope";
import { authorizeMcpScopeLayer1 } from "../../../src/application/mcp/authorize-layer1";
import type { InterceptCounterPort } from "../../../src/application/mcp/ports";

/**
 * F53 (UC-21.1 R7) -- 三层权限求交的**第①层**：授权范围服务端判定.
 *
 * `user_visible_behavior` 逐字：「把某服务器授权范围设为"仅项目负责人"后，普通顾问触发
 * 引用其工具的 agent 调用被服务端拒绝且拒因指向第①层，项目负责人触发则通过」。
 *
 * 反向断言优先（AGENTS.md 指示）：本文件把"拒绝路径"放在前面、且每条正面断言都配一条
 * 反证——不满足条件的 actor 必须被拒，而不是恰好在这份测试的输入上都通过。
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

const baseServerFacts = {
  reviewStatus: "已放行" as const,
  connectionStatus: "已连接" as const,
  quarantineUntil: null,
};

describe("F53 · evaluateMcpAuthScope -- 纯函数判定（可脱 HTTP 直测）", () => {
  it("仅项目负责人：普通顾问被拒", () => {
    const r = evaluateMcpAuthScope("仅项目负责人", {
      isProjectOwner: false,
      isInAuthorizedTeam: false,
    });
    expect(r.allowed).toBe(false);
  });

  it("仅项目负责人：项目负责人本人通过", () => {
    const r = evaluateMcpAuthScope("仅项目负责人", {
      isProjectOwner: true,
      isInAuthorizedTeam: false,
    });
    expect(r.allowed).toBe(true);
  });

  it("仅某团队：非授权团队成员被拒，授权团队成员通过", () => {
    expect(
      evaluateMcpAuthScope("仅某团队", { isProjectOwner: false, isInAuthorizedTeam: false })
        .allowed,
    ).toBe(false);
    expect(
      evaluateMcpAuthScope("仅某团队", { isProjectOwner: false, isInAuthorizedTeam: true }).allowed,
    ).toBe(true);
  });

  it("未开放：**任何 actor 都被拒**，包括项目负责人本人 —— 这条最容易被「反正是负责人」漏判", () => {
    expect(
      evaluateMcpAuthScope("未开放", { isProjectOwner: true, isInAuthorizedTeam: true }).allowed,
    ).toBe(false);
  });

  it("全体成员：任何 actor 都通过", () => {
    expect(
      evaluateMcpAuthScope("全体成员", { isProjectOwner: false, isInAuthorizedTeam: false })
        .allowed,
    ).toBe(true);
  });

  it("需人工确认每次：允许，但携带 requiresConfirmation 标记（F130 的 confirmationId 由上层生成）", () => {
    const r = evaluateMcpAuthScope("需人工确认每次", {
      isProjectOwner: false,
      isInAuthorizedTeam: false,
    });
    expect(r.allowed).toBe(true);
    expect(r.requiresConfirmation).toBe(true);
  });

  it("反证：其余四值的 requiresConfirmation 恒为 false，否则前端会对所有工具都弹确认框", () => {
    for (const scope of ["全体成员", "仅某团队", "仅项目负责人", "未开放"] as const) {
      expect(
        evaluateMcpAuthScope(scope, { isProjectOwner: true, isInAuthorizedTeam: true })
          .requiresConfirmation,
        `${scope} 不应要求确认`,
      ).toBe(false);
    }
  });
});

describe("F53 · authorizeMcpScopeLayer1 -- 服务端强制，拒因指向第①层", () => {
  it("普通顾问触发「仅项目负责人」服务器的工具调用 ⇒ AUTH_SCOPE_DENIED，layer=mcp-scope", async () => {
    const counter = fakeCounter();
    const r = await authorizeMcpScopeLayer1(
      { intercepts: counter },
      {
        serverId: "mcp-crm",
        toolFullName: "mcp:crm.lookup",
        actorId: "u-consultant",
        toolAuthScope: "仅项目负责人",
        ...baseServerFacts,
        now: new Date("2026-07-31T00:00:00Z"),
        actor: { isProjectOwner: false, isInAuthorizedTeam: false, isPlatformGroup: false },
      },
    );

    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason).toBe("AUTH_SCOPE_DENIED");
    expect(r.layer).toBe("mcp-scope");
  });

  it("同一台服务器，项目负责人触发 ⇒ 通过", async () => {
    const counter = fakeCounter();
    const r = await authorizeMcpScopeLayer1(
      { intercepts: counter },
      {
        serverId: "mcp-crm",
        toolFullName: "mcp:crm.lookup",
        actorId: "u-owner",
        toolAuthScope: "仅项目负责人",
        ...baseServerFacts,
        now: new Date("2026-07-31T00:00:00Z"),
        actor: { isProjectOwner: true, isInAuthorizedTeam: false, isPlatformGroup: false },
      },
    );

    expect(r.allowed).toBe(true);
    expect(counter.events).toEqual([]);
  });

  it("越权拒绝计入拦截计数：一次拒绝 ⇒ 计数器恰好收到一条 AUTH_SCOPE_DENIED 事件", async () => {
    const counter = fakeCounter();
    await authorizeMcpScopeLayer1(
      { intercepts: counter },
      {
        serverId: "mcp-crm",
        toolFullName: "mcp:crm.lookup",
        actorId: "u-consultant",
        toolAuthScope: "仅项目负责人",
        ...baseServerFacts,
        now: new Date("2026-07-31T00:00:00Z"),
        actor: { isProjectOwner: false, isInAuthorizedTeam: false, isPlatformGroup: false },
      },
    );

    expect(counter.events).toHaveLength(1);
    expect(counter.events[0]).toMatchObject({
      serverId: "mcp-crm",
      toolFullName: "mcp:crm.lookup",
      actorId: "u-consultant",
      reason: "AUTH_SCOPE_DENIED",
    });
  });

  it("反证：把 actor 换成通过的项目负责人，同一次调用**不**产生任何拦截计数", async () => {
    const counter = fakeCounter();
    await authorizeMcpScopeLayer1(
      { intercepts: counter },
      {
        serverId: "mcp-crm",
        toolFullName: "mcp:crm.lookup",
        actorId: "u-owner",
        toolAuthScope: "仅项目负责人",
        ...baseServerFacts,
        now: new Date("2026-07-31T00:00:00Z"),
        actor: { isProjectOwner: true, isInAuthorizedTeam: false, isPlatformGroup: false },
      },
    );
    expect(counter.events).toHaveLength(0);
  });

  it("「仅某团队」授权范围下，非授权团队的项目负责人本人依然被拒 —— 两个维度不可互相顶替", async () => {
    const counter = fakeCounter();
    const r = await authorizeMcpScopeLayer1(
      { intercepts: counter },
      {
        serverId: "mcp-crm",
        toolFullName: "mcp:crm.lookup",
        actorId: "u-owner-wrong-team",
        toolAuthScope: "仅某团队",
        ...baseServerFacts,
        now: new Date("2026-07-31T00:00:00Z"),
        actor: { isProjectOwner: true, isInAuthorizedTeam: false, isPlatformGroup: false },
      },
    );
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason).toBe("AUTH_SCOPE_DENIED");
  });
});
