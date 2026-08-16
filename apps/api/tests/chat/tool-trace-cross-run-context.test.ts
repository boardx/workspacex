/**
 * F190（design-delta `tool-trace-cross-run-context`，PR #1409 已签核）—— **真实 Postgres +
 * 真实 `executeQueuedRuns` 全链路**反证：工具调用轨迹跨 run 回喂上下文（L1/L2/L3 之外的
 * 第四类来源）。
 *
 * V1 跨 run 可见 / V2 范围窗口=最近3轮 / V3 与 L1 去重 / V5 个人线程适用（不破 F156 边界）/
 * V6 可审计（F157 快照追加字段）/ V7 失败降级不阻断 run —— 逐条对应
 * `design-deltas/tool-trace-cross-run-context/verification.md`。
 *
 * V4（预算裁剪顺序）在 verification.md 里描述的是"跨 L1/L2/L3/工具轨迹的共享预算仲裁"，
 * 但这份代码库里 L2 摘要与 L3 检索目前都是无条件前置、从不参与任何跨层裁剪（各自只有
 * 自己独立的字符预算，见 `tool-trace-context.ts` 头注）——工具轨迹遵循同一个既有现实，
 * 不新增一个这份代码库里其它层都没有的跨层仲裁器。本文件改测"自身预算超限时整条丢弃、
 * 不截半句"（与 `buildToolTraceMessage` 实际实现一致），不测一个不存在的机制。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatThread, addChatMessage } from "../support/chat-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgAgentRunRepository } from "../../src/infrastructure/agent-run/pg-agent-run-repository";
import { PgFileRetrieval } from "../../src/infrastructure/agent-run/pg-file-retrieval";
import { PgAgentRunContextSnapshot } from "../../src/infrastructure/agent-run/pg-agent-run-context-snapshot";
import { PgToolTraceContext } from "../../src/infrastructure/agent-run/pg-tool-trace-context";
import { executeQueuedRuns, type ExecuteAgentRunDeps } from "../../src/application/agent-run/execute-run";
import { TOOL_TRACE_MESSAGE_HEADER_PREFIX } from "../../src/application/agent-run/tool-trace-context";
import type { ModelCallInput } from "../../src/application/agent-run/ports";
import type { ToolTraceContextPort } from "../../src/application/agent-run/tool-trace-context";
import { toOrgId } from "../../src/domain/org-id";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f190-trace";
const PROJECT = "proj-f190-trace";
const THREAD = "thr-f190-trace";
const THREAD_PERSONAL = "thr-f190-trace-personal";
const ACTOR = "u-f190-trace";
const AGENT_ID = "agent-f190-trace";
const MODEL_PROVIDER = "test-provider";
const MODEL_ID = "test-model";

let db: PgDatabase;
let repo: PgAgentRunRepository;
let files: PgFileRetrieval;
let snapshots: PgAgentRunContextSnapshot;
let toolTrace: PgToolTraceContext;
let agentVersionId: string;

async function seedAgent(): Promise<void> {
  const instructions = "You are a helpful assistant for F190 tool-trace testing.";
  await asApp(ORG, async (c) => {
    await c.query(
      `INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'enabled',$5,now(),now())`,
      [AGENT_ID, ORG, AGENT_ID, "F190 测试 agent", ACTOR],
    );
    agentVersionId = `${AGENT_ID}-v1`;
    await c.query(
      `INSERT INTO agent_versions
         (id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,
          model_provider,model_id,tool_policy,creator_id,created_at,published_at)
       VALUES ($1,$2,$3,'v1',$4,$5,'{}'::text[],$6,$7,'[]'::jsonb,$8,now(),now())`,
      [agentVersionId, ORG, AGENT_ID, createHash("sha256").update(instructions).digest("hex"),
        instructions, MODEL_PROVIDER, MODEL_ID, ACTOR],
    );
  });
}

/**
 * 直接落库一轮"已完成、写回了消息、且记了一个 tool_call step"的历史 run——绕开真实
 * `executeQueuedRuns` 链路（那条链路本身就是本文件要测的东西，用它来造前置历史会循环
 * 依赖），同 F157 测试夹具"直接 INSERT 造历史"的既有做法。
 *
 * `agent_runs` 的 BEFORE UPDATE 状态机触发器不拦这里的 INSERT（它只挡 UPDATE，见该表
 * 迁移头注），所以可以直接插一行 `status='succeeded'`。
 */
