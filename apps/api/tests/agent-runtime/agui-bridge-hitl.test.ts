/**
 * DA-19g -- the AG-UI/CopilotRuntime bridge's HITL approval semantics, end to end over a
 * real socket, real Postgres, and a real (loopback) deep-agent HTTP server -- not the wire
 * frames `copilotkit-v2-hitl.spec.ts` (browser e2e) captures for a real `useHumanInTheLoop`,
 * but the SAME two-request shape it drives: a first `POST /copilotkit/agui` that trips the
 * interrupt, and a second one shaped exactly like `@copilotkit/core`'s synthesized
 * `{role:"tool", toolCallId, content}` follow-up (see `copilotkit-agui.controller.ts`'s
 * `isHitlResumeRequest` doc for why that shape, traced from the real package source, is the
 * resume signal).
 *
 * Mirrors `hitl-edit-real-db-e2e.test.ts`'s fake deep-agent server almost verbatim (same
 * `/threads`, `/threads/:id/runs`, `/threads/:id/runs/:runId`, `/threads/:id/state`
 * contract) -- that file already proved persisted-args round-tripping through the REST
 * `/agent-runs/:runId/decision` path; this file proves the SAME underlying resume machinery
 * (`decideAgentRun`) is reachable from the AG-UI bridge's two-request HITL shape instead.
 */
import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EventType } from "@ag-ui/core";
import { DEEP_AGENT_HITL_TOOL_NAME } from "@repo/contracts/deep-agent-hitl";
import { DEEP_AGENT_PROVIDER_NAME } from "../../src/infrastructure/agent-run/deep-agent-model-provider";
import {
  addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-agui-hitl";
const PROJECT = "proj-agui-hitl";
const ACTOR = "u-agui-hitl-actor";
const AGENT = "agent-agui-hitl";
const AGENT_VERSION = "agent-version-agui-hitl-v1";

// issue #2017：工具名的唯一事实源在 `@repo/contracts` 的 deep-agent-hitl.ts。
// 这里曾经又写死一份 `"send_email"`——桥本身是工具名无关的，所以这份副本不会让
// 测试变红，只会在真实工具名换掉时**静默**地继续测一个不存在的工具。
const APPROVAL_TOOL_NAME = DEEP_AGENT_HITL_TOOL_NAME;
const ORIGINAL_ARGS = { to: "ops@example.test", subject: "待批邮件", body: "原始正文（未编辑）" };
const EDITED_ARGS = { to: "ops@example.test", subject: "已编辑：请今日发出", body: "人工编辑后的正文" };
const TRIGGER_TEXT = "触发人工审批";

const sha256 = (v: string): string => createHash("sha256").update(v).digest("hex");

/* ── deep-agent 服务替身：与 hitl-edit-real-db-e2e.test.ts 同一契约，供两条 HTTP 路径共用 ── */

interface DeepAgentFakeHandle {
  readonly port: number;
  readonly runBodies: unknown[];
  close(): Promise<void>;
}

async function startDeepAgentFake(): Promise<DeepAgentFakeHandle> {
  const runBodies: unknown[] = [];
  interface ThreadRecord {
    statusPolls: number;
    decision: { type: string; editedArgs?: Record<string, unknown> } | null;
  }
  const threads = new Map<string, ThreadRecord>();

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
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
    const statusMatch = /^\/threads\/([^/]+)\/runs\/[^/]+$/.exec(url);
    if (req.method === "GET" && statusMatch) {
      const threadId = statusMatch[1]!;
      const record = threads.get(threadId);
      if (!record) { json(404, { error: "unknown thread" }); return; }
      record.statusPolls += 1;
      if (record.statusPolls < 2) { json(200, { status: "pending" }); return; }
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
        json(200, { values: { messages: [{ type: "human", content: TRIGGER_TEXT }, pendingAi] } });
        return;
      }
      const usedArgs = record.decision.type === "edit" && record.decision.editedArgs !== undefined
        ? record.decision.editedArgs : ORIGINAL_ARGS;
      json(200, {
        values: {
          messages: [
            { type: "human", content: TRIGGER_TEXT },
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

async function addPublishedAgentVersion(): Promise<void> {
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
      [AGENT_VERSION, ORG, AGENT, AGENT_VERSION, sha256("agui hitl instructions"),
        "You are the AG-UI HITL test agent.", DEEP_AGENT_PROVIDER_NAME, "deep-agent", ACTOR],
    );
    await c.query("UPDATE agents SET published_version_id=$1 WHERE id=$2 AND org_id=$3", [AGENT_VERSION, AGENT, ORG]);
  });
}

let app: NestExpressApplication;
let BASE = "";
let deepAgent: DeepAgentFakeHandle;

const principal = (user: string, org: string) => ({
  "x-kernel-test-principal": `${user}:${org}`,
  "content-type": "application/json",
});

interface ParsedSseEvent {
  readonly type: EventType;
  readonly [key: string]: unknown;
}

function parseSse(raw: string): ParsedSseEvent[] {
  return raw
    .split("\n\n")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice("data: ".length)) as ParsedSseEvent);
}

async function postAgui(body: unknown): Promise<{ status: number; events: ParsedSseEvent[] }> {
  const url = new URL(`${BASE}/copilotkit/agui`);
  url.searchParams.set("agentId", AGENT);
  const response = await fetch(url, {
    method: "POST", headers: principal(ACTOR, ORG), body: JSON.stringify(body),
  });
  const raw = await response.text();
  return { status: response.status, events: parseSse(raw) };
}

function chatThreadIdOf(events: readonly ParsedSseEvent[]): string {
  const custom = events.find((e) => e.type === EventType.CUSTOM && e.name === "chat_thread_id");
  expect(custom, JSON.stringify(events)).toBeDefined();
  return custom!.value as string;
}

async function permissionRequestIdOf(events: readonly ParsedSseEvent[]): Promise<string> {
  const event = events.find((e) => e.type === EventType.CUSTOM && e.name === "execution_event");
  const runId = (event?.value as { runId?: string } | undefined)?.runId;
  expect(runId).toBeTruthy();
  const response = await fetch(`${BASE}/agent-runs/${runId}`, { headers: principal(ACTOR, ORG) });
  expect(response.status).toBe(200);
  const body = await response.json() as { pendingApproval: { permissionRequestId: string } };
  expect(body.pendingApproval.permissionRequestId).toBeTruthy();
  return body.pendingApproval.permissionRequestId;
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  deepAgent = await startDeepAgentFake();
  process.env.KERNEL_DEEP_AGENT_BASE_URL = `http://127.0.0.1:${String(deepAgent.port)}`;
  process.env.KERNEL_DEEP_AGENT_POLL_INTERVAL_MS = "5";
  process.env.KERNEL_DEEP_AGENT_TIMEOUT_MS = "10000";
  delete process.env.KERNEL_AGENT_RUN_AUTOSTART;
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
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ACTOR, "consultant", null);
  await addProjectMember(ORG, PROJECT, ACTOR, "facilitator", null);
  await addPublishedAgentVersion();
});

