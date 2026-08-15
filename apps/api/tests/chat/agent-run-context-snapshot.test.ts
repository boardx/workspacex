/**
 * F157（08-chat/uc-8-7 R3②，人类 2026-08-11「yes to all」逐字签核）—— **真实 Postgres + 真实
 * `executeQueuedRuns` 全链路**反证：`agent_run_context_snapshots` 真的落库，字段真的反映
 * 本轮实际组装出的 L1/L2/L3 结构，降级时真的如实记降级，且按 `run_id` 能检索到。
 *
 * 为什么必须走真库 + 真 `executeQueuedRuns`（同 `layered-history-l2-persist.test.ts` /
 * `l3-context-pack-wiring.test.ts` 的既有理由）：快照的核心主张是「记录的是这次真正发生的事」，
 * 一份内存 fake store 测不出 `PgAgentRunContextSnapshot` 的 SQL 是否真的把三层状态如实落成
 * 三个可查询的列，也测不出 `execute-run.ts` 里悲观默认值（`l2Status`/`l3Status` 起始即
 * `"degraded"`，只在正常收尾路径才翻 `"ok"`）有没有漏掉某条 catch 分支。
 *
 * `ModelCallPort` 用确定性 fake（不接真模型），与既有 L2/L3 测试一致。
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
import { PgChatRepository } from "../../src/infrastructure/chat/pg-chat-repository";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { executeQueuedRuns, type ExecuteAgentRunDeps } from "../../src/application/agent-run/execute-run";
import {
  readAgentRunContextSnapshot, AgentRunContextSnapshotNotVisibleError,
} from "../../src/application/agent-run/read-run-context-snapshot";
import type { FileRetrievalPort } from "../../src/application/agent-run/file-retrieval";
import type { ModelCallInput } from "../../src/application/agent-run/ports";
import { toOrgId } from "../../src/domain/org-id";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f157-snap";
const ORG_OTHER = "org-f157-snap-other";
const PROJECT = "proj-f157-snap";
const THREAD = "thr-f157-snap";
const ACTOR = "u-f157-snap";
const OUTSIDER = "u-f157-snap-outsider";
const AGENT_ID = "agent-f157-snap";
const MODEL_PROVIDER = "test-provider";
const MODEL_ID = "test-model";
const CODE_ATTACHMENT = "GANNET8834"; // ASCII 代号——Postgres 默认解析器不切分中文（同 F155 先例）。

let db: PgDatabase;
let repo: PgAgentRunRepository;
let files: PgFileRetrieval;
let snapshots: PgAgentRunContextSnapshot;
let agentVersionId: string;

/** 撑满字符预算，逼 `trimHistoryToBudget` 把早期轮次赶出 L1（同 L2/L3 既有测试的算法）。 */
function pad(text: string): string {
  return `${text}——${"占位内容用于撑满单条消息的字符预算".repeat(46)}`;
}

