/**
 * issue #2774 —— `POST /agent-runs/:runId/tool-calls/:toolCallId/decision` 路由本身。
 *
 * `decide-tool-permission.ts`（应用层）与 `permission-grant-scopes.test.ts`（授权粒度）
 * 早就测过判定逻辑本身；本文件只钉**这条路由从没被测过的那一半**——一段时间里它压根
 * 不存在（见 `agent-run.controller.ts` 该 handler 头注）：controller 层的入参校验、
 * 错误码映射，以及 handler 真的把 body 转成 `decide-tool-permission.ts` 认识的入参
 * 转交下去、把返回值原样交回。不重复验证 once/run/forever/deny 的授权粒度语义
 * （那是 `permission-grant-scopes.test.ts` 的范围）。
 */
import { describe, expect, it, vi } from "vitest";

type Decider = (p: unknown, r: string, t: string, b: unknown) => Promise<unknown>;

describe("decideToolPermissionCall 入参校验（400 挡在应用层之前，依赖零调用）", () => {
  async function makeController() {
    vi.resetModules();
    const { AgentRunController } = await import("../../src/interface/controllers/agent-run.controller");
    // 传入即炸的代理钉死"校验失败时不碰任何依赖"这条纪律，同
    // `deep-agent-hitl.test.ts` 里对旧 `/decision` 端点的同一套手法。
    const boom = new Proxy({}, { get: () => { throw new Error("dependency touched before validation"); } });
    const c = new (AgentRunController as new (...a: unknown[]) => { decideToolPermissionCall: Decider })(
      boom, boom, boom, boom, boom, boom, boom, boom, boom,
    );
    const principal = { userId: "u1", orgId: "o1" };
    return { c, principal };
  }

  it("未知 decision → 400", async () => {
    const { c, principal } = await makeController();
    await expect(
      c.decideToolPermissionCall(principal, "r1", "c1", { decision: "approve" }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("缺 decision → 400", async () => {
    const { c, principal } = await makeController();
    await expect(
      c.decideToolPermissionCall(principal, "r1", "c1", {}),
    ).rejects.toMatchObject({ status: 400 });
  });

  it.each(["once", "run", "forever", "deny"] as const)(
    "合法 decision \"%s\" 不在校验这一步被拒绝（会往下走到依赖，代理炸出别的错误）",
    async (decision) => {
      const { c, principal } = await makeController();
      await expect(
        c.decideToolPermissionCall(principal, "r1", "c1", { decision }),
      ).rejects.not.toMatchObject({ status: 400 });
    },
  );
});

describe("decideToolPermissionCall 转发与错误码映射", () => {
  async function makeController(decideToolPermission: (...a: unknown[]) => Promise<unknown>) {
    vi.resetModules();
    vi.doMock("../../src/application/agent-run/decide-tool-permission", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../../src/application/agent-run/decide-tool-permission")>()),
      decideToolPermission,
    }));
    const { AgentRunController } = await import("../../src/interface/controllers/agent-run.controller");
    const executor = { kick: vi.fn() };
    const c = new (AgentRunController as new (...a: unknown[]) => { decideToolPermissionCall: Decider })(
      {}, {}, {}, {}, {}, executor, {}, {}, { granted: true },
    );
    return { c, executor };
  }

  const principal = { userId: "u1", orgId: "o1" };

  it("成功：把 body.decision 与 URL 参数原样转交，返回值原样交回", async () => {
    const decideToolPermission = vi.fn(async (_deps: unknown, _input: unknown) => (
      { runId: "r1", toolCallId: "c1", status: "queued" }
    ));
    const { c } = await makeController(decideToolPermission);
    const out = await c.decideToolPermissionCall(principal, "r1", "c1", { decision: "forever" });
    expect(out).toEqual({ runId: "r1", toolCallId: "c1", status: "queued" });
    expect(decideToolPermission).toHaveBeenCalledTimes(1);
    const [deps, input] = decideToolPermission.mock.calls[0]!;
    expect(input).toEqual({
      userId: "u1", orgId: "o1", runId: "r1", toolCallId: "c1", decision: "forever",
    });
    expect((deps as { grants: unknown }).grants).toEqual({ granted: true });
  });

  it("kick 透传给 executor.kick——deps.kick 不是本地空操作", async () => {
    const decideToolPermission = vi.fn(async (deps: unknown) => {
      (deps as { kick: (orgId: string) => void }).kick("o1");
      return { runId: "r1", toolCallId: "c1", status: "queued" };
    });
    const { c, executor } = await makeController(decideToolPermission);
    await c.decideToolPermissionCall(principal, "r1", "c1", { decision: "once" });
    expect(executor.kick).toHaveBeenCalledWith("o1");
  });

  it("AgentRunNotVisibleError → 404", async () => {
    const { AgentRunNotVisibleError } = await import("../../src/application/agent-run/read-run");
    const { c } = await makeController(async () => { throw new AgentRunNotVisibleError(); });
    await expect(
      c.decideToolPermissionCall(principal, "r1", "c1", { decision: "deny" }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("AgentRunRetryForbiddenError（observer/归档）→ 403", async () => {
    const { AgentRunRetryForbiddenError } = await import("../../src/application/agent-run/retry-run");
    const { c } = await makeController(async () => { throw new AgentRunRetryForbiddenError(); });
    await expect(
      c.decideToolPermissionCall(principal, "r1", "c1", { decision: "deny" }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("RunNotAwaitingToolPermissionError（状态不对/竞态）→ 409", async () => {
    const { RunNotAwaitingToolPermissionError } = await import(
      "../../src/application/agent-run/decide-tool-permission"
    );
    const { c } = await makeController(async () => { throw new RunNotAwaitingToolPermissionError("running"); });
    await expect(
      c.decideToolPermissionCall(principal, "r1", "c1", { decision: "deny" }),
    ).rejects.toMatchObject({ status: 409, response: { reasonCode: "RUN_NOT_AWAITING_TOOL_PERMISSION" } });
  });
});
