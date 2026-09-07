/**
 * F154 L2（08-chat/uc-8-7 R12 V1/V2/V6）—— **真实 Postgres + 真实 executeQueuedRuns 全链路**反证：
 * `thread_context_state` 真的落库、真的被下一轮直读、且「打破 HISTORY_MAX_MESSAGES=20 硬上限」
 * 是真实可观测的行为，不只是单元测试里的纯函数正确。
 *
 * 为什么必须走真库+真 executeQueuedRuns（而不是像 `execute-run-progress.test.ts` 那样用内存 fake
 * store）：L2 的核心主张是「持久化」——fake store 的 `readThreadContextState`/`upsertThreadContextState`
 * 都是内存桩，测不出真实 SQL 有没有对、乐观并发 WHERE 子句撞不撞、`readThreadHistory` 新加的
 * `id` 字段有没有真的从 `chat_messages.id` 传回来。这条测的是「组装层 + 真实仓储」接线正确，
 * `PgAgentRunRepository.readThreadContextState`/`upsertThreadContextState` 本体的 SQL 细节已在
 * `thread-context-state-repo.test.ts`（F154-a，#1111）反证过，这里不重复。
 *
 * ModelCallPort 用确定性 fake（不接真模型）：摘要调用（system 含"摘要器"标记）原样回显收到的
 * `user` 内容，这样断言"这次摘要输入里有没有某段文本"就是直接字符串包含判断，不依赖真实 LLM
 * 的不确定输出——同时也让"第二轮摘要调用只喂了新增区间"这条断言可以精确核验。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatThread, addChatMessage } from "../support/chat-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgAgentRunRepository } from "../../src/infrastructure/agent-run/pg-agent-run-repository";
import { writeBackPendingRuns } from "../../src/application/agent-run/writeback";
import { executeQueuedRuns, type ExecuteAgentRunDeps } from "../../src/application/agent-run/execute-run";
import type { ModelCallInput } from "../../src/application/agent-run/ports";
import { toOrgId } from "../../src/domain/org-id";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f154-l2persist";
const PROJECT = "proj-f154-l2persist";
const THREAD = "thr-f154-l2persist";
const ACTOR = "u-f154-l2persist";
const AGENT_ID = "agent-f154-l2persist";
const MODEL_PROVIDER = "test-provider";
const MODEL_ID = "test-model";
const FACT = "代号是「深蓝鲸-77」"; // 埋在第 5 轮的可检出事实（V1）

let db: PgDatabase;
let repo: PgAgentRunRepository;
let agentVersionId: string;

/** 每条消息填充到约 800 字符，逼出字符预算裁剪（HISTORY_MAX_CHARS=12000）——30 条 × 800 ≈ 24000，
 * 明显超预算，`trimHistoryToBudget` 只会保留最新约 15 条，前面（含第 5 轮）必被裁掉、进入 L2
 * 候选。字符数量算过（"占位内容用于撑满单条消息的字符预算" 17 字 × 46 ≈ 782 + 文本本身）——
 * 不是拍脑袋的数字，是从 `HISTORY_MAX_CHARS` 反推出「必须裁掉第 5 轮」这个测试意图算出来的。 */
function pad(text: string): string {
  return `${text}——${"占位内容用于撑满单条消息的字符预算".repeat(46)}`;
}

