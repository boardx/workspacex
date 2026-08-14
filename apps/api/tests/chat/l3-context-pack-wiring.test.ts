/**
 * F155 L3 —— **文件式检索接线**的真栈反证（design delta `context-engine-l3-file-based`，
 * 人类 2026-08-14 签核；验收口径 `verification.md` V1/V2/V3/V6/V8）。
 *
 * ## 为什么必须走真库 + 真 `executeQueuedRuns`
 *
 * L3 的全部主张是「Postgres 原生全文索引真的能把旧文件捞回来」。用内存 fake 检索端口测，
 * 测到的只是「组装函数会把我塞给它的东西拼进 history」——`tsvector` 生成列建在哪一列、
 * `plainto_tsquery` 的 AND 会不会把召回率打到 0、落地产物写没写进 `content_excerpt`，
 * 这些**恰恰是唯一会错的地方**，全都在 fake 后面看不见。所以除了 V6（刻意注入失败）之外，
 * 每条都跑真 `PgFileRetrieval` + 真 migration 建出来的索引。
 *
 * 画布产物那条（V2）走的是**真的 `landAsArtifact`**（真 artifact 仓储 + 真对象存储 +
 * 真落地仓储），不是直接 INSERT 一行 `chat_artifact_landings`——delta §4 的主张是「经这条
 * 已有路径落地即可检索，不需要用户额外操作」，直接 INSERT 会把这句话里唯一可能错的那一环
 * （`landAsArtifact` 到底有没有把正文交给索引）测掉。
 *
 * `ModelCallPort` 用确定性 fake（不接真模型），同 `layered-history-l2-persist.test.ts` 的既有做法。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatThread, addChatMessage } from "../support/chat-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgAgentRunRepository } from "../../src/infrastructure/agent-run/pg-agent-run-repository";
import { PgFileRetrieval } from "../../src/infrastructure/agent-run/pg-file-retrieval";
import { PgArtifactRepository } from "../../src/infrastructure/artifact/pg-artifact-repository";
import { PgArtifactLandingRepository } from "../../src/infrastructure/chat/pg-artifact-landing-repository";
import { PgChatRepository } from "../../src/infrastructure/chat/pg-chat-repository";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgProvenanceRepository } from "../../src/infrastructure/provenance/pg-provenance-repository";
import { FsObjectStore } from "../../src/infrastructure/storage/fs-object-store";
import { landAsArtifact } from "../../src/application/chat/land-as-artifact";
import { executeQueuedRuns, type ExecuteAgentRunDeps } from "../../src/application/agent-run/execute-run";
import type { FileRetrievalPort } from "../../src/application/agent-run/file-retrieval";
import type { ModelCallInput } from "../../src/application/agent-run/ports";
import { toOrgId } from "../../src/domain/org-id";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f155-wiring";
const PROJECT = "proj-f155-wiring";
const THREAD = "thr-f155-wiring";
const ACTOR = "u-f155-wiring";
const AGENT_ID = "agent-f155-wiring";
const MODEL_PROVIDER = "test-provider";
const MODEL_ID = "test-model";

/**
 * 三个互不相同的代号。**刻意用 ASCII 代号而不是中文短语**：Postgres 默认解析器不切分中文
 * （迁移文件头的具名局限 `GAP-CE-FTS-CJK-SEGMENTATION`），用中文做关键词测不出索引对错，
 * 只会测出解析器的分词行为。验收口径 V1 说的「某个代号」就是这个形状。
 */
const CODE_ATTACHMENT = "ZEPHYR7742";
const CODE_MERMAID = "KESTREL9931";
const CODE_UNSAVED = "OSPREY5518";
/** 不会被提问的第二份附件——用来反证「召回是关键词驱动的」，不是把所有文件一股脑塞进去。 */
const CODE_DECOY = "NARWHAL1204";

let db: PgDatabase;
let repo: PgAgentRunRepository;
let files: PgFileRetrieval;
let agentVersionId: string;

/** 撑满字符预算，逼 `trimHistoryToBudget` 把早期轮次赶出 L1（同 L2 测试的既有算法）。 */
function pad(text: string): string {
  return `${text}——${"占位内容用于撑满单条消息的字符预算".repeat(46)}`;
}

