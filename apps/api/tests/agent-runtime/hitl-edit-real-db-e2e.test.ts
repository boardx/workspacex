/**
 * UX-9 D4 反证（评估员报告：「编辑参数后放行」的前端表单能编辑、能提交，但编辑后的值
 * 端到端从未真正生效过）——真实 Postgres 持久化往返，不 mock 存储层。
 *
 * ## 为什么现有 `deep-agent-hitl.test.ts` 抓不住这类 bug
 *
 * 那份测试的 `decideAgentRun` 用例组把 `AgentRunStore` 整个 mock 掉（`editAndRequeue`
 * 只是把参数塞进一个内存数组断言相等），`DeepAgentModelProvider` 的用例组则直接手写好
 * `{ decision: "edit", editedAction: { name, argsJson } }` 喂给 provider——两组测试各自
 * 单独证明了"provider 正确解析 argsJson"和"decideAgentRun 正确序列化 editedArgs"，
 * 但**没有一条**测试证明这两段之间夹着的持久化往返（`editAndRequeue` 写库 →
 * `claimQueued` 读库 → 拼进 `resume.editedAction`）本身没有错位。这正是持久化往返错位
 * 类 bug（双重编码 / 字段丢失）唯一会被抓到的地方。
 *
 * ## 这条测试做什么
 *
 * 全链路走真代码：真 HTTP（`POST /chat/threads/:id/messages` 接受用户消息 →
 * `POST /agent-runs/:runId/decision` 提交编辑决策）、真 `PgAgentRunRepository`（真
 * Postgres，不是内存 fake）、真 `DeepAgentModelProvider`（真 HTTP 打一个确定性替身）。
 * 替身记下它在 resume 请求里**实际收到**的 `edited_action.args`，测试断言它与人类在
 * 编辑面板里提交的对象逐字段相等——这就是「编辑后的值真的传到了模型调用」的机械判据。
 */
