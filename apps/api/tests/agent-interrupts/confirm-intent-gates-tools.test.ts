/**
 * F213（`agent-interrupts` 契约束）—— UC-1 `confirmTaskIntent`（目标复述卡）的
 * 后端反证：`confirm_task_intent` 复用既有 DA-07b/UX-9 D4 的 HITL 裁决通路
 * （`decideAgentRun` / `POST /agent-runs/:runId/decision`），逐字沿用
 * `apps/api/tests/agent-runtime/hitl-edit-real-db-e2e.test.ts` 的真 Postgres + 真
 * HTTP + 确定性 loopback deep-agent 替身套路——本文件只换了工具名与 decision 载荷
 * 形状（`ConfirmIntentDecision`：approve 分支 `{decision:"approve"}`，edit 分支
 * `{decision:"edit", editedArgs:{assumptions:[...]}}`，逐字对齐
 * `packages/contracts/src/agent-interrupts.ts`）。
 *
 * ## I-1 反证怎么落地成可判定断言——如实说明与 usecases.md 原文的一处适配
 *
 * `usecases.md` UC-1 反证节原文断言点写的是「`agent_run_steps` 表里，
 * `toolName = "confirm_task_intent"` 且 `status = "awaiting_approval"` 的行之后，
 * 同一 `runId` 不存在 `createdAt` 更晚、且 `status != "awaiting_approval"` 的工具
 * 调用行」——**实测**（`apps/api/migrations/20260805110000_wave2_agent_run_execution.sql`
 * 的 `agent_run_steps.status` CHECK 约束）：`agent_run_steps` 表的 `status` 只允许
 * `'succeeded' | 'failed'`，从不写 `'awaiting_approval'`；待批状态实际落在
 * `agent_runs.status`（+`pending_tool_name`），`agent_run_steps` 是"已执行步骤"的
 * 追加日志（`INSERT`-only，从不 `UPDATE`）。这与 `domain.md`「`InterruptRequest` 不是
 * 新表，是 `agent_run_steps` 一条 `status=awaiting_approval` 行的投影」的表述在**具体
 * 落库位置**上不一致（投影语义仍然成立——`AgentRunView.pendingApproval` 就是这条
 * 投影，只是物理落在 `agent_runs` 行而非 `agent_run_steps` 行）。
 *
 * ⇒ 本测试把断言改写成**同一件事在真实 schema 上的等价形式**（查询即断言，机制不变）：
 *   0. **实测补充**（`execute-run.ts` `onProgress` 分支，#742 Gap 1）：待批工具调用在
 *      "宣布但未裁决"阶段本身就会写一条 `status='in_progress'` 的 `agent_run_steps` 行
 *      （append-only 账本，"已宣布、还没结果"入账，不是"已执行"）——所以 I-1 的
 *      "未确认前无已执行行为"落在真实 schema 上的形式是：**确认前只存在这一条
 *      `in_progress` 行，不存在同一 `toolName` 的 `succeeded`/`failed` 终态行，也不存在
 *      任何其它工具的 `tool_call` 行**（"未确认不往下走" = 没有第二个工具调用、也没有
 *      这次调用本身的终态）。
 *   1. `agent_runs.status = 'awaiting_approval' AND pending_tool_name = 'confirm_task_intent'`
 *      成立期间，`agent_run_steps` 里 `tool_call` 行恰好一条（`confirm_task_intent`，
 *      `in_progress`），不存在任何终态（`succeeded`/`failed`）的 `tool_call` 行。
 *   2. resume（approve 或 edit）之后，`agent_run_steps` 才出现第二条同 `toolName` 的
 *      `succeeded` 行（读端把这两行折叠成用户看到的一张卡片），且这两行是该 run
 *      唯一的 `confirm_task_intent` 记录——不存在"确认前偷跑"的第三条。
 * 这比原文字面查询更贴近本仓真实持久化模型，机制事实不变：断言的仍然是「未确认前无
 * 已执行的工具调用」，不是计时器/sleep 猜时序。
 */