async function seedAgent(): Promise<void> {
  const instructions = "You are a helpful assistant for F154 L2 persistence testing.";
  await asApp(ORG, async (c) => {
    await c.query(
      `INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'enabled',$5,now(),now())`,
      [AGENT_ID, ORG, AGENT_ID, "F154 L2 测试 agent", ACTOR],
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

/** 造 `count` 条历史消息（`m01`..`mNN`，零填充保证 (created_at,id) 排序即使时间戳打平也不乱序），
 * 第 5 条额外埋入 `FACT`。返回最后一条消息 id（下一次 enqueue 的 input_message_id 候选）。 */
async function seedTurns(count: number, startAt: number): Promise<string> {
  let last = "";
  for (let i = startAt; i < startAt + count; i += 1) {
    const id = `m${String(i).padStart(3, "0")}`;
    const isFactTurn = i === 5;
    const body = pad(isFactTurn ? `第${i}轮：项目内部${FACT}，后续都用这个代号。` : `第${i}轮内容`);
    await addChatMessage({
      orgId: ORG, id, threadId: THREAD, body, authorId: ACTOR,
      authorKind: i % 2 === 0 ? "agent" : "human",
      agentId: i % 2 === 0 ? AGENT_ID : null,
    });
    last = id;
  }
  return last;
}

async function enqueueRun(inputMessageId: string, runId: string): Promise<void> {
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO agent_runs
         (id, org_id, thread_id, input_message_id, agent_id, agent_version_id,
          skill_version_ids, model_provider, model_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,'[]'::jsonb,$7,$8,'queued')`,
      [runId, ORG, THREAD, inputMessageId, AGENT_ID, agentVersionId, MODEL_PROVIDER, MODEL_ID],
    ),
  );
}

async function readContextState(): Promise<{ summary: string; summarizedThroughId: string | null; version: number } | null> {
  return repo.readThreadContextState(toOrgId(ORG), THREAD);
}

/** 确定性 fake：摘要调用（system 含"摘要器"）原样回显收到的 user 文本（前缀标记），
 * 便于断言"这次摘要真正看到了什么"；真实回答调用返回固定文案。记录每次调用供断言检查次数。 */
function fakeModel(calls: ModelCallInput[]): ExecuteAgentRunDeps["model"] {
  return {
    async complete(input: ModelCallInput) {
      calls.push(input);
      if (input.system.includes("摘要器")) {
        return { text: `[摘要回显] ${input.user}` };
      }
      return { text: "好的，收到。" };
    },
  };
}

let clock = 0;
function deps(calls: ModelCallInput[]): ExecuteAgentRunDeps {
  return {
    runs: repo,
    model: fakeModel(calls),
    clock: { now: () => new Date(Date.now() + clock++).toISOString(), newStepId: () => `step-${clock}` },
    log: () => {},
  };
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgAgentRunRepository(db);
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ACTOR, "consultant", null);
  await addChatThread({
    orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: ACTOR,
  });
  await seedAgent();
});

afterAll(async () => {
  await db.close();
});

describe("F154 L2 —— thread_context_state 真实持久 + run 时直读（真库 + 真 executeQueuedRuns）", () => {
  it("V1：30+ 轮线程，第 5 轮的事实超出 L1 窗口后仍经 L2 摘要伪消息可检出；thread_context_state 真的落库", async () => {
    const lastId = await seedTurns(30, 1);
    await enqueueRun(lastId, "run-v1");

    const calls: ModelCallInput[] = [];
    const claimedCount = await executeQueuedRuns(deps(calls), { orgId: toOrgId(ORG) });
    expect(claimedCount).toBe(1);

    // 摘要调用确实发生了，且它看到的新增区间里包含第 5 轮的事实——这就是"超出 L1 仍可检出"。
    const summarizeCalls = calls.filter((c) => c.system.includes("摘要器"));
    expect(summarizeCalls.length).toBe(1);
    expect(summarizeCalls[0]!.user).toContain(FACT);

    // 真库：thread_context_state 落了一行，summary 里带着（回显的）事实，游标非空。
    const state = await readContextState();
    expect(state).not.toBeNull();
    expect(state!.summary).toContain(FACT);
    expect(state!.summarizedThroughId).not.toBeNull();
    expect(state!.version).toBe(1);

    // 真实回答调用也发生了一次（run 本身要产出答案），且它的 history 里能看到摘要伪消息。
    const answerCalls = calls.filter((c) => !c.system.includes("摘要器"));
    expect(answerCalls.length).toBe(1);
    const historyTexts = (answerCalls[0]!.history ?? []).map((m) => m.content).join("\n");
    expect(historyTexts).toContain(FACT);
  });

  it("V2：第二轮 run 只有极少新增消息时，摘要调用的输入只含新增区间，不重读已被摘要覆盖的旧轮", async () => {
    const lastId = await seedTurns(30, 1);
    await enqueueRun(lastId, "run-v2-first");
    const firstCalls: ModelCallInput[] = [];
    const firstDeps = deps(firstCalls);
    await executeQueuedRuns(firstDeps, { orgId: toOrgId(ORG) });
    // A second run shares this thread only after the first reaches a terminal state.
    expect(await writeBackPendingRuns(firstDeps, { orgId: toOrgId(ORG) })).toBe(1);

    const stateAfterFirst = await readContextState();
    expect(stateAfterFirst).not.toBeNull();
    const cursorAfterFirst = stateAfterFirst!.summarizedThroughId;

    // 再加 2 条新消息，触发第二轮 run。
    const newLastId = await seedTurns(2, 31);
    await enqueueRun(newLastId, "run-v2-second");
    const secondCalls: ModelCallInput[] = [];
    await executeQueuedRuns(deps(secondCalls), { orgId: toOrgId(ORG) });

    const summarizeCallsSecond = secondCalls.filter((c) => c.system.includes("摘要器"));
    // 第二轮：L1 字符预算下，新增的 2 条 + 原本 L1 尾部的一部分仍然吃得下字符预算——
    // 是否真的产生新的摘要调用，取决于「L1 边界之前是否又出现了新的、尚未覆盖的轮次」。
    // 无论是否触发新摘要，核心断言是：**「新增对话」这一段**（即真正喂给这次摘要调用的
    // `toSummarize` 增量、而非携带上一轮摘要文本的「已有摘要」前缀——已有摘要里携带旧信息是
    // 摘要「向前滚动」的正确形状，不是重读原文）不应包含已经被上一轮游标覆盖的第 1-6 轮原文。
    for (const call of summarizeCallsSecond) {
      const incrementSegment = call.user.split("新增对话：\n").at(-1) ?? call.user;
      expect(incrementSegment).not.toContain("第1轮内容"); // 第 1 轮已被上一轮覆盖，不应再次出现在增量里
      expect(incrementSegment).not.toContain(FACT); // 事实所在的第 5 轮同理
    }

    // 游标只会前推，不会倒退或消失。
    const stateAfterSecond = await readContextState();
    expect(stateAfterSecond).not.toBeNull();
    if (summarizeCallsSecond.length > 0) {
      expect(stateAfterSecond!.version).toBeGreaterThan(stateAfterFirst!.version);
      expect(stateAfterSecond!.summarizedThroughId).not.toBe(cursorAfterFirst);
    } else {
      // 没有新增区间——版本、游标原样不动，证明"没有变化就不写回"（零多余模型调用、零多余写）。
      expect(stateAfterSecond).toEqual(stateAfterFirst);
    }

    // 无论哪种情况，第一轮已经沉淀的事实仍能通过持久摘要在这一轮的最终回答历史里看到——
    // 「记忆」跨 run 生效，不因为第二轮没有重新摘要就丢失。
    const answerCallsSecond = secondCalls.filter((c) => !c.system.includes("摘要器"));
    expect(answerCallsSecond.length).toBe(1);
    const historyTextsSecond = (answerCallsSecond[0]!.history ?? []).map((m) => m.content).join("\n");
    expect(historyTextsSecond).toContain(FACT);
  });

  it("V6：摘要模型调用失败 —— run 不失败，降级为仅 L1（真实 run 仍成功产出答案）", async () => {
    const lastId = await seedTurns(30, 1);
    await enqueueRun(lastId, "run-v6");

    const failingModel: ExecuteAgentRunDeps["model"] = {
      async complete(input: ModelCallInput) {
        if (input.system.includes("摘要器")) throw new Error("模拟摘要模型调用失败");
        return { text: "即使摘要失败，回答仍然正常产出。" };
      },
    };
    const failDeps: ExecuteAgentRunDeps = {
      runs: repo, model: failingModel,
      clock: { now: () => new Date().toISOString(), newStepId: () => `step-${clock++}` },
      log: () => {},
    };
    const claimedCount = await executeQueuedRuns(failDeps, { orgId: toOrgId(ORG) });
    expect(claimedCount).toBe(1);

    // run 没有失败——查真库确认状态。happy path 落 `writeback_pending`（不是 `succeeded`：
    // §6 规定只有 chat writeback 事务提交后才转 succeeded，那一步在本文件之外，这里不触发）。
    // 断言的是「不是 failed」这个 V6 真正要证的事，不是具体落在哪个非失败状态。
    const row = await asApp(ORG, (c) => c.query<{ status: string; error_code: string | null }>(
      `SELECT status, error_code FROM agent_runs WHERE org_id=$1 AND id='run-v6'`, [ORG],
    ));
    expect(row.rows[0]!.status).toBe("writeback_pending");
    expect(row.rows[0]!.error_code).toBeNull();

    // 摘要失败 ⇒ 没有持久摘要写回（降级为仅 L1，不 fail run，也不留半成品摘要）。
    const state = await readContextState();
    expect(state).toBeNull();
  });
});