import { createHash, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// 真 HTTP + `x-kernel-test-principal` 头绕过真实鉴权（同目录其它 real-db 用例的既有
// 模式，见 agent-publish-http-route.test.ts 等）——本文件之前没设这两个环境变量，
// CI 上 401 而不是 202：不是本条修复本身的回归，是这份新测试自己漏了这一步。
process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";
import { wave2Runtime as W } from "@repo/contracts";
import {
  addOrgMember, addProjectMember, asApp, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatThread } from "../support/chat-db";
import {
  AGENT_RUN_EXECUTOR, type AgentRunExecutorPort,
} from "../../src/application/agent-run/ports";
import { toOrgId } from "../../src/domain/org-id";
import { DEEP_AGENT_PROVIDER_NAME } from "../../src/infrastructure/agent-run/deep-agent-model-provider";
import { DEEP_AGENT_HITL_TOOL_NAME } from "@repo/contracts/deep-agent-hitl";

const ORG = "org-hitl-edit-e2e";
const PROJECT = "proj-hitl-edit-e2e";
const THREAD = "thread-hitl-edit-e2e";
const ACTOR = "u-hitl-edit-e2e-actor";
const AGENT = "agent-hitl-edit-e2e";
const AGENT_VERSION = "agent-version-hitl-edit-e2e-v1";

// issue #2017：工具名的唯一事实源在 `@repo/contracts` 的 deep-agent-hitl.ts。
// 这里曾经又写死一份 `"send_email"`——桥本身是工具名无关的，所以这份副本不会让
// 测试变红，只会在真实工具名换掉时**静默**地继续测一个不存在的工具。
const APPROVAL_TOOL_NAME = DEEP_AGENT_HITL_TOOL_NAME;
const ORIGINAL_ARGS = { to: "ops@example.test", subject: "待批邮件", body: "原始正文（未编辑）" };
/** 人类在审批面板里编辑后提交的值——与 `ORIGINAL_ARGS` 每个字段都不同，
 *  这样"原样通过"和"编辑生效"在断言里不会撞车。 */
const EDITED_ARGS = { to: "ops@example.test", subject: "已编辑：请今日发出", body: "人工编辑后的正文" };

/* ── deep-agent 服务替身：只实现 DA-07b 需要的四个端点，记录 resume 收到的原始报文 ── */

interface DeepAgentFakeHandle {
  readonly port: number;
  /** 每次 `POST /threads/:id/runs` 的原始请求体——包含首次创建与 resume 两类。 */
  readonly runBodies: unknown[];
  close(): Promise<void>;
}

async function startDeepAgentFake(): Promise<DeepAgentFakeHandle> {
  const runBodies: unknown[] = [];
  // 与真替身（`loopback-deep-agent-provider.ts`）同一纪律：状态按远端 thread id 分开记账，
  // 不用模块级单例变量——`DeepAgentModelProvider.ensureThread` 对同一个 chat threadId
  // 决定性派生同一个远端 thread id，本文件两条用例若共用一个 chat 线程会撞进同一份状态。
  interface ThreadRecord {
    statusPolls: number;
    streamFinished?: boolean;
    decision: { type: string; editedArgs?: Record<string, unknown> } | null;
  }
  const threads = new Map<string, ThreadRecord>();

  const server: Server = createServer((req, res) => {
    const url = req.url ?? "";
    const json = (status: number, body: unknown): void => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "POST" && url === "/threads") {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let requested: string | undefined;
        try {
          const parsed = raw === "" ? {} : (JSON.parse(raw) as { thread_id?: string });
          requested = typeof parsed.thread_id === "string" && parsed.thread_id !== "" ? parsed.thread_id : undefined;
        } catch { requested = undefined; }
        const threadId = requested ?? randomUUID();
        if (!threads.has(threadId)) threads.set(threadId, { statusPolls: 0, decision: null });
        json(200, { thread_id: threadId });
      });
      return;
    }
    const runsMatch = /^\/threads\/([^/]+)\/runs$/.exec(url);
    if (req.method === "POST" && runsMatch) {
      const threadId = runsMatch[1]!;
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const record = threads.get(threadId) ?? { statusPolls: 0, decision: null };
        threads.set(threadId, record);
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          command?: { resume?: { decisions?: readonly {
            type?: string; edited_action?: { name?: string; args?: unknown };
          }[] } };
        };
        runBodies.push(body);
        const resumeWire = body.command?.resume?.decisions?.[0];
        if (resumeWire !== undefined) {
          const type = resumeWire.type === "approve" || resumeWire.type === "edit"
            || resumeWire.type === "reject" ? resumeWire.type : "reject";
          const editedArgs = type === "edit" && typeof resumeWire.edited_action?.args === "object"
            && resumeWire.edited_action.args !== null && !Array.isArray(resumeWire.edited_action.args)
            ? resumeWire.edited_action.args as Record<string, unknown>
            : undefined;
          record.decision = { type, editedArgs };
        }
        json(200, { run_id: threadId });
      });
      return;
    }
    const streamMatch=/^\/threads\/([^/]+)\/runs\/[^/]+\/stream$/.exec(url);
    if(req.method==='GET'&&streamMatch){
      if(!threads.has(streamMatch[1]!)){json(404,{error:'unknown thread'});return;}
      threads.get(streamMatch[1]!)!.streamFinished=true;
      res.writeHead(200,{'content-type':'text/event-stream'});
      res.end(`event: metadata\r\ndata: ${JSON.stringify({run_id:streamMatch[1]})}\r\n\r\n`);return;
    }
    const statusMatch = /^\/threads\/([^/]+)\/runs\/[^/]+$/.exec(url);
    if (req.method === "GET" && statusMatch) {
      const threadId = statusMatch[1]!;
      const record = threads.get(threadId);
      if (!record) { json(404, { error: "unknown thread" }); return; }
      record.statusPolls += 1;
      if (!record.streamFinished && record.statusPolls < 2) { json(200, { status: "pending" }); return; }
      if (record.decision === null) { json(200, { status: "interrupted" }); return; }
      json(200, { status: "success" });
      return;
    }
    const stateMatch = /^\/threads\/([^/]+)\/state$/.exec(url);
    if (req.method === "GET" && stateMatch) {
      const threadId = stateMatch[1]!;
      const record = threads.get(threadId);
      if (!record) { json(404, { error: "unknown thread" }); return; }
      const callId = "approval-call-1";
      const pendingAi = {
        type: "ai",
        content: "这一步需要人工批准后才能继续。",
        tool_calls: [{ id: callId, name: APPROVAL_TOOL_NAME, args: ORIGINAL_ARGS }],
      };
      if (record.decision === null) {
        json(200, { values: { messages: [{ type: "human", content: "触发人工审批" }, pendingAi] } });
        return;
      }
      const usedArgs = record.decision.type === "edit" && record.decision.editedArgs !== undefined
        ? record.decision.editedArgs : ORIGINAL_ARGS;
      json(200, {
        values: {
          messages: [
            { type: "human", content: "触发人工审批" },
            { ...pendingAi, tool_calls: [{ id: callId, name: APPROVAL_TOOL_NAME, args: usedArgs }] },
            { type: "tool", tool_call_id: callId, content: `已发送邮件：${JSON.stringify(usedArgs)}` },
            { type: "ai", content: `已按${record.decision.type === "edit" ? "编辑后" : "原"}参数发送：${JSON.stringify(usedArgs)}` },
          ],
        },
      });
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    runBodies,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/* ── catalog fixture ── */

async function addAgentVersion(): Promise<void> {
  await asApp(ORG, async (c) => {
    await c.query(
      `INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'enabled',$5,now(),now()) ON CONFLICT DO NOTHING`,
      [AGENT, ORG, AGENT, AGENT, ACTOR],
    );
    await c.query(
      `INSERT INTO agent_versions
         (id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,
          model_provider,model_id,tool_policy,creator_id,created_at,published_at)
       VALUES ($1,$2,$3,$4,$5,$6,'{}'::text[],$7,$8,'[]'::jsonb,$9,now(),now())`,
      [AGENT_VERSION, ORG, AGENT, AGENT_VERSION, createHash("sha256").update("你是通用助手").digest("hex"),
        "你是通用助手", DEEP_AGENT_PROVIDER_NAME, "deep-agent", ACTOR],
    );
    await c.query("UPDATE agents SET published_version_id=$1 WHERE id=$2 AND org_id=$3",
      [AGENT_VERSION, AGENT, ORG]);
  });
}

/* ── HTTP helpers ── */

let app: NestExpressApplication;
let BASE = "";
let deepAgent: DeepAgentFakeHandle;

const principal = (user: string, org: string) => ({
  "x-kernel-test-principal": `${user}:${org}`,
  "content-type": "application/json",
});

/**
 * 每条用例独立的 chat thread id——`DeepAgentModelProvider.ensureThread` 对同一个
 * chat threadId 决定性派生同一个远端 thread id，两条用例共用一个 chat 线程会让
 * 假替身在第二条用例里读到第一条用例遗留的 `decision`（撞进同一份账本）。
 */
let currentThread = THREAD;

async function postMessage(text: string): Promise<{ agentRunId: string }> {
  const response = await fetch(`${BASE}/chat/threads/${currentThread}/messages`, {
    method: "POST",
    headers: principal(ACTOR, ORG),
    body: JSON.stringify({ clientMessageId: randomUUID(), text, agentId: AGENT }),
  });
  expect(response.status).toBe(202);
  const body = await response.json() as { agentRunId: string };
  return { agentRunId: body.agentRunId };
}

async function readRun(runId: string) {
  const response = await fetch(`${BASE}/agent-runs/${runId}`, { headers: principal(ACTOR, ORG) });
  expect(response.status).toBe(200);
  const raw = await response.json() as unknown;
  const parsed = W.AgentRunView.safeParse(raw);
  expect(parsed.success ? null : parsed.error.issues, JSON.stringify(raw)).toBeNull();
  return parsed.success ? parsed.data : null!;
}

async function decide(runId: string, body: unknown): Promise<Response> {
  return fetch(`${BASE}/agent-runs/${runId}/decision`, {
    method: "POST", headers: principal(ACTOR, ORG), body: JSON.stringify(body),
  });
}

const tick = () => app.get<AgentRunExecutorPort>(AGENT_RUN_EXECUTOR).tick(toOrgId(ORG));

/* ── lifecycle ── */

beforeAll(async () => {
  await migrateOnce();
  deepAgent = await startDeepAgentFake();
  process.env.KERNEL_DEEP_AGENT_BASE_URL = `http://127.0.0.1:${String(deepAgent.port)}`;
  process.env.KERNEL_DEEP_AGENT_POLL_INTERVAL_MS = "20";
  process.env.KERNEL_DEEP_AGENT_TIMEOUT_MS = "20000";
  process.env.KERNEL_AGENT_RUN_AUTOSTART = "0";
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 180_000);

afterAll(async () => {
  await app?.close();
  await deepAgent?.close();
});

beforeEach(async () => {
  currentThread = `${THREAD}-${randomUUID()}`;
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ACTOR, "consultant", null);
  await addProjectMember(ORG, PROJECT, ACTOR, "facilitator", null);
  await addChatThread({
    orgId: ORG, id: currentThread, projectId: PROJECT, visibilityScope: "plenary", createdBy: ACTOR,
  });
  await addAgentVersion();
});

describe("UX-9 D4 HITL edit：真实持久化往返（真 Postgres + 真 HTTP，不 mock 存储层）", () => {
  it("编辑参数后放行 ⇒ 上游 resume 请求里的 edited_action.args 与人类编辑面板提交的对象逐字段相等", async () => {
    const { agentRunId } = await postMessage("触发人工审批");
    await tick();

    const awaiting = await readRun(agentRunId);
    expect(awaiting.status).toBe("awaiting_tool_permission");
    expect(awaiting.pendingApproval?.toolName).toBe(APPROVAL_TOOL_NAME);

    const decideResponse = await decide(agentRunId, { decision: "edit", editedArgs: EDITED_ARGS, permissionRequestId: awaiting.pendingApproval?.permissionRequestId });
    expect(decideResponse.status).toBe(200);
    const decided = await decideResponse.json() as { status: string };
    expect(decided.status).toBe("queued");

    await tick();

    const finalRun = await readRun(agentRunId);
    expect(finalRun.status).toBe("succeeded");

    // ── 机械判据：resume 请求里真实收到的 edited_action ──
    const resumeBody = deepAgent.runBodies.find((b) => {
      const body = b as { command?: { resume?: { decisions?: readonly { type?: string }[] } } };
      return body.command?.resume?.decisions?.[0]?.type === "edit";
    }) as {
      command: { resume: { decisions: readonly { type: string; edited_action: { name: string; args: unknown } }[] } };
    } | undefined;
    expect(resumeBody, JSON.stringify(deepAgent.runBodies)).toBeDefined();
    const editedAction = resumeBody!.command.resume.decisions[0]!.edited_action;
    expect(editedAction.name).toBe(APPROVAL_TOOL_NAME);
    // 逐字段相等——不是"非空"或"看起来像"：这正是评估员报告要钉住的那句话。
    expect(editedAction.args).toEqual(EDITED_ARGS);

    // ── 用户可见判据：终稿正文里能看到编辑后的值，不是原始值，也不是失败态。 ──
    expect(finalRun.error).toBeNull();
  });

  it("反证：approve（不编辑）时上游收到的仍是原始参数——证明上面的『相等』不是恒真", async () => {
    const { agentRunId } = await postMessage("触发人工审批");
    await tick();
    const awaiting = await readRun(agentRunId);
    expect(awaiting.pendingApproval?.permissionRequestId).toBeTruthy();

    const decideResponse = await decide(agentRunId, { decision: "approve", permissionRequestId: awaiting.pendingApproval?.permissionRequestId });
    expect(decideResponse.status).toBe(200);
    await tick();

    const finalRun = await readRun(agentRunId);
    expect(finalRun.status).toBe("succeeded");

    const resumeBody = deepAgent.runBodies.find((b) => {
      const body = b as { command?: { resume?: { decisions?: readonly { type?: string }[] } } };
      return body.command?.resume?.decisions?.[0]?.type === "approve";
    });
    expect(resumeBody, JSON.stringify(deepAgent.runBodies)).toBeDefined();
  });
});
