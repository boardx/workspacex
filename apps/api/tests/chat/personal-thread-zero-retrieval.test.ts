/**
 * F156（design-delta `personal-thread-own-attachment-recall`，contract.md +
 * verification.md，人类 2026-08-12 confirmed）—— **真栈反证** V1-V5：个人线程对
 * org/项目数据仍零召回，但允许召回**本线程自己**的附件；来源可分辨；近端窗口内附件走
 * F153 既有路径无需召回；权限仅创建者本线程。
 *
 * ## 现状（写测试前先读代码判断出的结论，不是猜的）
 *
 * F155（`pg-file-retrieval.ts`）的个人线程分支 —— `project_id IS NULL AND created_by = actor`
 * —— 早就实现了这份 delta 已签的受限召回边界（`l3-retrieval-permission-scope.test.ts` 的
 * V5 已经在**纯检索层**反证过）。本文件不重新实现召回 SQL，只在 **run 级全链路**
 * （`executeQueuedRuns` → `agent_run_context_snapshots`）上把 V1-V5 钉死。
 *
 * F157 落地时的快照只记了「命中内容类型」（`l3Sources`：`chat-attachment`/`canvas-artifact`），
 * 没有字段能回答「这次查询走的是本线程范围还是项目范围」——delta §2 点 2 明确要求这两者可分辨，
 * 否则 V1/V3 的反证会退化成「数一个不再为 0 的总数」。本 PR 补的**唯一**生产代码改动是这一层
 * 薄映射：`context-snapshot.ts` 新增 `l3RetrievalScope`（`own-attachment` | `project-retrieval`
 * | `null`），由 `execute-run.ts` 在发起 L3 查询前，按 `run.projectId` 是否为空直接派生
 * （不是从命中结果反推），随 F157 既有列一起落库（迁移 `20260815110000_f156_l3_retrieval_scope.sql`）。
 *
 * `cross_scope_retrieval_requests` / `own_thread_attachment_recall` 是 verification.md
 * 用来描述断言意图的名字，不是要求生产代码里必须存在字面同名字段——本文件在断言处把它们
 * 表达成 `l3RetrievalScope` 上的等值判断（个人线程运行 ⇒ scope 恒为 `own-attachment`，
 * 从不是 `project-retrieval`；命中数在 scope 为 `own-attachment` 时才计入「自有附件召回」）。
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
import { executeQueuedRuns, type ExecuteAgentRunDeps } from "../../src/application/agent-run/execute-run";
import { writeBackPendingRuns } from "../../src/application/agent-run/writeback";
import type { ModelCallInput } from "../../src/application/agent-run/ports";
import { FILE_CONTEXT_MESSAGE_HEADER_PREFIX } from "../../src/application/agent-run/file-retrieval";
import { toOrgId } from "../../src/domain/org-id";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f156-zero";
const PROJECT = "proj-f156-zero";        // 同组织内「已索引的项目 segment」，V1 用来验证不泄漏
const THREAD_PERSONAL_A = "thr-f156-personal-a"; // actor A 的个人线程
const THREAD_PERSONAL_B = "thr-f156-personal-b"; // actor B 的个人线程（V5 权限对照）
const THREAD_PROJECT = "thr-f156-project";       // 项目内已索引线程，V1 的泄漏来源候选
const ACTOR_A = "u-f156-a";
const ACTOR_B = "u-f156-b";
const AGENT_ID = "agent-f156-zero";
const MODEL_PROVIDER = "test-provider";
const MODEL_ID = "test-model";

// ASCII 代号——Postgres 默认解析器不切分中文（同 F155/F157 既有先例）。
const CODE_PROJECT_SECRET = "OSPREY4471";  // 项目线程里的附件，个人线程绝不该召回它
const CODE_OWN_ATTACHMENT = "TOUCAN9902"; // A 自己个人线程里、被挤出近端窗口的旧附件
const CODE_NEAR_WINDOW = "MACAW1203";     // A 自己个人线程里、刚上传就问的附件（V4）
const CODE_OTHER_PERSONAL = "HERON5566"; // B 的个人线程附件，A 绝不该召回

let db: PgDatabase;
let repo: PgAgentRunRepository;
let files: PgFileRetrieval;
let snapshots: PgAgentRunContextSnapshot;
let agentVersionId: string;

/** 撑满字符预算，逼 `trimHistoryToBudget` 把早期轮次挤出 L1 近端窗口（同 F155/F157 既有算法）。 */
function pad(text: string): string {
  return `${text}——${"占位内容用于撑满单条消息的字符预算".repeat(46)}`;
}