async function seedAgent(): Promise<void> {
  const instructions = "You are a helpful assistant for F157 context snapshot testing.";
  await asApp(ORG, async (c) => {
    await c.query(
      `INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'enabled',$5,now(),now())`,
      [AGENT_ID, ORG, AGENT_ID, "F157 测试 agent", ACTOR],
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

/** 造 `count` 条历史消息（`m001`..），返回最后一条 id。第 3 条里埋 `earlyBody`（若给）。 */
async function seedTurns(count: number, startAt: number, earlyBody?: string): Promise<string> {
  let last = "";
  for (let i = startAt; i < startAt + count; i += 1) {
    const id = `f157s-m${String(i).padStart(3, "0")}`;
    const body = i === startAt + 2 && earlyBody !== undefined
      ? pad(earlyBody)
      : pad(`第${i}轮内容`);
    await addChatMessage({
      orgId: ORG, id, threadId: THREAD, body, authorId: ACTOR,
      authorKind: i % 2 === 0 ? "agent" : "human",
      agentId: i % 2 === 0 ? AGENT_ID : null,
    });
    last = id;
  }
  return last;
}

async function addExtractedAttachment(opts: {
  id: string; messageId: string; filename: string; excerpt: string;
}): Promise<void> {
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO chat_message_attachments
         (id, org_id, thread_id, message_id, storage_ref, filename, mime, bytes,
          extraction_status, extracted_excerpt)
       VALUES ($1,$2,$3,$4,$5,$6,'text/markdown',1024,'extracted',$7)`,
      [opts.id, ORG, THREAD, opts.messageId, `s3://${opts.id}`, opts.filename, opts.excerpt],
    ),
  );
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

async function askAndRun(
  question: string, runId: string, override?: Partial<ExecuteAgentRunDeps>,
): Promise<ModelCallInput[]> {
  const qid = `f157s-q-${runId}`;
  await addChatMessage({ orgId: ORG, id: qid, threadId: THREAD, body: question, authorId: ACTOR });
  await enqueueRun(qid, runId);
  const calls: ModelCallInput[] = [];
  await executeQueuedRuns({ ...deps(calls), ...override }, { orgId: toOrgId(ORG) });
  return calls;
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
function deps(calls: ModelCallInput[]): ExecuteAgentRunDeps {
  return {
    runs: repo,
    model: fakeModel(calls),
    files,
    contextSnapshots: snapshots,
    clock: { now: () => new Date(Date.now() + clock++).toISOString(), newStepId: () => `step-${clock}` },
    log: () => {},
  };
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
});

beforeEach(async () => {
  await resetOrgs(ORG, ORG_OTHER);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ACTOR, "consultant", null);
  await addProjectMember(ORG, PROJECT, ACTOR, "member", null);
  await addChatThread({
    orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: ACTOR,
  });
  await seedAgent();
  await seedOrg({ orgId: ORG_OTHER, projectId: `${PROJECT}-other` });
});

afterAll(async () => {
  await db.close();
});

describe("F157 可审计上下文快照 agent_run_context_snapshots（真库 + 真 executeQueuedRuns）", () => {
  it("三层齐全：L1 保留轮数、L2 覆盖边界、L3 命中条数与来源、token 估值都落库且可按 run_id 检索", async () => {
    const lastId = await seedTurns(30, 1, "这一轮我传了一份合同");
    await addExtractedAttachment({
      id: "att-f157-happy", messageId: "f157s-m003", filename: "contract-2026.md",
      excerpt: `合同正文：内部代号 ${CODE_ATTACHMENT}，违约金条款见第 7 条。`,
    });

    await askAndRun(`${CODE_ATTACHMENT} 这个代号的违约金条款是什么？`, "f157s-run-happy");

    const snap = await snapshots.findByRunId(toOrgId(ORG), "f157s-run-happy");
    expect(snap).not.toBeNull();
    // L1：30 条撑满字符预算被裁到近端窗口，真实保留条数必须 > 0 且明显小于候选总数。
    expect(snap!.l1MessageCount).toBeGreaterThan(0);
    expect(snap!.l1MessageCount).toBeLessThan(30);
    // L2：字符预算下必有旧轮被裁出，触发摘要，正常收尾 ⇒ ok，且覆盖边界非空。
    expect(snap!.l2Status).toBe("ok");
    expect(snap!.l2CoveredThroughId).not.toBeNull();
    // L3：真实召回命中了那份带代号的附件，来源标记为 chat-attachment。
    expect(snap!.l3Status).toBe("ok");
    expect(snap!.l3HitCount).toBe(1);
    expect(snap!.l3Sources).toEqual(["chat-attachment"]);
    // token 估值：正数、且是一个"估值"而不是 0——喂进去的内容显然超过几个字符。
    expect(snap!.estimatedTokens).toBeGreaterThan(0);
    expect(Number.isInteger(snap!.estimatedTokens)).toBe(true);

    // 按 run_id 检索——独立的应用层用例（复用与 run 本身相同的可见性判定）也能读到同一条。
    const viaUseCase = await readAgentRunContextSnapshot(
      { runs: repo, snapshots, chat: new PgChatRepository(db), repo: new PgIdentityRepository(db), ids: { next: () => "dec-1" } },
      { userId: ACTOR, orgId: toOrgId(ORG), runId: "f157s-run-happy" },
    );
    expect(viaUseCase).toEqual(snap);
  });

  it("L2 降级：摘要模型调用失败 —— run 不失败，快照如实记 l2Status=degraded，覆盖边界为 null", async () => {
    const lastId = await seedTurns(30, 1);
    await addChatMessage({ orgId: ORG, id: "f157s-q-l2fail", threadId: THREAD, body: "继续", authorId: ACTOR });
    await enqueueRun("f157s-q-l2fail", "f157s-run-l2fail");

    const failingModel: ExecuteAgentRunDeps["model"] = {
      async complete(input: ModelCallInput) {
        if (input.system.includes("摘要器")) throw new Error("模拟摘要模型调用失败");
        return { text: "即使摘要失败，回答仍然正常产出。" };
      },
    };
    const claimedCount = await executeQueuedRuns(
      { runs: repo, model: failingModel, files, contextSnapshots: snapshots,
        clock: { now: () => new Date(Date.now() + clock++).toISOString(), newStepId: () => `step-${clock}` },
        log: () => {} },
      { orgId: toOrgId(ORG) },
    );
    expect(claimedCount).toBe(1);
    // run 没有失败——降级不 fail run（同 F154 V6 既有纪律）。
    expect(await runStatus("f157s-run-l2fail")).toBe("writeback_pending");

    const snap = await snapshots.findByRunId(toOrgId(ORG), "f157s-run-l2fail");
    expect(snap).not.toBeNull();
    // L1 仍然正常（L1 与 L2 独立失败）。
    expect(snap!.l1MessageCount).toBeGreaterThan(0);
    // L2 如实记降级，且不敢声称一个不可信的边界。
    expect(snap!.l2Status).toBe("degraded");
    expect(snap!.l2CoveredThroughId).toBeNull();
  });

  it("L3 未配置：deps.files 缺省 —— 快照如实记 l3Status=not_configured，命中数与来源为空", async () => {
    await seedTurns(10, 1);
    const calls = await askAndRun("没有配置 L3 的这次提问", "f157s-run-l3none", { files: undefined });
    expect(calls.length).toBeGreaterThan(0);

    const snap = await snapshots.findByRunId(toOrgId(ORG), "f157s-run-l3none");
    expect(snap).not.toBeNull();
    expect(snap!.l3Status).toBe("not_configured");
    expect(snap!.l3HitCount).toBe(0);
    expect(snap!.l3Sources).toEqual([]);
  });

  it("L3 失败：检索查询抛错 —— run 不失败，快照如实记 l3Status=degraded，命中数为 0", async () => {
    await seedTurns(10, 1);
    const exploding: FileRetrievalPort = {
      async search() { throw new Error("relation \"chat_message_attachments\" does not exist"); },
    };
    await askAndRun("触发 L3 失败的提问", "f157s-run-l3fail", { files: exploding });

    expect(await runStatus("f157s-run-l3fail")).not.toBe("failed");
    const snap = await snapshots.findByRunId(toOrgId(ORG), "f157s-run-l3fail");
    expect(snap).not.toBeNull();
    expect(snap!.l3Status).toBe("degraded");
    expect(snap!.l3HitCount).toBe(0);
    expect(snap!.l3Sources).toEqual([]);
  });

  it("L3 零命中：查询成功但没有相关文件 —— l3Status=ok，命中数为 0（与失败区分开）", async () => {
    await seedTurns(10, 1);
    await askAndRun("问一个查不到任何文件的关键词 ZQXJVKPT0001", "f157s-run-l3empty");

    const snap = await snapshots.findByRunId(toOrgId(ORG), "f157s-run-l3empty");
    expect(snap).not.toBeNull();
    expect(snap!.l3Status).toBe("ok"); // 查了、没结果 —— 不是「查了没查成」。
    expect(snap!.l3HitCount).toBe(0);
    expect(snap!.l3Sources).toEqual([]);
  });

  it("按 run_id 检索：未写快照的 run（未接 contextSnapshots）返回 null，不是抛错", async () => {
    await seedTurns(5, 1);
    await askAndRun("不接快照端口的这次提问", "f157s-run-nosnap", { contextSnapshots: undefined });

    const snap = await snapshots.findByRunId(toOrgId(ORG), "f157s-run-nosnap");
    expect(snap).toBeNull();
  });

  it("RLS：另一个 org 读不到（跨租户隔离，不是应用层过滤）", async () => {
    await seedTurns(5, 1);
    await askAndRun("跨租户隔离验证", "f157s-run-rls");
    const own = await snapshots.findByRunId(toOrgId(ORG), "f157s-run-rls");
    expect(own).not.toBeNull();

    const cross = await snapshots.findByRunId(toOrgId(ORG_OTHER), "f157s-run-rls");
    expect(cross).toBeNull();
  });

  it("应用层用例：非该组织成员的用户按 run_id 检索被拒绝（不泄露存在性）", async () => {
    await seedTurns(5, 1);
    await askAndRun("权限校验用例", "f157s-run-authz");

    await expect(readAgentRunContextSnapshot(
      { runs: repo, snapshots, chat: new PgChatRepository(db), repo: new PgIdentityRepository(db), ids: { next: () => "dec-2" } },
      { userId: OUTSIDER, orgId: toOrgId(ORG), runId: "f157s-run-authz" },
    )).rejects.toThrow(AgentRunContextSnapshotNotVisibleError);
  });
});