async function seedAgent(): Promise<void> {
  const instructions = "You are a helpful assistant for F155 L3 file retrieval testing.";
  await asApp(ORG, async (c) => {
    await c.query(
      `INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'enabled',$5,now(),now())`,
      [AGENT_ID, ORG, AGENT_ID, "F155 L3 测试 agent", ACTOR],
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
    const id = `f155w-m${String(i).padStart(3, "0")}`;
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

/** 一份**已抽取**的聊天附件（F153 的 `extraction_status='extracted'` + `extracted_excerpt`）。 */
async function addExtractedAttachment(opts: {
  id: string; messageId: string; threadId?: string; filename: string; excerpt: string;
}): Promise<void> {
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO chat_message_attachments
         (id, org_id, thread_id, message_id, storage_ref, filename, mime, bytes,
          extraction_status, extracted_excerpt)
       VALUES ($1,$2,$3,$4,$5,$6,'text/markdown',1024,'extracted',$7)`,
      [opts.id, ORG, opts.threadId ?? THREAD, opts.messageId, `s3://${opts.id}`,
        opts.filename, opts.excerpt],
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

/** 提问那条消息本身（run 的 input）。它不进 `readThreadHistory`，以 `inputText` 单独进模型。 */
async function askAndRun(question: string, runId: string, override?: Partial<ExecuteAgentRunDeps>): Promise<ModelCallInput[]> {
  const qid = `f155w-q-${runId}`;
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
    clock: { now: () => new Date(Date.now() + clock++).toISOString(), newStepId: () => `step-${clock}` },
    log: () => {},
  };
}

/** 最终回答那次调用（不是摘要调用）的 history 里，L3 注入的那条伪消息。没有则 null。 */
function fileContextOf(calls: ModelCallInput[]): string | null {
  const answer = calls.filter((c) => !c.system.includes("摘要器")).at(-1);
  const found = (answer?.history ?? []).find((m) => m.content.startsWith("[检索到的相关文件"));
  return found?.content ?? null;
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgAgentRunRepository(db);
  files = new PgFileRetrieval(db);
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ACTOR, "consultant", null);
  await addProjectMember(ORG, PROJECT, ACTOR, "member", null);
  await addChatThread({
    orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: ACTOR,
  });
  await seedAgent();
});

afterAll(async () => {
  await db.close();
});

describe("F155 L3 文件式检索接线（真库 + 真 executeQueuedRuns + 真 tsvector 索引）", () => {
  it("V1：早已滚出 L1 窗口的聊天附件，按其正文里的代号提问仍能被召回，且来源标为 chat-attachment", async () => {
    const lastId = await seedTurns(30, 1, "这一轮我传了一份合同");
    await addExtractedAttachment({
      id: "att-f155-v1", messageId: "f155w-m003", filename: "contract-2026.md",
      excerpt: `合同正文：违约金条款见第 7 条，内部代号 ${CODE_ATTACHMENT}，适用范围为全年。`,
    });
    // 第二份附件：内容里是另一个代号，本轮**不问它**——它不该被召回。
    await addExtractedAttachment({
      id: "att-f155-decoy", messageId: "f155w-m005", filename: "unrelated-notes.md",
      excerpt: `与本次提问无关的笔记，代号 ${CODE_DECOY}。`,
    });
    expect(lastId).not.toBe("");

    const calls = await askAndRun(`${CODE_ATTACHMENT} 这个代号对应的违约金条款是什么？`, "run-v1");

    const fileContext = fileContextOf(calls);
    expect(fileContext).not.toBeNull();
    // 召回的是**正文**（不是文件名）——索引建在 `extracted_excerpt` 上这件事的直接反证：
    // 把生成列改成只索引 filename，这一行当场红。
    expect(fileContext!).toContain(CODE_ATTACHMENT);
    expect(fileContext!).toContain("违约金条款见第 7 条");
    // 来源标记（V1/V2 都要求可区分来源）。
    expect(fileContext!).toContain("chat-attachment");
    // 关键词驱动，不是「把这条线程所有文件都塞进去」。
    expect(fileContext!).not.toContain(CODE_DECOY);
  });

  it("V2：经真实 landAsArtifact 保存的 mermaid 图，按图里的代号提问能被召回，来源标为 canvas-artifact", async () => {
    await seedTurns(30, 1);
    // 一条 agent 消息，其内容里有 mermaid 图；用户在画布里点了保存 ⇒ 走 #1149 的 landAsArtifact。
    const msgId = "f155w-mermaid-src";
    await addChatMessage({
      orgId: ORG, id: msgId, threadId: THREAD, body: "这是流程图：", authorId: ACTOR,
      authorKind: "agent", agentId: AGENT_ID,
    });
    const mermaid = [
      "```mermaid",
      "flowchart TD",
      `  A["接入层"] --> B["核心编排 ${CODE_MERMAID}"]`,
      "  B --> C[\"存储层\"]",
      "```",
    ].join("\n");

    const root = await mkdtemp(join(tmpdir(), "f155-store-"));
    const store = new FsObjectStore(root);
    let seq = 0;
    const landed = await landAsArtifact(
      {
        chat: new PgChatRepository(db),
        repo: new PgIdentityRepository(db),
        ids: { next: () => `dec-${(seq += 1)}` },
        artifacts: new PgArtifactRepository(db),
        store,
        // 标题**刻意不含代号**：若实现只把标题喂给索引、漏了正文，本用例当场红——这正是
        // verification V2 的反证口径（也是人类原话第二条要求「生成的 mermaid 也要在检索范围」）。
        artifactIds: { next: (prefix: string) => `${prefix}-f155-${(seq += 1)}-${randomUUID().slice(0, 8)}` },
        landings: new PgArtifactLandingRepository(db),
        provenance: new PgProvenanceRepository(db),
      },
      {
        userId: ACTOR, orgId: toOrgId(ORG), threadId: THREAD, messageId: msgId,
        mode: "draft", title: "系统架构图", payloadRef: mermaid,
      },
    );
    expect(landed.artifactId).not.toBe("");

    // 落地即写入了可索引的正文（delta §4：不需要用户额外操作）。
    const stored = await asApp(ORG, (c) =>
      c.query<{ content_excerpt: string | null }>(
        "SELECT content_excerpt FROM chat_artifact_landings WHERE org_id=$1 AND artifact_id=$2",
        [ORG, landed.artifactId],
      ));
    expect(stored.rows[0]?.content_excerpt).toContain(CODE_MERMAID);

    const calls = await askAndRun(`${CODE_MERMAID} 这个节点在架构里负责什么？`, "run-v2");
    const fileContext = fileContextOf(calls);
    expect(fileContext).not.toBeNull();
    expect(fileContext!).toContain(CODE_MERMAID);
    expect(fileContext!).toContain("canvas-artifact");
    // 与附件来源可区分（V2 原话「来源标记区分于『附件』」）。
    expect(fileContext!).not.toContain("chat-attachment");
  });

  it("V3：没有保存的 mermaid 图不进检索范围——它只活在对话文本里，不出现在 L3 召回结果中", async () => {
    // 图只出现在一条早期消息正文里，**没有**走 landAsArtifact。
    await seedTurns(30, 1, `这是草图：\n\`\`\`mermaid\nflowchart TD\n  A["${CODE_UNSAVED}"] --> B["未保存"]\n\`\`\``);

    const calls = await askAndRun(`${CODE_UNSAVED} 是什么？`, "run-v3");

    // 断言的是**检索范围**，不是「模型完全看不到这几个字」：L2 摘要覆盖旧轮是 L1/L2 的正常
    // 职责，与「未保存的图该不该进 L3 检索索引」是两件事。所以精确断言在 L3 那条伪消息上。
    const fileContext = fileContextOf(calls);
    if (fileContext !== null) expect(fileContext).not.toContain(CODE_UNSAVED);
    // 没有 `content.md` 就不在索引里——直接问检索端口，零命中。
    const hits = await files.search(
      toOrgId(ORG), { threadId: THREAD, projectId: PROJECT, actorUserId: ACTOR }, CODE_UNSAVED, 5,
    );
    expect(hits).toEqual([]);
  });

  it("V6：检索查询失败 —— run 不失败、不 block，降级为「本次 L3 未召回」，用户仍拿到基于 L1/L2 的回答", async () => {
    await seedTurns(30, 1, "这一轮我传了一份合同");
    await addExtractedAttachment({
      id: "att-f155-v6", messageId: "f155w-m003", filename: "contract-2026.md",
      excerpt: `合同正文：内部代号 ${CODE_ATTACHMENT}。`,
    });

    const exploding: FileRetrievalPort = {
      async search() { throw new Error("relation \"chat_message_attachments\" does not exist"); },
    };
    const calls = await askAndRun(`${CODE_ATTACHMENT} 是什么？`, "run-v6", { files: exploding });

    // run 照常完成：模型被调用了、且 run 没有落在 failed 上。
    // 反证：若实现照抄了五路召回引擎「任一路失败即整体 block」的纪律（RetrievalUnavailableError），
    // run 会 failed 且模型根本不会被调用——下面两行同时红。
    const answerCalls = calls.filter((c) => !c.system.includes("摘要器"));
    expect(answerCalls.length).toBe(1);
    const status = await asApp(ORG, (c) =>
      c.query<{ status: string; error_code: string | null }>(
        "SELECT status, error_code FROM agent_runs WHERE org_id=$1 AND id=$2", [ORG, "run-v6"]));
    expect(status.rows[0]?.status).not.toBe("failed");
    expect(status.rows[0]?.error_code).toBeNull();
    // 降级 = 这一轮没有 L3 伪消息（不是塞一条「检索失败了」的噪声进上下文）。
    expect(fileContextOf(calls)).toBeNull();
  });

  it("V8：ModelCallInput 形状不变 —— L3 注入的仍只是一条 role+content 伪消息，无新字段", async () => {
    await seedTurns(30, 1, "这一轮我传了一份合同");
    await addExtractedAttachment({
      id: "att-f155-v8", messageId: "f155w-m003", filename: "contract-2026.md",
      excerpt: `合同正文：内部代号 ${CODE_ATTACHMENT}。`,
    });

    const calls = await askAndRun(`${CODE_ATTACHMENT} 是什么？`, "run-v8");
    const answer = calls.filter((c) => !c.system.includes("摘要器")).at(-1)!;
    expect(fileContextOf(calls)).not.toBeNull(); // 前提：这一轮确实注入了 L3，否则本条空转

    for (const m of answer.history ?? []) {
      // 逐条断言键集合恰好是 {role, content}——多一个字段就是契约漂移（同 F154 的同一条纪律）。
      expect(Object.keys(m).sort()).toEqual(["content", "role"]);
      expect(["user", "assistant"]).toContain(m.role);
      expect(typeof m.content).toBe("string");
    }
  });
});