async function seedAgent(): Promise<void> {
  const instructions = "You are a helpful assistant for F156 zero-retrieval testing.";
  await asApp(ORG, async (c) => {
    await c.query(
      `INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'enabled',$5,now(),now())`,
      [AGENT_ID, ORG, AGENT_ID, "F156 测试 agent", ACTOR_A],
    );
    agentVersionId = `${AGENT_ID}-v1`;
    await c.query(
      `INSERT INTO agent_versions
         (id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,
          model_provider,model_id,tool_policy,creator_id,created_at,published_at)
       VALUES ($1,$2,$3,'v1',$4,$5,'{}'::text[],$6,$7,'[]'::jsonb,$8,now(),now())`,
      [agentVersionId, ORG, AGENT_ID, createHash("sha256").update(instructions).digest("hex"),
        instructions, MODEL_PROVIDER, MODEL_ID, ACTOR_A],
    );
  });
}

async function addExtractedAttachment(opts: {
  id: string; threadId: string; messageId: string; filename: string; excerpt: string;
}): Promise<void> {
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO chat_message_attachments
         (id, org_id, thread_id, message_id, storage_ref, filename, mime, bytes,
          extraction_status, extracted_excerpt)
       VALUES ($1,$2,$3,$4,$5,$6,'text/markdown',1024,'extracted',$7)`,
      [opts.id, ORG, opts.threadId, opts.messageId, `s3://${opts.id}`, opts.filename, opts.excerpt],
    ),
  );
}

async function seedTurns(
  threadId: string, actor: string, count: number, startAt: number, earlyBody?: string,
): Promise<string> {
  let last = "";
  for (let i = startAt; i < startAt + count; i += 1) {
    const id = `f156z-m-${threadId}-${String(i).padStart(3, "0")}`;
    const body = i === startAt + 2 && earlyBody !== undefined
      ? pad(earlyBody)
      : pad(`第${i}轮内容`);
    await addChatMessage({
      orgId: ORG, id, threadId, body, authorId: actor,
      authorKind: i % 2 === 0 ? "agent" : "human",
      agentId: i % 2 === 0 ? AGENT_ID : null,
    });
    last = id;
  }
  return last;
}

async function enqueueRun(threadId: string, inputMessageId: string, runId: string): Promise<void> {
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

async function askAndRun(
  threadId: string, actor: string, question: string, runId: string,
): Promise<{ calls: ModelCallInput[]; history: readonly string[] }> {
  const qid = `f156z-q-${runId}`;
  await addChatMessage({ orgId: ORG, id: qid, threadId, body: question, authorId: actor });
  await enqueueRun(threadId, qid, runId);
  const calls: ModelCallInput[] = [];
  const runtimeDeps = deps(calls);
  await executeQueuedRuns(runtimeDeps, { orgId: toOrgId(ORG) });
  // Complete the real lifecycle before another run can claim this same thread.
  expect(await writeBackPendingRuns(runtimeDeps, { orgId: toOrgId(ORG) })).toBe(1);
  const finalCall = calls.at(-1);
  const history = (finalCall?.history ?? []).map((m) => m.content);
  return { calls, history };
}

let clock = 0;
function deps(calls: ModelCallInput[]): ExecuteAgentRunDeps {
  return {
    runs: repo,
    model: {
      async complete(input: ModelCallInput) {
        calls.push(input);
        if (input.system.includes("摘要器")) return { text: `[摘要回显] ${input.user}` };
        return { text: "好的，收到。" };
      },
    },
    files,
    contextSnapshots: snapshots,
    clock: { now: () => new Date(Date.now() + clock++).toISOString(), newStepId: () => `step-${clock}` },
    log: () => {},
  };
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
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ACTOR_A, "consultant", null);
  await addOrgMember(ORG, ACTOR_B, "consultant", null);
  await addProjectMember(ORG, PROJECT, ACTOR_A, "member", null);
  await addChatThread({
    orgId: ORG, id: THREAD_PERSONAL_A, projectId: null, visibilityScope: "private", createdBy: ACTOR_A,
  });
  await addChatThread({
    orgId: ORG, id: THREAD_PERSONAL_B, projectId: null, visibilityScope: "private", createdBy: ACTOR_B,
  });
  await addChatThread({
    orgId: ORG, id: THREAD_PROJECT, projectId: PROJECT, visibilityScope: "plenary", createdBy: ACTOR_A,
  });
  await seedAgent();
});