async function seedHistoricalToolCallRun(opts: {
  threadId: string;
  runId: string;
  questionId: string;
  replyId: string;
  toolName: string;
  toolArgsSummary?: string;
  toolResultSummary?: string;
  createdAt: string; // ISO——决定"最近 N 轮"的排序
}): Promise<void> {
  await addChatMessage({
    orgId: ORG, id: opts.questionId, threadId: opts.threadId, body: `问题：${opts.toolName}`,
    authorId: ACTOR,
  });
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO agent_runs
         (id, org_id, thread_id, input_message_id, agent_id, agent_version_id,
          skill_version_ids, model_provider, model_id, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,'[]'::jsonb,$7,$8,'succeeded',$9)`,
      [opts.runId, ORG, opts.threadId, opts.questionId, AGENT_ID, agentVersionId,
        MODEL_PROVIDER, MODEL_ID, opts.createdAt],
    ),
  );
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO agent_run_steps
         (id, org_id, run_id, seq, kind, status, started_at, ended_at,
          tool_name, tool_args_summary, tool_result_summary, planning_note)
       VALUES ($1,$2,$3,3,'tool_call','succeeded',$4,$4,$5,$6,$7,NULL)`,
      [`${opts.runId}-step1`, ORG, opts.runId, opts.createdAt,
        opts.toolName, opts.toolArgsSummary ?? null, opts.toolResultSummary ?? null],
    ),
  );
  await addChatMessage({
    orgId: ORG, id: opts.replyId, threadId: opts.threadId, body: "（历史工具调用的回复）",
    authorId: AGENT_ID, authorKind: "agent", agentId: AGENT_ID,
  });
  await asApp(ORG, (c) =>
    c.query(`UPDATE chat_messages SET agent_run_id=$1 WHERE org_id=$2 AND id=$3`,
      [opts.runId, ORG, opts.replyId]),
  );
}

/** 撑满字符预算，逼 `trimHistoryToBudget` 把早期轮次赶出 L1（同 F157 既有测试的算法）。 */
function pad(text: string): string {
  return `${text}——${"占位内容用于撑满单条消息的字符预算".repeat(46)}`;
}

/**
 * 造 `count` 条撑满预算的填充轮次，把此前造的历史消息挤出 L1 近端窗口——没有这一步，
 * "上一轮工具调用"的回复消息本身就还在 L1 原文里，回喂机制的去重规则（§1②）会正确地
 * 跳过它，测出来的就不是"工具轨迹回喂"本身，而是"L1 原文顺带带到了"，两者是不同的事实。
 */
async function seedFillerTurns(threadId: string, count: number, startAt: number): Promise<void> {
  for (let i = startAt; i < startAt + count; i += 1) {
    await addChatMessage({
      orgId: ORG, id: `f190-filler-${threadId}-${i}`, threadId, body: pad(`填充第${i}轮`),
      authorId: i % 2 === 0 ? AGENT_ID : ACTOR,
      authorKind: i % 2 === 0 ? "agent" : "human",
      agentId: i % 2 === 0 ? AGENT_ID : null,
    });
  }
}