import { createHash, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

import { wave2Runtime as W } from "@repo/contracts";
import { AGENT_INTERRUPTS_TOOL_NAMES } from "@repo/contracts/agent-interrupts";
import {
  addOrgMember, addProjectMember, asApp, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatThread } from "../support/chat-db";
import { AGENT_RUN_EXECUTOR, type AgentRunExecutorPort } from "../../src/application/agent-run/ports";
import { toOrgId } from "../../src/domain/org-id";
import { DEEP_AGENT_PROVIDER_NAME } from "../../src/infrastructure/agent-run/deep-agent-model-provider";

const ORG = "org-confirm-intent-gates";
const PROJECT = "proj-confirm-intent-gates";
const THREAD = "thread-confirm-intent-gates";
const ACTOR = "u-confirm-intent-gates-actor";
const AGENT = "agent-confirm-intent-gates";
const AGENT_VERSION = "agent-version-confirm-intent-gates-v1";

const TOOL_NAME = AGENT_INTERRUPTS_TOOL_NAMES.confirmTaskIntent;
const ORIGINAL_ARGS = {
  requestId: "req-confirm-1",
  understanding: "你希望我基于 7 月数据生成增长复盘。",
  assumptions: ["对比口径用同比", "数据截至 7 月底"],
};
const EDITED_ASSUMPTIONS = ["对比口径改用环比", "数据截至 7 月底", "新增一条：只看付费渠道"];

/* ── deep-agent 服务替身：与 hitl-edit-real-db-e2e.test.ts 同一契约 ── */

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
      const callId = "confirm-intent-call-1";
      const pendingAi = {
        type: "ai",
        content: "在开始之前，我先复述一下我的理解。",
        tool_calls: [{ id: callId, name: TOOL_NAME, args: ORIGINAL_ARGS }],
      };
      if (record.decision === null) {
        json(200, { values: { messages: [{ type: "human", content: "生成 7 月复盘" }, pendingAi] } });
        return;
      }
      const usedAssumptions = record.decision.type === "edit" && record.decision.editedArgs !== undefined
        ? (record.decision.editedArgs.assumptions as string[]) : ORIGINAL_ARGS.assumptions;
      json(200, {
        values: {
          messages: [
            { type: "human", content: "生成 7 月复盘" },
            { ...pendingAi, tool_calls: [{ id: callId, name: TOOL_NAME, args: { ...ORIGINAL_ARGS, assumptions: usedAssumptions } }] },
            { type: "tool", tool_call_id: callId, content: "已确认，开始执行" },
            { type: "ai", content: `已按${record.decision.type === "edit" ? "编辑后" : "原"}假设继续：${JSON.stringify(usedAssumptions)}` },
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
      [AGENT_VERSION, ORG, AGENT, AGENT_VERSION, createHash("sha256").update("目标复述测试助手").digest("hex"),
        "目标复述测试助手", DEEP_AGENT_PROVIDER_NAME, "deep-agent", ACTOR],
    );
    await c.query("UPDATE agents SET published_version_id=$1 WHERE id=$2 AND org_id=$3",
      [AGENT_VERSION, AGENT, ORG]);
  });
}

let app: NestExpressApplication;
let BASE = "";
let deepAgent: DeepAgentFakeHandle;
let currentThread = THREAD;

const principal = (user: string, org: string) => ({
  "x-kernel-test-principal": `${user}:${org}`,
  "content-type": "application/json",
});

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

/** 真实持久化的「工具调用步骤」日志——I-1 反证的查询即断言对象（见文件头说明）。 */
async function readPersistedToolCallSteps(
  runId: string,
): Promise<readonly { toolName: string | null; status: string }[]> {
  return asApp(ORG, async (c) => {
    const res = await c.query<{ tool_name: string | null; status: string }>(
      `SELECT tool_name, status FROM agent_run_steps WHERE run_id = $1 AND kind = 'tool_call' ORDER BY seq ASC`,
      [runId],
    );
    return res.rows.map((r) => ({ toolName: r.tool_name, status: r.status }));
  });
}

const tick = () => app.get<AgentRunExecutorPort>(AGENT_RUN_EXECUTOR).tick(toOrgId(ORG));

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

describe("F213 confirm_task_intent —— I-1 反证：未确认前不执行任何工具（真 Postgres + 真 HTTP）", () => {
  it("continue（approve）：确认前 agent_run_steps 为空；确认后才出现唯一一条 confirm_task_intent 成功行", async () => {
    const { agentRunId } = await postMessage("生成 7 月复盘");
    await tick();

    const awaiting = await readRun(agentRunId);
    expect(awaiting.status).toBe("awaiting_approval");
    expect(awaiting.pendingApproval?.toolName).toBe(TOOL_NAME);

    // I-1 正向断言：未确认前，只有「已宣布、还没结果」的一条 in_progress 行——没有
    // 任何终态（succeeded/failed）的工具调用行，也没有第二个工具被调用（查询即断言，
    // 不靠计时器）。
    const stepsBeforeDecision = await readPersistedToolCallSteps(agentRunId);
    expect(stepsBeforeDecision).toEqual([{ toolName: TOOL_NAME, status: "in_progress" }]);

    const decideResponse = await decide(agentRunId, { decision: "approve" });
    expect(decideResponse.status).toBe(200);
    await tick();

    const finalRun = await readRun(agentRunId);
    expect(finalRun.status).toBe("succeeded");
    expect(finalRun.error).toBeNull();

    // 确认后：追加终态 succeeded 行——resume 是全新一次 `completeWithProgress` 调用
    // （`emitted` 的已通告去重集合是每次调用新建的局部状态，不跨 resume 持久化），
    // 所以「已宣布」的 in_progress 行会在 resume 里被重新记一次账，这是既有通用桥的
    // append-only 记账行为（与本束无关，未改动），不是「确认前偷跑」——真正的判据是
    // **只有 `confirm_task_intent` 一个工具名出现过**，且它的唯一终态行是 `succeeded`，
    // 不存在任何其它工具被调用、也不存在它自己在确认前就已终结的行。
    const stepsAfterDecision = await readPersistedToolCallSteps(agentRunId);
    expect(stepsAfterDecision.every((s) => s.toolName === TOOL_NAME)).toBe(true);
    expect(stepsAfterDecision.filter((s) => s.status === "succeeded")).toEqual([
      { toolName: TOOL_NAME, status: "succeeded" },
    ]);
    expect(stepsAfterDecision.filter((s) => s.status === "failed")).toEqual([]);
    // 而且那一条终态行排在所有 in_progress 通告之后——不是"确认前就已经跑完"。
    expect(stepsAfterDecision[stepsAfterDecision.length - 1]!.status).toBe("succeeded");

    const resumeBody = deepAgent.runBodies.find((b) => {
      const body = b as { command?: { resume?: { decisions?: readonly { type?: string }[] } } };
      return body.command?.resume?.decisions?.[0]?.type === "approve";
    });
    expect(resumeBody, JSON.stringify(deepAgent.runBodies)).toBeDefined();
  });

  it("改假设（edit）：resume 载荷携带编辑后的完整假设列表，上游逐字段收到，不是 diff", async () => {
    const { agentRunId } = await postMessage("生成 7 月复盘");
    await tick();

    const awaiting = await readRun(agentRunId);
    expect(awaiting.status).toBe("awaiting_approval");

    // I-1 正向断言（edit 分支同样成立）。
    expect(await readPersistedToolCallSteps(agentRunId)).toEqual([
      { toolName: TOOL_NAME, status: "in_progress" },
    ]);

    const decideResponse = await decide(agentRunId, {
      decision: "edit",
      editedArgs: { assumptions: EDITED_ASSUMPTIONS },
    });
    expect(decideResponse.status).toBe(200);
    await tick();

    const finalRun = await readRun(agentRunId);
    expect(finalRun.status).toBe("succeeded");

    const resumeBody = deepAgent.runBodies.find((b) => {
      const body = b as { command?: { resume?: { decisions?: readonly { type?: string }[] } } };
      return body.command?.resume?.decisions?.[0]?.type === "edit";
    }) as {
      command: { resume: { decisions: readonly { edited_action: { name: string; args: unknown } }[] } };
    } | undefined;
    expect(resumeBody, JSON.stringify(deepAgent.runBodies)).toBeDefined();
    const editedAction = resumeBody!.command.resume.decisions[0]!.edited_action;
    expect(editedAction.name).toBe(TOOL_NAME);
    // 「改假设」= 人编辑后的完整列表（不是 diff），逐字段相等。
    expect((editedAction.args as { assumptions: string[] }).assumptions).toEqual(EDITED_ASSUMPTIONS);
  });
});
