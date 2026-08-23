/**
 * DA-07b（#1749，rubric D6）反证套件：人在环的 api 侧传输链。
 *
 * · provider 见远端 "interrupted" → 返回 interrupted（含待批工具摘要），不抛错——
 *   把「等待人」当失败抛正是 DA-07b 之前的形状，反证钉死它不回退。
 * · resume 输入 → POST body 是 command.resume.decisions（0.7.6 实测契约），
 *   且**绝不带 input.messages**——重发用户输入会让引擎把同一条消息处理两遍。
 * · decideAgentRun 的 approve/reject/竞态三路。
 */
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEEP_AGENT_PROVIDER_NAME,
  DeepAgentModelProvider,
} from "../../src/infrastructure/agent-run/deep-agent-model-provider";

let server: Server | undefined;
afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

function startFake(opts: {
  runStatus: string;
  messages?: unknown[];
  onRunBody?: (body: unknown) => void;
}): Promise<string> {
  server = createServer(async (req, res) => {
    const url = req.url ?? "";
    let raw = "";
    for await (const c of req) raw += c;
    if (req.method === "POST" && url === "/threads") {
      res.writeHead(200).end(JSON.stringify({ thread_id: "t1" })); return;
    }
    if (req.method === "POST" && /\/threads\/t1\/runs$/.test(url)) {
      opts.onRunBody?.(raw === "" ? {} : JSON.parse(raw));
      res.writeHead(200).end(JSON.stringify({ run_id: "r1" })); return;
    }
    if (req.method === "GET" && /\/runs\/r1$/.test(url)) {
      res.writeHead(200).end(JSON.stringify({ status: opts.runStatus })); return;
    }
    if (req.method === "GET" && /\/state$/.test(url)) {
      res.writeHead(200).end(JSON.stringify({ values: { messages: opts.messages ?? [] } })); return;
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) => {
    server!.listen(0, "127.0.0.1", () => {
      const addr = server!.address();
      resolve(`http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`);
    });
  });
}

const base = {
  modelProvider: DEEP_AGENT_PROVIDER_NAME, modelId: "any", system: "s", user: "u",
  history: [], skills: [],
};
const provider = (baseUrl: string) =>
  new DeepAgentModelProvider({ baseUrl, timeoutMs: 5000, pollIntervalMs: 5 });

describe("DA-07b provider：中断与恢复（rubric D6）", () => {
  it('远端 "interrupted" → 返回待批摘要，不抛错；待批 = 最后一个没有 ToolMessage 回应的 tool_call', async () => {
    const baseUrl = await startFake({
      runStatus: "interrupted",
      messages: [
        { type: "ai", content: "", tool_calls: [{ id: "c1", name: "safe_tool", args: { a: 1 } }] },
        { type: "tool", tool_call_id: "c1", content: "ok" },
        { type: "ai", content: "", tool_calls: [{ id: "c2", name: "call_skill", args: { skill: "risky" } }] },
      ],
    });
    const result = await provider(baseUrl).completeWithProgress(base as never, async () => {});
    expect(result.interrupted).toEqual({
      toolName: "call_skill",
      argsSummary: JSON.stringify({ skill: "risky" }),
    });
    expect(result.text).toBe("");
  });

  it("resume 输入 → POST body 用 command.resume.decisions，且绝不重发用户输入", async () => {
    const bodies: unknown[] = [];
    const baseUrl = await startFake({
      runStatus: "success",
      messages: [{ type: "ai", content: "done after approval", tool_calls: [] }],
      onRunBody: (b) => void bodies.push(b),
    });
    const result = await provider(baseUrl).completeWithProgress(
      { ...base, resume: { decision: "approve" } } as never,
      async () => {},
    );
    expect(result.text).toBe("done after approval");
    expect(bodies).toHaveLength(1);
    const body = bodies[0] as { command?: unknown; input?: unknown };
    expect(body.command).toEqual({ resume: { decisions: [{ type: "approve" }] } });
    expect(body.input).toBeUndefined();
  });

  it("edit resume → decisions 是 EditDecision 形状（edited_action.name/args），且绝不重发用户输入", async () => {
    const bodies: unknown[] = [];
    const baseUrl = await startFake({
      runStatus: "success",
      messages: [{ type: "ai", content: "done after edit", tool_calls: [] }],
      onRunBody: (b) => void bodies.push(b),
    });
    const result = await provider(baseUrl).completeWithProgress(
      {
        ...base,
        resume: { decision: "edit", editedAction: { name: "call_skill", argsJson: JSON.stringify({ skill: "safe", dry_run: true }) } },
      } as never,
      async () => {},
    );
    expect(result.text).toBe("done after edit");
    expect(bodies).toHaveLength(1);
    const body = bodies[0] as { command?: unknown; input?: unknown };
    expect(body.command).toEqual({
      resume: {
        decisions: [{
          type: "edit",
          edited_action: { name: "call_skill", args: { skill: "safe", dry_run: true } },
        }],
      },
    });
    expect(body.input).toBeUndefined();
  });

  it("edit resume 的存储参数坏了（非 JSON / 非对象）→ ModelCallError fail closed，绝不发出请求", async () => {
    for (const argsJson of ["{not json", "null", "[1,2]", "\"str\""]) {
      const bodies: unknown[] = [];
      const baseUrl = await startFake({ runStatus: "success", onRunBody: (b) => void bodies.push(b) });
      await expect(
        provider(baseUrl).completeWithProgress(
          { ...base, resume: { decision: "edit", editedAction: { name: "call_skill", argsJson } } } as never,
          async () => {},
        ),
      ).rejects.toMatchObject({ code: "MODEL_CALL_FAILED" });
      expect(bodies).toHaveLength(0);
      await new Promise<void>((r) => server!.close(() => r()));
      server = undefined;
    }
  });
});

describe("DA-07b decideAgentRun 三路（可见性链 mock 成 allow——那条链沿用 retryAgentRun 的既有测试）", () => {
  async function makeDeps(overrides: {
    status: string;
    approveWins?: boolean;
    errorAfter?: string | null;
  }) {
    vi.resetModules();
    vi.doMock("../../src/application/chat/resolve-visibility", () => ({
      resolveVisibility: async () => ({
        kind: "allow",
        actor: { projectRole: "member" },
        thread: { archived: false },
        base: { requesterId: "u1" },
      }),
      AuthzUnavailableError: class extends Error {},
    }));
    vi.doMock("../../src/application/security/permission-filter", () => ({
      discloseDecided: (g: { value: unknown }) => ({ kind: "disclosed", payload: g.value }),
      isDisclosed: (d: { kind: string }) => d.kind === "disclosed",
    }));
    const mod = await import("../../src/application/agent-run/decide-agent-run");

    const calls: string[] = [];
    let status = overrides.status;
    let error: string | null = null;
    const runs = {
      findLocator: async () => ({ threadId: "t", projectId: null }),
      readRun: async () => ({ value: { runId: "r1", status, error, pendingApproval: null } }),
      failRun: async (_o: unknown, _r: unknown, code: string) => {
        calls.push(`fail:${code}`);
        if (status !== "succeeded" && status !== "failed") { status = "failed"; error = code; }
        if (overrides.errorAfter !== undefined && overrides.errorAfter !== null) error = overrides.errorAfter;
      },
      approveAndRequeue: async () => {
        calls.push("requeue");
        if (overrides.approveWins === false) return false;
        status = "queued";
        return true;
      },
      editAndRequeue: async (_o: unknown, _r: unknown, editedArgsJson: string) => {
        calls.push(`edit-requeue:${editedArgsJson}`);
        if (overrides.approveWins === false) return false;
        status = "queued";
        return true;
      },
    };
    let kicked = 0;
    const deps = { runs, kick: () => { kicked += 1; } } as never;
    return { mod, deps, calls, kicked: () => kicked };
  }

  it("approve：awaiting_approval → requeue + kick", async () => {
    const { mod, deps, calls, kicked } = await makeDeps({ status: "awaiting_approval" });
    const out = await mod.decideAgentRun(deps, { userId: "u1", orgId: "o1" as never, runId: "r1", decision: "approve" });
    expect(calls).toEqual(["requeue"]);
    expect(kicked()).toBe(1);
    expect(out.status).toBe("queued");
  });

  it("edit：awaiting_approval → editAndRequeue（带序列化的改后参数）+ kick，approve 通路零调用", async () => {
    const { mod, deps, calls, kicked } = await makeDeps({ status: "awaiting_approval" });
    const out = await mod.decideAgentRun(deps, {
      userId: "u1", orgId: "o1" as never, runId: "r1",
      decision: "edit", editedArgs: { skill: "safe", dry_run: true },
    });
    expect(calls).toEqual([`edit-requeue:${JSON.stringify({ skill: "safe", dry_run: true })}`]);
    expect(kicked()).toBe(1);
    expect(out.status).toBe("queued");
  });

  it("edit 竞态输了 → 抛 NotAwaitingApproval，绝不覆盖账本", async () => {
    const { mod, deps, calls, kicked } = await makeDeps({ status: "awaiting_approval", approveWins: false });
    await expect(
      mod.decideAgentRun(deps, {
        userId: "u1", orgId: "o1" as never, runId: "r1", decision: "edit", editedArgs: {},
      }),
    ).rejects.toBeInstanceOf(mod.AgentRunNotAwaitingApprovalError);
    expect(calls).toEqual(["edit-requeue:{}"]);
    expect(kicked()).toBe(0);
  });

  it("run 还在 running 时 edit → 冲突且 requeue 零调用", async () => {
    const { mod, deps, calls } = await makeDeps({ status: "running" });
    await expect(
      mod.decideAgentRun(deps, {
        userId: "u1", orgId: "o1" as never, runId: "r1", decision: "edit", editedArgs: { a: 1 },
      }),
    ).rejects.toBeInstanceOf(mod.AgentRunNotAwaitingApprovalError);
    expect(calls).toEqual([]);
  });

  it("reject：failRun(HITL_REJECTED)，不 kick", async () => {
    const { mod, deps, calls, kicked } = await makeDeps({ status: "awaiting_approval", errorAfter: "HITL_REJECTED" });
    const out = await mod.decideAgentRun(deps, { userId: "u1", orgId: "o1" as never, runId: "r1", decision: "reject" });
    expect(calls).toEqual(["fail:HITL_REJECTED"]);
    expect(kicked()).toBe(0);
    expect(out.error).toBe("HITL_REJECTED");
  });

  it("approve 竞态输了 → 抛 NotAwaitingApproval，绝不覆盖账本", async () => {
    const { mod, deps, calls } = await makeDeps({ status: "awaiting_approval", approveWins: false });
    await expect(
      mod.decideAgentRun(deps, { userId: "u1", orgId: "o1" as never, runId: "r1", decision: "approve" }),
    ).rejects.toBeInstanceOf(mod.AgentRunNotAwaitingApprovalError);
    expect(calls).toEqual(["requeue"]);
  });

  it("reject 竞态输了（run 已成功终态）→ 抛冲突，不假装拒绝生效", async () => {
    const { mod, deps } = await makeDeps({ status: "succeeded", errorAfter: null });
    await expect(
      mod.decideAgentRun(deps, { userId: "u1", orgId: "o1" as never, runId: "r1", decision: "reject" }),
    ).rejects.toBeInstanceOf(mod.AgentRunNotAwaitingApprovalError);
  });

  it("run 还在 running 时 reject → 冲突且 failRun 零调用——decision 端点不是 kill 开关", async () => {
    const { mod, deps, calls } = await makeDeps({ status: "running" });
    await expect(
      mod.decideAgentRun(deps, { userId: "u1", orgId: "o1" as never, runId: "r1", decision: "reject" }),
    ).rejects.toBeInstanceOf(mod.AgentRunNotAwaitingApprovalError);
    expect(calls).toEqual([]);
  });
});

describe("UX-9 D4 controller 入参校验（400 挡在应用层之前，应用函数零调用）", () => {
  async function makeController() {
    vi.resetModules();
    const { AgentRunController } = await import("../../src/interface/controllers/agent-run.controller");
    // decide() 在校验失败时不会碰任何依赖——传入即炸的代理钉死这一点。
    const boom = new Proxy({}, { get: () => { throw new Error("dependency touched before validation"); } });
    const c = new (AgentRunController as new (...a: unknown[]) => { decide: (p: unknown, r: string, b: unknown) => Promise<unknown> })(
      boom, boom, boom, boom, boom, boom,
    );
    const principal = { userId: "u1", orgId: "o1" };
    return { c, principal };
  }

  it("edit 缺 editedArgs / editedArgs 非对象 → 400", async () => {
    const { c, principal } = await makeController();
    for (const body of [
      { decision: "edit" },
      { decision: "edit", editedArgs: null },
      { decision: "edit", editedArgs: [1, 2] },
      { decision: "edit", editedArgs: "str" },
    ]) {
      await expect(c.decide(principal, "r1", body)).rejects.toMatchObject({ status: 400 });
    }
  });

  it("approve/reject 携带 editedArgs → 400——「放行原样」与「放行改样」不共用语义", async () => {
    const { c, principal } = await makeController();
    for (const decision of ["approve", "reject"]) {
      await expect(
        c.decide(principal, "r1", { decision, editedArgs: { a: 1 } }),
      ).rejects.toMatchObject({ status: 400 });
    }
  });

  it("未知 decision → 400", async () => {
    const { c, principal } = await makeController();
    await expect(c.decide(principal, "r1", { decision: "respond" })).rejects.toMatchObject({ status: 400 });
  });
});

describe("UX-9 D4 契约（decideAgentRun.in 的 superRefine 与控制器同一条规则）", () => {
  it("edit 必带 editedArgs，approve/reject 禁带", async () => {
    const { wave2Runtime } = await import("@repo/contracts");
    const schema = wave2Runtime.operations.decideAgentRun.in;
    expect(schema.safeParse({ runId: "r", decision: "edit", editedArgs: { a: 1 } }).success).toBe(true);
    expect(schema.safeParse({ runId: "r", decision: "edit" }).success).toBe(false);
    expect(schema.safeParse({ runId: "r", decision: "approve" }).success).toBe(true);
    expect(schema.safeParse({ runId: "r", decision: "approve", editedArgs: {} }).success).toBe(false);
    expect(schema.safeParse({ runId: "r", decision: "reject", editedArgs: {} }).success).toBe(false);
    expect(schema.safeParse({ runId: "r", decision: "respond" }).success).toBe(false);
  });
});