afterAll(async () => {
  await db.close();
});

describe("F156 个人线程零跨范围召回 + 自有附件可召回（真库 + 真 executeQueuedRuns）", () => {
  it("V1 硬边界：个人线程对 org/项目数据零召回——cross_scope_retrieval_requests 恒 0，无 project-retrieval 伪消息，别人/别项目附件一个都不出现", async () => {
    // 同组织另有已索引的项目 segment：项目线程里一份真实存在、可被召回的附件。
    const projMsg = await seedTurns(THREAD_PROJECT, ACTOR_A, 1, 1);
    await addExtractedAttachment({
      id: "att-f156z-project-secret", threadId: THREAD_PROJECT, messageId: projMsg,
      filename: "project-secret.md",
      excerpt: `项目机密：内部代号 ${CODE_PROJECT_SECRET}。`,
    });
    // 前提校验：这份文件在**项目线程自己**里确实召得回来——否则下面「个人线程召不回」
    // 只是因为索引根本不工作，不是因为范围收窄生效。
    const sanity = await files.search(
      toOrgId(ORG), { threadId: THREAD_PROJECT, projectId: PROJECT, actorUserId: ACTOR_A },
      CODE_PROJECT_SECRET, 5,
    );
    expect(sanity.map((h) => h.text).join("")).toContain(CODE_PROJECT_SECRET);

    // A 在自己的个人线程里，用那份项目机密的代号提问。
    const { history } = await askAndRun(
      THREAD_PERSONAL_A, ACTOR_A, `${CODE_PROJECT_SECRET} 这个代号是什么？`, "f156z-run-v1",
    );

    // 断言 ①：history 里没有任何来自 project-retrieval 的伪消息——个人线程走的是
    // own-attachment 单一分支，压根不会拼出携带项目数据的检索伪消息。
    const fileContextMessages = history.filter((c) => c.startsWith(FILE_CONTEXT_MESSAGE_HEADER_PREFIX));
    for (const m of fileContextMessages) expect(m).not.toContain(CODE_PROJECT_SECRET);
    expect(history.some((c) => c.includes(CODE_PROJECT_SECRET))).toBe(false);

    // 断言 ②：agent_run_context 快照——cross_scope_retrieval_requests == 0，即
    // l3RetrievalScope 恒是 own-attachment，从不是 project-retrieval。
    const snap = await snapshots.findByRunId(toOrgId(ORG), "f156z-run-v1");
    expect(snap).not.toBeNull();
    expect(snap!.l3RetrievalScope).toBe("own-attachment");
    expect(snap!.l3RetrievalScope).not.toBe("project-retrieval");
    // 零命中（本线程没有这个代号的附件），且没有任何来源标记泄漏进 l3Sources。
    expect(snap!.l3HitCount).toBe(0);
    expect(snap!.l3Sources).toEqual([]);
  });

  it("V1 反证对照：l3RetrievalScope 不是一个只会输出 own-attachment 的假字段——同一套 execute-run.ts 生产代码路径，run.projectId 非空时真的记 project-retrieval；若受限召回路径的范围锚点被错误改成恒定 own-attachment，这条会红", async () => {
    await seedTurns(THREAD_PROJECT, ACTOR_A, 3, 1);
    await askAndRun(THREAD_PROJECT, ACTOR_A, "项目线程侧对照提问", "f156z-run-v1-counter");
    const projSnap = await snapshots.findByRunId(toOrgId(ORG), "f156z-run-v1-counter");
    expect(projSnap).not.toBeNull();
    expect(projSnap!.l3RetrievalScope).toBe("project-retrieval");
  });

  it("V2 放宽的部分：超窗口旧附件可召回本线程自己的附件，来源标记 own-attachment，own_thread_attachment_recall > 0，cross_scope_retrieval_requests 仍 0", async () => {
    await seedTurns(THREAD_PERSONAL_A, ACTOR_A, 30, 1, `这一轮我传了一份合同 ${CODE_OWN_ATTACHMENT}`);
    const attachMsg = `f156z-m-${THREAD_PERSONAL_A}-003`;
    await addExtractedAttachment({
      id: "att-f156z-own", threadId: THREAD_PERSONAL_A, messageId: attachMsg,
      filename: "my-contract.md",
      excerpt: `合同正文：内部代号 ${CODE_OWN_ATTACHMENT}，违约金条款见第 7 条。`,
    });

    const { history } = await askAndRun(
      THREAD_PERSONAL_A, ACTOR_A, `${CODE_OWN_ATTACHMENT} 这个代号的违约金条款是什么？`, "f156z-run-v2",
    );

    // 召回了：伪消息里出现来源标记与代号内容。
    const fileContext = history.find((c) => c.startsWith(FILE_CONTEXT_MESSAGE_HEADER_PREFIX));
    expect(fileContext).toBeDefined();
    expect(fileContext).toContain("chat-attachment");
    expect(fileContext).toContain(CODE_OWN_ATTACHMENT);

    const snap = await snapshots.findByRunId(toOrgId(ORG), "f156z-run-v2");
    expect(snap).not.toBeNull();
    expect(snap!.l3Status).toBe("ok");
    // own_thread_attachment_recall > 0：scope 是 own-attachment 且命中数 > 0。
    expect(snap!.l3RetrievalScope).toBe("own-attachment");
    expect(snap!.l3HitCount).toBeGreaterThan(0);
    // cross_scope_retrieval_requests 仍恒 0（这条不放宽）。
    expect(snap!.l3RetrievalScope).not.toBe("project-retrieval");
  });

  it("V3 来源可分辨：agent_run_context 的 l3RetrievalScope 能区分 own-attachment 与 project-retrieval——项目线程侧的对照跑出 project-retrieval，个人线程侧的快照里 project-retrieval 计数恒 0", async () => {
    // 对照：项目线程正常 run 一次，验证同一套快照字段在项目侧确实记 project-retrieval
    // （证明这不是一个只会输出 own-attachment 的假字段）。
    await seedTurns(THREAD_PROJECT, ACTOR_A, 5, 1);
    await askAndRun(THREAD_PROJECT, ACTOR_A, "项目线程侧的提问", "f156z-run-v3-project");
    const projectSnap = await snapshots.findByRunId(toOrgId(ORG), "f156z-run-v3-project");
    expect(projectSnap).not.toBeNull();
    expect(projectSnap!.l3RetrievalScope).toBe("project-retrieval");

    // 个人线程侧：多次 run，project-retrieval 计数恒为 0。
    await seedTurns(THREAD_PERSONAL_A, ACTOR_A, 5, 1);
    const personalRunIds = ["f156z-run-v3-p1", "f156z-run-v3-p2"];
    await askAndRun(THREAD_PERSONAL_A, ACTOR_A, "个人线程侧提问 1", personalRunIds[0]!);
    await askAndRun(THREAD_PERSONAL_A, ACTOR_A, "个人线程侧提问 2", personalRunIds[1]!);
    const personalSnaps = await Promise.all(
      personalRunIds.map((id) => snapshots.findByRunId(toOrgId(ORG), id)),
    );
    const projectRetrievalCount = personalSnaps.filter(
      (s) => s?.l3RetrievalScope === "project-retrieval",
    ).length;
    expect(projectRetrievalCount).toBe(0);
    for (const s of personalSnaps) expect(s?.l3RetrievalScope).toBe("own-attachment");
  });

  it("V4 回归 F153：近端窗口内刚上传的附件无需召回即可见——withAttachmentNotice 直接进 L1，不经任何召回路径", async () => {
    const lastId = await seedTurns(THREAD_PERSONAL_A, ACTOR_A, 2, 1);
    const attachMsgId = `f156z-m-${THREAD_PERSONAL_A}-near`;
    await addChatMessage({
      orgId: ORG, id: attachMsgId, threadId: THREAD_PERSONAL_A, body: "我刚传了一份文件", authorId: ACTOR_A,
    });
    await addExtractedAttachment({
      id: "att-f156z-near", threadId: THREAD_PERSONAL_A, messageId: attachMsgId,
      filename: "near-window.md",
      excerpt: `刚上传的文件正文，代号 ${CODE_NEAR_WINDOW}。`,
    });
    void lastId;

    const { history } = await askAndRun(
      THREAD_PERSONAL_A, ACTOR_A, `${CODE_NEAR_WINDOW} 这份文件说了什么？`, "f156z-run-v4",
    );

    // 附件内容通过 F153 的 withAttachmentNotice 直接进了近端窗口的历史消息本身
    // （不是一条 L3 检索伪消息）——所以断言的目标是「非 L3 伪消息的普通历史消息里能看到附件提示」。
    const nonRetrievalMessages = history.filter((c) => !c.startsWith(FILE_CONTEXT_MESSAGE_HEADER_PREFIX));
    expect(nonRetrievalMessages.some((c) => c.includes("near-window.md"))).toBe(true);
  });

  it("V5 权限：actor A 的个人线程附件，actor B（既有 F108 判定下不可见 A 的个人线程）绝不能在自己的 run 上下文里看到", async () => {
    await seedTurns(THREAD_PERSONAL_A, ACTOR_A, 1, 1);
    const aMsgId = `f156z-m-${THREAD_PERSONAL_A}-v5`;
    await addChatMessage({
      orgId: ORG, id: aMsgId, threadId: THREAD_PERSONAL_A, body: "A 的私人文件", authorId: ACTOR_A,
    });
    await addExtractedAttachment({
      id: "att-f156z-a-private", threadId: THREAD_PERSONAL_A, messageId: aMsgId,
      filename: "a-private.md", excerpt: `A 的私人文件正文，代号 ${CODE_OTHER_PERSONAL}-A。`,
    });
    // 前提：这份文件在 A 自己的线程里确实召得回来。
    const ownCheck = await files.search(
      toOrgId(ORG), { threadId: THREAD_PERSONAL_A, projectId: null, actorUserId: ACTOR_A },
      `${CODE_OTHER_PERSONAL}-A`, 5,
    );
    expect(ownCheck.length).toBeGreaterThan(0);

    // B 在自己的个人线程里，用 A 那份文件的代号提问——不可能召回，因为 B 的 scope
    // 只吃 thread_id == THREAD_PERSONAL_B ∧ created_by == B，与 A 的线程/附件无关。
    await seedTurns(THREAD_PERSONAL_B, ACTOR_B, 1, 1);
    const { history } = await askAndRun(
      THREAD_PERSONAL_B, ACTOR_B, `${CODE_OTHER_PERSONAL}-A 这个代号是什么？`, "f156z-run-v5",
    );
    expect(history.some((c) => c.includes(`${CODE_OTHER_PERSONAL}-A`))).toBe(false);

    const snap = await snapshots.findByRunId(toOrgId(ORG), "f156z-run-v5");
    expect(snap).not.toBeNull();
    expect(snap!.l3HitCount).toBe(0);
    expect(snap!.l3RetrievalScope).toBe("own-attachment"); // B 自己也是个人线程，scope 不变

    // 反向直查：B 伪造一次调用，拿着 A 的线程 id 当自己的 threadId 去查——created_by
    // 谓词让这一行连查询本身都查不出来（不是查出来再过滤）。
    const forged = await files.search(
      toOrgId(ORG), { threadId: THREAD_PERSONAL_A, projectId: null, actorUserId: ACTOR_B },
      `${CODE_OTHER_PERSONAL}-A`, 5,
    );
    expect(forged).toEqual([]);
  });
});