describe("POST /copilotkit/agui -- DA-19g HITL 审批语义（真实两次 POST，真 Postgres，真 deep-agent 替身）", () => {
  it("第一轮：待批工具调用只到 TOOL_CALL_END，不提前发 RESULT，run 以 RUN_FINISHED 收场（不是超时）", async () => {
    const first = await postAgui({
      threadId: randomUUID(), runId: randomUUID(),
      messages: [{ id: randomUUID(), role: "user", content: TRIGGER_TEXT }],
    });
    expect(first.status, JSON.stringify(first.events)).toBe(200);

    const types = first.events.map((e) => e.type);
    expect(types).toContain(EventType.TOOL_CALL_START);
    expect(types).toContain(EventType.TOOL_CALL_END);
    // The core DA-19g fix: no synthesized empty RESULT for a still-pending call. STEP_FINISHED
    // DOES still close (a real `@ag-ui/client` rejects RUN_FINISHED while a step is still
    // "active" -- see `writeToolCallStep`'s own doc); it is only the tool-call-result half
    // that stays dangling.
    expect(types).not.toContain(EventType.TOOL_CALL_RESULT);
    // Journal relays may omit step envelopes; if opened, every step must still close.
    expect(types.filter((type) => type === EventType.STEP_FINISHED)).toHaveLength(
      types.filter((type) => type === EventType.STEP_STARTED).length,
    );
    // Not a timeout/error -- a genuine "yielded control" finish, exactly like a real
    // frontend-tool call.
    expect(types).not.toContain(EventType.RUN_ERROR);
    expect(types[types.length - 1]).toBe(EventType.RUN_FINISHED);

    const toolStart = first.events.find((e) => e.type === EventType.TOOL_CALL_START);
    expect(toolStart?.toolCallName).toBe(APPROVAL_TOOL_NAME);
    const toolArgs = first.events.find((e) => e.type === EventType.TOOL_CALL_ARGS);
    expect(JSON.parse(toolArgs?.delta as string)).toMatchObject({ to: "ops@example.test" });
  }, 30_000);

  it("identity-less resume cannot approve a newly persisted request", async () => {
    const first = await postAgui({ threadId: randomUUID(), runId: randomUUID(),
      messages: [{ id: randomUUID(), role: "user", content: TRIGGER_TEXT }] });
    const count = deepAgent.runBodies.length;
    const resumed = await postAgui({ threadId: randomUUID(), runId: randomUUID(),
      forwardedProps: { chatThreadId: chatThreadIdOf(first.events) },
      messages: [{ role: "tool", toolCallId: first.events.find((e) => e.type === EventType.TOOL_CALL_START)?.toolCallId, content: "approved" }] });
    expect(resumed.events.find((e) => e.type === EventType.RUN_ERROR)?.code).toBe("AGENT_RUN_NOT_AWAITING_TOOL_PERMISSION");
    expect(deepAgent.runBodies).toHaveLength(count);
  }, 30_000);

  it("approve：resume 请求把 run 续跑到 succeeded，上游收到 decision=approve 与原始参数", async () => {
    const first = await postAgui({
      threadId: randomUUID(), runId: randomUUID(),
      messages: [{ id: randomUUID(), role: "user", content: TRIGGER_TEXT }],
    });
    const chatThreadId = chatThreadIdOf(first.events);
    const toolCallId = first.events.find((e) => e.type === EventType.TOOL_CALL_START)?.toolCallId as string;

    const resumed = await postAgui({
      threadId: randomUUID(), runId: randomUUID(),
      forwardedProps: { chatThreadId, permissionRequestId: await permissionRequestIdOf(first.events) },
      messages: [
        { id: randomUUID(), role: "user", content: TRIGGER_TEXT },
        { id: randomUUID(), role: "tool", toolCallId, content: "approved" },
      ],
    });
    expect(resumed.status, JSON.stringify(resumed.events)).toBe(200);
    const types = resumed.events.map((e) => e.type);
    expect(types).not.toContain(EventType.RUN_ERROR);
    expect(types[types.length - 1]).toBe(EventType.RUN_FINISHED);

    const resumeBody = deepAgent.runBodies.find((b) => {
      const body = b as { command?: { resume?: { decisions?: readonly { type?: string }[] } } };
      return body.command?.resume?.decisions?.[0]?.type === "approve";
    });
    expect(resumeBody, JSON.stringify(deepAgent.runBodies)).toBeDefined();

    const finalText = resumed.events.filter((e) => e.type === EventType.TEXT_MESSAGE_CONTENT)
      .map((e) => e.delta as string).join("");
    expect(finalText).toContain(JSON.stringify(ORIGINAL_ARGS));

    // DA-19g -- real browser e2e caught this: without cursoring the resume poll from where
    // turn one's poll left off, the resumed SSE stream re-announces the ALREADY-REPORTED
    // pending `send_email` tool call (and re-streams turn one's own initial answer chunk) a
    // second time. Neither may appear again in the RESUME's own event stream -- both were
    // already delivered to the client during the FIRST turn's response.
    expect(resumed.events.filter((e) => e.type === EventType.STEP_STARTED
      && (e as unknown as { stepName?: string }).stepName === APPROVAL_TOOL_NAME)).toHaveLength(0);
    // The resumed attempt may report its actual tool execution under a new identity;
    // the already delivered event from the original attempt must never be replayed.
    expect(resumed.events.filter((e) => e.type === EventType.TOOL_CALL_START
      && e.toolCallId === toolCallId)).toHaveLength(0);
  }, 30_000);

  it("edit：resume 请求携带编辑后的对象，上游收到的 edited_action.args 与提交对象逐字段相等", async () => {
    const first = await postAgui({
      threadId: randomUUID(), runId: randomUUID(),
      messages: [{ id: randomUUID(), role: "user", content: TRIGGER_TEXT }],
    });
    const chatThreadId = chatThreadIdOf(first.events);
    const toolCallId = first.events.find((e) => e.type === EventType.TOOL_CALL_START)?.toolCallId as string;

    const resumed = await postAgui({
      threadId: randomUUID(), runId: randomUUID(),
      forwardedProps: { chatThreadId, permissionRequestId: await permissionRequestIdOf(first.events) },
      messages: [
        { id: randomUUID(), role: "user", content: TRIGGER_TEXT },
        { id: randomUUID(), role: "tool", toolCallId, content: JSON.stringify(EDITED_ARGS) },
      ],
    });
    expect(resumed.status, JSON.stringify(resumed.events)).toBe(200);
    expect(resumed.events.map((e) => e.type)).not.toContain(EventType.RUN_ERROR);

    const resumeBody = deepAgent.runBodies.find((b) => {
      const body = b as { command?: { resume?: { decisions?: readonly { type?: string }[] } } };
      return body.command?.resume?.decisions?.[0]?.type === "edit";
    }) as {
      command: { resume: { decisions: readonly { edited_action: { name: string; args: unknown } }[] } };
    } | undefined;
    expect(resumeBody, JSON.stringify(deepAgent.runBodies)).toBeDefined();
    const editedAction = resumeBody!.command.resume.decisions[0]!.edited_action;
    expect(editedAction.name).toBe(APPROVAL_TOOL_NAME);
    // 逐字段相等——不是"非空"或"看起来像"。
    expect(editedAction.args).toEqual(EDITED_ARGS);

    const finalText = resumed.events.filter((e) => e.type === EventType.TEXT_MESSAGE_CONTENT)
      .map((e) => e.delta as string).join("");
    expect(finalText).toContain(JSON.stringify(EDITED_ARGS));
  }, 30_000);

  it("reject：resume 请求直接把 run 落 failed(HITL_REJECTED)，且从未向 deep-agent 发起 resume 请求", async () => {
    const first = await postAgui({
      threadId: randomUUID(), runId: randomUUID(),
      messages: [{ id: randomUUID(), role: "user", content: TRIGGER_TEXT }],
    });
    const chatThreadId = chatThreadIdOf(first.events);
    const toolCallId = first.events.find((e) => e.type === EventType.TOOL_CALL_START)?.toolCallId as string;
    const runBodiesBefore = deepAgent.runBodies.length;

    const resumed = await postAgui({
      threadId: randomUUID(), runId: randomUUID(),
      forwardedProps: { chatThreadId, permissionRequestId: await permissionRequestIdOf(first.events) },
      messages: [
        { id: randomUUID(), role: "user", content: TRIGGER_TEXT },
        { id: randomUUID(), role: "tool", toolCallId, content: "denied" },
      ],
    });
    expect(resumed.status, JSON.stringify(resumed.events)).toBe(200);
    const runError = resumed.events.find((e) => e.type === EventType.RUN_ERROR);
    expect(runError, JSON.stringify(resumed.events)).toBeDefined();
    expect(runError?.code).toBe("HITL_REJECTED");

    // #4 -- reject is a local terminal transition (`decideAgentRun` calls `failRun`
    // directly); the loopback deep-agent server never sees a resume for it.
    expect(deepAgent.runBodies.length).toBe(runBodiesBefore);
  }, 30_000);

  it("重复 resume（已经裁决过）诚实报 NO_PENDING_APPROVAL，不是静默成功或 500", async () => {
    const first = await postAgui({
      threadId: randomUUID(), runId: randomUUID(),
      messages: [{ id: randomUUID(), role: "user", content: TRIGGER_TEXT }],
    });
    const chatThreadId = chatThreadIdOf(first.events);
    const toolCallId = first.events.find((e) => e.type === EventType.TOOL_CALL_START)?.toolCallId as string;

    await postAgui({
      threadId: randomUUID(), runId: randomUUID(),
      forwardedProps: { chatThreadId, permissionRequestId: await permissionRequestIdOf(first.events) },
      messages: [
        { id: randomUUID(), role: "user", content: TRIGGER_TEXT },
        { id: randomUUID(), role: "tool", toolCallId, content: "approved" },
      ],
    });

    const secondResume = await postAgui({
      threadId: randomUUID(), runId: randomUUID(),
      forwardedProps: { chatThreadId, permissionRequestId: await permissionRequestIdOf(first.events) },
      messages: [
        { id: randomUUID(), role: "user", content: TRIGGER_TEXT },
        { id: randomUUID(), role: "tool", toolCallId, content: "approved" },
      ],
    });
    expect(secondResume.status, JSON.stringify(secondResume.events)).toBe(200);
    const runError = secondResume.events.find((e) => e.type === EventType.RUN_ERROR);
    expect(runError, JSON.stringify(secondResume.events)).toBeDefined();
    expect(runError?.code).toBe("NO_PENDING_APPROVAL");
  }, 30_000);
});