async function enqueueRun(inputMessageId: string, runId: string, threadId: string): Promise<void> {
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO agent_runs
         (id, org_id, thread_id, input_message_id, agent_id, agent_version_id,
          skill_version_ids, model_provider, model_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,'[]'::jsonb,$7,$8,'queued')`,
      [runId, ORG, threadId, inputMessageId, AGENT_ID, agentVersionId, MODEL_PROVIDER, MODEL_ID],
    ),
  );
}

function fakeModel(calls: ModelCallInput[]): ExecuteAgentRunDeps["model"] {
  return {
    async complete(input: ModelCallInput) {
      calls.push(input);
      if (input.system.includes("摘要器")) return { text: `[摘要回显] ${input.user}` };
      return { text: "好的，收到。" };
    },
  };
}

let clock = 0;
function deps(calls: ModelCallInput[], override?: Partial<ExecuteAgentRunDeps>): ExecuteAgentRunDeps {
  return {
    runs: repo,
    model: fakeModel(calls),
    files,
    contextSnapshots: snapshots,
    toolTrace,
    clock: { now: () => new Date(Date.now() + clock++).toISOString(), newStepId: () => `step-${clock}` },
    log: () => {},
    ...override,
  };
}

async function askAndRun(
  threadId: string, question: string, runId: string, override?: Partial<ExecuteAgentRunDeps>,
): Promise<ModelCallInput[]> {
  const qid = `f190-q-${runId}`;
  await addChatMessage({ orgId: ORG, id: qid, threadId, body: question, authorId: ACTOR });
  await enqueueRun(qid, runId, threadId);
  const calls: ModelCallInput[] = [];
  await executeQueuedRuns(deps(calls, override), { orgId: toOrgId(ORG) });
  return calls;
}

async function runStatus(runId: string): Promise<string> {
  const row = await asApp(ORG, (c) => c.query<{ status: string }>(
    `SELECT status FROM agent_runs WHERE org_id=$1 AND id=$2`, [ORG, runId],
  ));
  return row.rows[0]!.status;
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgAgentRunRepository(db);
  files = new PgFileRetrieval(db);
  snapshots = new PgAgentRunContextSnapshot(db);
  toolTrace = new PgToolTraceContext(db);
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ACTOR, "consultant", null);
  await addProjectMember(ORG, PROJECT, ACTOR, "member", null);
  await addChatThread({
    orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: ACTOR,
  });
  await addChatThread({
    orgId: ORG, id: THREAD_PERSONAL, projectId: null, visibilityScope: "private", createdBy: ACTOR,
  });
  await seedAgent();
});

afterAll(async () => {
  await db.close();
});

describe("F190 工具调用轨迹跨 run 回喂上下文（真库 + 真 executeQueuedRuns）", () => {
  it("V1：上一轮的工具调用对下一轮可见，不逐字复述也能看到", async () => {
    const t0 = new Date(Date.now() - 60_000).toISOString();
    await seedHistoricalToolCallRun({
      threadId: THREAD, runId: "f190-run-v1", questionId: "f190-v1-q", replyId: "f190-v1-r",
      toolName: "search_contract", toolArgsSummary: "关键词=违约金",
      toolResultSummary: "命中合同第 7 条，代号 ORCA5521", createdAt: t0,
    });
    await seedFillerTurns(THREAD, 30, 1); // 把上面那轮的回复挤出 L1，逼真正走回喂路径。

    const calls = await askAndRun(THREAD, "你刚才查到的那个代号是什么？", "f190-run-v1-next");
    expect(calls.length).toBeGreaterThan(0);
    const historyText = (calls.find((c) => c.history !== undefined)?.history ?? []).map((m) => m.content).join("\n");
    expect(historyText).toContain(TOOL_TRACE_MESSAGE_HEADER_PREFIX);
    expect(historyText).toContain("search_contract");
    expect(historyText).toContain("ORCA5521");
  });

  it("V2：范围窗口=最近3轮——第4旧的 run 不出现在候选里", async () => {
    const base = Date.now() - 600_000;
    for (let i = 0; i < 4; i += 1) {
      await seedHistoricalToolCallRun({
        threadId: THREAD, runId: `f190-run-v2-${i}`, questionId: `f190-v2-q${i}`,
        replyId: `f190-v2-r${i}`, toolName: `tool_${i}`, toolResultSummary: `RESULT_CODE_${i}`,
        createdAt: new Date(base + i * 1000).toISOString(),
      });
    }
    await seedFillerTurns(THREAD, 30, 1); // 把全部 4 轮的回复都挤出 L1。
    const calls = await askAndRun(THREAD, "总结一下前面查过的东西", "f190-run-v2-next");
    const historyText = (calls.find((c) => c.history !== undefined)?.history ?? []).map((m) => m.content).join("\n");
    // 最近 3 轮（i=1,2,3）应该在；最旧的第 0 轮不该在。
    expect(historyText).toContain("RESULT_CODE_1");
    expect(historyText).toContain("RESULT_CODE_2");
    expect(historyText).toContain("RESULT_CODE_3");
    expect(historyText).not.toContain("RESULT_CODE_0");
  });

  it("V3：与 L1 重叠的轮次去重跳过，不落在 L1 窗口外的轮次正常回喂（正反对照）", async () => {
    // 造一轮"很早"的工具调用（会被挤出 L1，走回喂路径——正样本，应该出现）。
    const tOld = new Date(Date.now() - 600_000).toISOString();
    await seedHistoricalToolCallRun({
      threadId: THREAD, runId: "f190-run-v3-old", questionId: "f190-v3-old-q",
      replyId: "f190-v3-old-r", toolName: "lookup_old", toolResultSummary: "SALMON1120",
      createdAt: tOld,
    });
    await seedFillerTurns(THREAD, 30, 1); // 把上面那轮挤出 L1。

    // 紧接着再造一轮"刚刚"的工具调用——它的回复消息落在 L1 近端窗口内（负样本，去重跳过）。
    const tRecent = new Date(Date.now() - 1000).toISOString();
    await seedHistoricalToolCallRun({
      threadId: THREAD, runId: "f190-run-v3-recent", questionId: "f190-v3-recent-q",
      replyId: "f190-v3-recent-r", toolName: "lookup_price", toolResultSummary: "TROUT9012",
      createdAt: tRecent,
    });

    const calls = await askAndRun(THREAD, "刚才查的价格是多少？", "f190-run-v3-next");
    const historyText = (calls.find((c) => c.history !== undefined)?.history ?? []).map((m) => m.content).join("\n");
    expect(historyText).toContain(TOOL_TRACE_MESSAGE_HEADER_PREFIX);
    // 正样本：已滚出 L1 的那轮走回喂路径，工具轨迹段落里能看到。
    expect(historyText).toContain("SALMON1120");
    // 负样本：仍在 L1 窗口内的那轮被去重跳过——它的工具结果代号不该出现在工具轨迹段落里
    // （L1 原文里也没有这个代号字面出现，因为它只在 tool_result_summary 里，不在回复正文，
    // 所以"完全不出现"就是"确实被跳过"，不是"碰巧被 L1 带到了"）。
    const toolTraceBlock = historyText.slice(historyText.indexOf(TOOL_TRACE_MESSAGE_HEADER_PREFIX));
    expect(toolTraceBlock).not.toContain("TROUT9012");
    expect(historyText).not.toContain("TROUT9012");
  });

  it("V5：个人线程一视同仁适用，且不破坏 F156 的零跨范围召回边界", async () => {
    const t0 = new Date(Date.now() - 60_000).toISOString();
    await seedHistoricalToolCallRun({
      threadId: THREAD_PERSONAL, runId: "f190-run-v5", questionId: "f190-v5-q",
      replyId: "f190-v5-r", toolName: "personal_lookup", toolResultSummary: "HERON3345",
      createdAt: t0,
    });
    await seedFillerTurns(THREAD_PERSONAL, 30, 1);

    const calls = await askAndRun(THREAD_PERSONAL, "刚才查到什么？", "f190-run-v5-next");
    const historyText = (calls.find((c) => c.history !== undefined)?.history ?? []).map((m) => m.content).join("\n");
    expect(historyText).toContain("HERON3345"); // 本线程自己的工具轨迹——适用。

    const snap = await snapshots.findByRunId(toOrgId(ORG), "f190-run-v5-next");
    // F156 边界不受影响：本线程范围内的工具轨迹回喂不是"跨范围检索"。
    expect(snap!.l3RetrievalScope === null || snap!.l3RetrievalScope === "own-attachment").toBe(true);
  });

  it("V6：可审计——F157 快照记录实际回喂的工具轨迹轮数与 step 数", async () => {
    const t0 = new Date(Date.now() - 60_000).toISOString();
    await seedHistoricalToolCallRun({
      threadId: THREAD, runId: "f190-run-v6", questionId: "f190-v6-q", replyId: "f190-v6-r",
      toolName: "audit_lookup", toolResultSummary: "SNAP7789", createdAt: t0,
    });
    await seedFillerTurns(THREAD, 30, 1);

    await askAndRun(THREAD, "可审计性验证", "f190-run-v6-next");
    const snap = await snapshots.findByRunId(toOrgId(ORG), "f190-run-v6-next");
    expect(snap).not.toBeNull();
    expect(snap!.toolTraceStatus).toBe("ok");
    expect(snap!.toolTraceRunCount).toBeGreaterThan(0);
    expect(snap!.toolTraceStepCount).toBeGreaterThan(0);
  });

  it("V6b：deps.toolTrace 未配置——快照如实记 not_configured，run/step 数为 0", async () => {
    const calls = await askAndRun(THREAD, "不接工具轨迹端口的这次提问", "f190-run-v6b", { toolTrace: undefined });
    expect(calls.length).toBeGreaterThan(0);
    const snap = await snapshots.findByRunId(toOrgId(ORG), "f190-run-v6b");
    expect(snap!.toolTraceStatus).toBe("not_configured");
    expect(snap!.toolTraceRunCount).toBe(0);
    expect(snap!.toolTraceStepCount).toBe(0);
  });

  it("V7：读取失败降级——run 不失败，快照如实记 degraded，history 不含工具轨迹", async () => {
    const exploding: ToolTraceContextPort = {
      async recent() { throw new Error("simulated agent_run_steps read failure"); },
    };
    const calls = await askAndRun(THREAD, "触发工具轨迹读取失败的提问", "f190-run-v7", { toolTrace: exploding });
    expect(calls.length).toBeGreaterThan(0);
    expect(await runStatus("f190-run-v7")).not.toBe("failed");

    const historyText = (calls.find((c) => c.history !== undefined)?.history ?? []).map((m) => m.content).join("\n");
    expect(historyText).not.toContain(TOOL_TRACE_MESSAGE_HEADER_PREFIX);

    const snap = await snapshots.findByRunId(toOrgId(ORG), "f190-run-v7");
    expect(snap!.toolTraceStatus).toBe("degraded");
    expect(snap!.toolTraceRunCount).toBe(0);
    expect(snap!.toolTraceStepCount).toBe(0);
  });
});
