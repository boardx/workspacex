/**
 * #1652 —— 「chat 里 `#` 挂 skill → 真的产出 .pptx」这条链路的**真栈门控**。
 *
 * ## 为什么已经有一支测试了还要这一支
 *
 * `tests/agent-runtime/chat-skill-script-execution.test.ts`（#1624 带的）测的是
 * `maybeRunSkillScript` **这一个函数**，沙箱和对象存储都是进程内替身。它能证明触发判据
 * 和失败文案是对的，证明不了：
 *
 * - `execute-run.ts` 到底有没有把 `sandbox`/`objects` 接上去（改坏接线，那支仍全绿）；
 * - `#` 挂载的 skill 版本有没有真的进到 run 快照里、让 `pinnedSkillCount > 0`；
 * - `HttpSkillSandbox` 的 JSON 协议解析对不对（那支根本不过 HTTP）；
 * - 产物字节有没有真的落进 `ObjectStore`、键是不是 `agent-run-outputs/<runId>/<name>`；
 * - `commitWriteback` 有没有把文件挂成附件、run 有没有真的走到 `succeeded`。
 *
 * 人类 2026-08-20 用真实 qwen3.8-max + 真实沙箱手工走通过一次，但**全仓没有任何自动化
 * 测试覆盖这条端到端链路**——下次有人改坏其中任何一段都不会有东西变红。这支补的是那道门。
 *
 * ## 真什么、替身什么（不是随手选的）
 *
 * | 组件 | 真栈里用什么 | 为什么 |
 * |---|---|---|
 * | 数据库 | **真 Postgres** | `model_output_files` 是 jsonb 列、附件是另一张表，内存 fake 测不到 SQL |
 * | HTTP 服务 | **真 Nest app**（`createApp()` + `listen(0)`） | 被测的是 `kernel.module.ts` 的合成，不是某个函数 |
 * | 模型 | **真 `ConfiguredModelProvider` 走真 HTTP**，上游是确定性 loopback | 门控必须可复现、不烧钱、不依赖外网 |
 * | 沙箱 | **真 `HttpSkillSandbox` 走真 HTTP**，上游是 `loopback-skill-sandbox-behavior` | 同上；替身回的是**真实合法**的 OOXML，不是假字节 |
 * | 对象存储 | **真 `FsObjectStore`**（从容器里取出来的那一个） | 断言要落在**读回来的字节**上 |
 *
 * ⚠ 替身替的是「模型会写出什么脚本」和「沙箱执行的结果」这两件**我们不控制**的事，
 *   不是链路本身的任何一段。`SANDBOX_UNAVAILABLE` 那一档在别处用「指向没人监听的端口」
 *   造，不靠替身假装自己坏了。
 *
 * ## ⚠ 断言落在从 ObjectStore **读回来**的字节上
 *
 * 不是 `maybeRunSkillScript` 刚 `Buffer.from(base64)` 出来的那份。人类手工验证时就是
 * 这么做的：写出去再读回来，中间经过序列化、落盘、按键取回，才证明整条链路而不是某一段。
 * 对着刚写出的 buffer 断言，等于测了一次 `Buffer.from`。
 */
import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { inspectPptx } from "@repo/skill-sandbox/ooxml";
import {
  addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatThread } from "../support/chat-db";
import {
  AGENT_RUN_EXECUTOR, type AgentRunExecutorPort,
} from "../../src/application/agent-run/ports";
import { OBJECT_STORE, type ObjectStore } from "../../src/application/artifact/ports";
import {
  LOOPBACK_REAL_STDERR, startLoopbackSkillSandbox,
  type LoopbackSandboxHandle,
} from "../../scripts/loopback-skill-sandbox-behavior";
import { toOrgId } from "../../src/domain/org-id";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-i1652-pptx";
const PROJECT = "proj-i1652-pptx";
const THREAD = "thread-i1652-pptx";
const ACTOR = "u-i1652-pptx";

const PROVIDER = "i1652-loopback";
const MODEL = "i1652-model";
const AGENT = "agent-i1652-pptx";
const AGENT_V1 = "agent-version-i1652-pptx-v1";
/** 不挂任何 skill 的 agent —— T3 第 ① 格用。 */
const AGENT_BARE = "agent-i1652-bare";
const AGENT_BARE_V1 = "agent-version-i1652-bare-v1";
const SKILL = "skill-i1652-pptx";
const SKILL_V1 = "skill-version-i1652-pptx-v1";
/** Phase 14 F01 起未被任何 it() 使用（原 T6 渐进式加载真栈门控已随 `useLazySkillLoading` 一并物理删除）；保留夹具本身无害，未来若需要"多 skill 挂载"场景可复用。 */
const SKILL_B = "skill-i1652-lazy-b";
const SKILL_B_V1 = "skill-version-i1652-lazy-b-v1";
const SKILL_B_CONTENT = "# 第二个 skill\n\nSKILL_B_UNIQUE_SENTENCE_ONLY_IN_FULL_CONTENT：这是第二个 skill 的正文，只有请求过全文才应该出现在 system 里。";

const sha256 = (v: string): string => createHash("sha256").update(v).digest("hex");

/* ═════════════════════ 确定性模型替身（真 HTTP，OpenAI 兼容） ═════════════════════ */

interface CapturedCall {
  readonly body: { messages?: { role: string; content: string }[] };
}

let modelServer: Server;
let modelBase = "";
let modelCalls: CapturedCall[] = [];
/**
 * 按调用序号给回复。第 1 个给第 1 次 `complete()`，第 2 个给回喂重试，以此类推；
 * 用完之后重复最后一个——`__LOOPBACK_ALWAYS_FAIL__` 那一格要连着三次都拿到脚本。
 */
let modelReplies: string[] = [];

function replyQueue(...texts: string[]): void {
  modelReplies = texts;
}

async function startModelStub(): Promise<void> {
  modelServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      let body: CapturedCall["body"] = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as CapturedCall["body"];
      } catch { body = {}; }
      modelCalls.push({ body });
      const text = modelReplies[Math.min(modelCalls.length - 1, modelReplies.length - 1)] ?? "";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: text } }] }));
    });
  });
  await new Promise<void>((resolve) => modelServer.listen(0, "127.0.0.1", resolve));
  modelBase = `http://127.0.0.1:${String((modelServer.address() as AddressInfo).port)}`;
}

/** 一段**看起来就是模型会写的**回复：解释文字 + 一个 `run_script` 块。 */
function replyWithScript(opts: {
  readonly prose?: string;
  readonly marker?: string;
  readonly fileName?: string;
  readonly slides?: readonly string[];
}): string {
  const slides = opts.slides ?? ["WorkspaceX 是什么", "三条核心链路", "下一步"];
  const lines = [
    opts.prose ?? "好的，我用 pptxgenjs 给你做一份三页的介绍 deck。",
    "",
    "```run_script",
    "const PptxGenJS = require('pptxgenjs');",
    ...(opts.marker === undefined ? [] : [`// ${opts.marker}`]),
    "const pres = new PptxGenJS();",
    ...slides.map((s) => `pres.addSlide().addText('${s}', { x: 0.5, y: 0.5 });`),
    `pres.writeFile({ fileName: require('path').join(process.env.SKILL_SANDBOX_OUT_DIR, '${opts.fileName ?? "WorkspaceX_Intro.pptx"}') });`,
    "```",
  ];
  return lines.join("\n");
}

/* ═════════════════════════════ 目录 fixtures ═════════════════════════════ */

async function seedSkillVersion(): Promise<void> {
  const content = "# PPTX Skill\n用 pptxgenjs 生成演示文稿。";
  await asApp(ORG, async (c) => {
    await c.query(
      `INSERT INTO skills (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'enabled',$5,now(),now()) ON CONFLICT DO NOTHING`,
      [SKILL, ORG, SKILL, "PPTX", ACTOR],
    );
    await c.query(
      `INSERT INTO skill_versions
         (id,org_id,skill_id,semantic_label,content_digest,manifest,creator_id,created_at,published)
       VALUES ($1,$2,$3,'v1',$4,'{}'::jsonb,$5,now(),false)`,
      [SKILL_V1, ORG, SKILL, sha256(content), ACTOR],
    );
    await c.query(
      `INSERT INTO skill_version_files (org_id,version_id,path,content,media_type,digest)
       VALUES ($1,$2,'SKILL.md',$3::bytea,'text/markdown',$4)`,
      [ORG, SKILL_V1, Buffer.from(content, "utf8"), sha256(content)],
    );
    await c.query("SELECT wave2_publish_skill_version($1,$2)", [ORG, SKILL_V1]);
  });
}

/** Phase 14 F01 起未被任何 it() 使用，理由同 `SKILL_B` 声明处的注释。 */
async function seedSecondSkillVersion(): Promise<void> {
  await asApp(ORG, async (c) => {
    await c.query(
      `INSERT INTO skills (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'enabled',$5,now(),now()) ON CONFLICT DO NOTHING`,
      [SKILL_B, ORG, SKILL_B, "Skill B", ACTOR],
    );
    await c.query(
      `INSERT INTO skill_versions
         (id,org_id,skill_id,semantic_label,content_digest,manifest,creator_id,created_at,published)
       VALUES ($1,$2,$3,'v1',$4,'{}'::jsonb,$5,now(),false)`,
      [SKILL_B_V1, ORG, SKILL_B, sha256(SKILL_B_CONTENT), ACTOR],
    );
    await c.query(
      `INSERT INTO skill_version_files (org_id,version_id,path,content,media_type,digest)
       VALUES ($1,$2,'SKILL.md',$3::bytea,'text/markdown',$4)`,
      [ORG, SKILL_B_V1, Buffer.from(SKILL_B_CONTENT, "utf8"), sha256(SKILL_B_CONTENT)],
    );
    await c.query("SELECT wave2_publish_skill_version($1,$2)", [ORG, SKILL_B_V1]);
  });
}

async function seedAgent(agentId: string, versionId: string): Promise<void> {
  const instructions = `You are ${agentId}.`;
  await asApp(ORG, async (c) => {
    await c.query(
      `INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'enabled',$5,now(),now()) ON CONFLICT DO NOTHING`,
      [agentId, ORG, agentId, agentId, ACTOR],
    );
    await c.query(
      `INSERT INTO agent_versions
         (id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,
          model_provider,model_id,tool_policy,creator_id,created_at,published_at)
       VALUES ($1,$2,$3,'v1',$4,$5,'{}'::text[],$6,$7,'[]'::jsonb,$8,now(),now())`,
      [versionId, ORG, agentId, sha256(instructions), instructions, PROVIDER, MODEL, ACTOR],
    );
    await c.query("UPDATE agents SET published_version_id=$1 WHERE id=$2 AND org_id=$3",
      [versionId, agentId, ORG]);
  });
}

/**
 * chat 里的 `#` 挂载**本体** —— 往 `thread_skill_mounts` 写一行。
 *
 * ⚠ 刻意**不**把 skill 塞进 `agent_versions.skill_version_ids`：那测的是"agent 出厂就带
 *   这个 skill"，与用户在 chat 里 `#` 挂一个上去是两条不同的路。本 issue 要守的是后者，
 *   而后者多一段「受理时把当前挂载注入 run 快照」的接线（#1559），只有走挂载才过得到。
 */
async function mountSkillOnThread(skillId = SKILL, versionId = SKILL_V1): Promise<void> {
  await asApp(ORG, (c) => c.query(
    `INSERT INTO thread_skill_mounts
       (mount_id, org_id, thread_id, skill_id, version_id, mounted_at, removed_at)
     VALUES ($1,$2,$3,$4,$5,now(),NULL)`,
    [`mount-i1652-${randomUUID()}`, ORG, THREAD, skillId, versionId],
  ));
}

/* ═════════════════════════════ HTTP / 读库 helpers ═════════════════════════════ */

let app: NestExpressApplication;
let BASE = "";
let sandbox: LoopbackSandboxHandle;

const principal = () => ({
  "x-kernel-test-principal": `${ACTOR}:${ORG}`,
  "content-type": "application/json",
});

async function postMessage(text: string, agentId = AGENT): Promise<string> {
  const response = await fetch(`${BASE}/chat/threads/${THREAD}/messages`, {
    method: "POST",
    headers: principal(),
    body: JSON.stringify({ clientMessageId: randomUUID(), text, agentId }),
  });
  expect(response.status, await response.clone().text()).toBe(202);
  return (await response.json() as { agentRunId: string }).agentRunId;
}

/** 一次执行器 tick——与受理时那一脚踢的是**同一个**执行器，只是这里 await 得确定。 */
const tick = () => app.get<AgentRunExecutorPort>(AGENT_RUN_EXECUTOR).tick(toOrgId(ORG));

interface RunRow {
  status: string;
  model_called_seq: number;
  model_output_files: readonly { name: string; mime: string; sizeBytes: number; objectKey: string }[];
  skill_version_ids: readonly string[];
}

const readRunRow = (runId: string) => asApp(ORG, (c) => c.query<RunRow>(
  `SELECT status, model_called_seq, model_output_files, skill_version_ids
     FROM agent_runs WHERE org_id=$1 AND id=$2`, [ORG, runId],
)).then((r) => r.rows[0]!);

const readSteps = (runId: string) => asApp(ORG, (c) => c.query<{ kind: string; status: string }>(
  `SELECT kind, status FROM agent_run_steps WHERE org_id=$1 AND run_id=$2 ORDER BY seq`,
  [ORG, runId],
)).then((r) => r.rows);

const readAssistantBody = (runId: string) => asApp(ORG, (c) => c.query<{ id: string; body: string }>(
  `SELECT id, body FROM chat_messages WHERE org_id=$1 AND agent_run_id=$2 AND author_kind='agent'`,
  [ORG, runId],
)).then((r) => r.rows);

/**
 * ⚠ `bytes` 声明成 `string`：`chat_message_attachments.bytes` 是 `bigint`，node-pg
 * 默认把它解析成字符串（bigint 超出 JS 安全整数范围，静默转 number 会丢精度）。
 * 断言时显式 `Number(...)`，不要把它当数字直接比——`expect('54723').toBe(54723)` 会红。
 */
const readAttachments = (messageId: string) => asApp(ORG, (c) => c.query<{
  filename: string; mime: string; bytes: string; storage_ref: string;
}>(
  `SELECT filename, mime, bytes, storage_ref FROM chat_message_attachments
    WHERE org_id=$1 AND message_id=$2`, [ORG, messageId],
)).then((r) => r.rows);

/** 从容器里取出**生产用的那一个** ObjectStore，按键把字节读回来。 */
async function readBackBytes(objectKey: string): Promise<Buffer> {
  const bytes = await app.get<ObjectStore>(OBJECT_STORE).get(objectKey);
  expect(bytes, `object store has nothing at ${objectKey}`).not.toBeNull();
  return Buffer.from(bytes!);
}

/** 一段用例期间沙箱被真正调用了几次（计数是累积的，只有增量才有意义）。 */
async function countedSandboxRuns<T>(fn: () => Promise<T>): Promise<{ result: T; runs: number }> {
  const before = sandbox.runCount();
  const result = await fn();
  return { result, runs: sandbox.runCount() - before };
}

/* ═════════════════════════════ 生命周期 ═════════════════════════════ */

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await startModelStub();
  sandbox = await startLoopbackSkillSandbox(0);

  process.env.KERNEL_MODEL_PROVIDER = PROVIDER;
  process.env.KERNEL_MODEL_BASE_URL = modelBase;
  process.env.KERNEL_MODEL_API_KEY = "sk-i1652-do-not-echo";
  // 真 `HttpSkillSandbox` 的 TCP 分支。生产是 unix socket，协议同一套。
  process.env.KERNEL_SKILL_SANDBOX_BASE_URL = `http://127.0.0.1:${String(sandbox.port)}`;
  // 受理时那一脚自动 kick 关掉：本文件要能把「发消息」与「执行」排出确定顺序。
  process.env.KERNEL_AGENT_RUN_AUTOSTART = "0";

  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  BASE = `http://127.0.0.1:${String((app.getHttpServer().address() as AddressInfo).port)}`;
}, 180_000);

afterAll(async () => {
  await app?.close();
  await new Promise<void>((resolve) => modelServer.close(() => resolve()));
  await sandbox?.close();
});

beforeEach(async () => {
  modelCalls = [];
  replyQueue("（未设置回复）");
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ACTOR, "consultant", fx.teams.energy ?? null);
  await addProjectMember(ORG, PROJECT, ACTOR, "facilitator", null);
  await addChatThread({
    orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: ACTOR,
  });
  await seedSkillVersion();
  await seedSecondSkillVersion();
  await seedAgent(AGENT, AGENT_V1);
  await seedAgent(AGENT_BARE, AGENT_BARE_V1);
});

/* ═══════════════════════════════ T1 ═══════════════════════════════ */

describe("T1 端到端：`#` 挂 skill → 发一句话 → 真的产出一个可解析的 .pptx", () => {
  it("run 走到 succeeded，产物字节从 ObjectStore 读回来是合法 OOXML，且挂成了消息附件", async () => {
    await mountSkillOnThread();
    replyQueue(replyWithScript({
      fileName: "WorkspaceX_Intro.pptx",
      slides: ["WorkspaceX 是什么", "三条核心链路", "下一步"],
    }));

    const runId = await postMessage("帮我做一份三页的 WorkspaceX 介绍 deck");
    await tick();

    const run = await readRunRow(runId);

    // ① `#` 挂的那个版本真的进了 run 快照——否则 `pinnedSkillCount` 是 0，
    //    下面一切都会因为"根本没挂 skill"而不发生，却看不出是哪一段断的。
    expect(run.skill_version_ids).toContain(SKILL_V1);

    // ② 终态与人类手工实测一致。
    expect(run.status).toBe("succeeded");
    expect(run.model_called_seq).toBe(3);
    expect((await readSteps(runId)).map((s) => s.kind))
      .toEqual(["accepted", "context_built", "model_called", "chat_writeback"]);
    expect((await readSteps(runId)).every((s) => s.status === "succeeded")).toBe(true);

    // ③ 产物元数据形状（人类实测的那一份的形状，`sizeBytes` 由真实 pptx 决定）。
    expect(run.model_output_files).toHaveLength(1);
    const file = run.model_output_files[0]!;
    expect(file.name).toBe("WorkspaceX_Intro.pptx");
    expect(file.mime)
      .toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation");
    expect(file.objectKey).toBe(`agent-run-outputs/${runId}/WorkspaceX_Intro.pptx`);
    expect(file.sizeBytes).toBeGreaterThan(0);

    // ④ ⚠ 断言落在**读回来的字节**上，不是刚写出的 buffer。
    const bytes = await readBackBytes(file.objectKey);
    expect(bytes.length).toBe(file.sizeBytes);

    // ⑤ 真的是一个能被解析的 pptx：zip 完整性 / Content_Types / slideN.xml / 正文非空。
    //    `inspectPptx` 是 `@repo/skill-sandbox/ooxml` 的那一个，不在这里写第二份 OOXML 断言。
    const deck = inspectPptx(bytes);
    expect(deck.slideCount).toBe(3);
    expect(deck.textRuns.filter((t) => t.trim() !== "").length).toBeGreaterThan(0);
    expect(deck.textRuns.join("|")).toContain("三条核心链路");

    // ⑥ 用户在这条消息上真的能拿到它：附件行存在，且指向同一个对象键。
    const [assistant] = await readAssistantBody(runId);
    expect(assistant).toBeDefined();
    const attachments = await readAttachments(assistant!.id);
    expect(attachments).toHaveLength(1);
    expect(attachments[0]!.storage_ref).toBe(file.objectKey);
    expect(attachments[0]!.filename).toBe("WorkspaceX_Intro.pptx");
    expect(Number(attachments[0]!.bytes)).toBe(file.sizeBytes);

    // ⑦ 模型原文保留（成功文案只在后面追加事实说明，不改写模型说过的话）。
    expect(assistant!.body).toContain("好的，我用 pptxgenjs 给你做一份三页的介绍 deck。");
    expect(assistant!.body).toContain("WorkspaceX_Intro.pptx");
  }, 120_000);

  /**
   * **T1-CP 反证**：沙箱回一个 0 字节文件（`__LOOPBACK_EMPTY_FILE__`）。
   *
   * 这一格存在的唯一理由是钉死上面第 ⑤ 步：如果有人把 OOXML 断言放宽成
   * 「文件大小 ≥ 0」「后缀是 .pptx」，T1 会在一个空产物上继续绿。这里证明
   * **同一段读回+解析代码**面对空字节确实会抛——即那段断言真的有牙。
   */
  it("T1-CP：沙箱回 0 字节 ⇒ 同一段读回+OOXML 断言必须变红", async () => {
    await mountSkillOnThread();
    replyQueue(replyWithScript({ marker: "__LOOPBACK_EMPTY_FILE__" }));

    const runId = await postMessage("做个 deck");
    await tick();

    const run = await readRunRow(runId);
    // 上层并不知道产物是空的——它照常成功、照常落库。这正是这条反证要暴露的东西。
    expect(run.status).toBe("succeeded");
    expect(run.model_output_files).toHaveLength(1);
    const file = run.model_output_files[0]!;
    expect(file.sizeBytes).toBe(0);

    const bytes = await readBackBytes(file.objectKey);
    expect(bytes.length).toBe(0);
    // ⚠ 这一行就是 T1 第 ⑤ 步的同一个调用。它必须抛。
    expect(() => inspectPptx(bytes)).toThrow();
  }, 120_000);
});

/* ═══════════════════════════════ T3 ═══════════════════════════════ */

describe("T3 触发判据：不满足时沙箱一次都不被调用", () => {
  it("组织没有已启用 skill、agent 也没钉 ⇒ 沙箱调用计数为 0，正文就是模型原文", async () => {
    const reply = replyWithScript({ prose: "这是给你看的示例代码：" });
    replyQueue(reply);

    // #2514：agent 没钉 skill 时 run 默认加载组织全部**已启用** skill——本夹具种的
    // 两个 skill 都是 enabled，`AGENT_BARE` 不再"一个 skill 都没有"。这条要证明的是
    // 「没有任何 skill 可用 ⇒ 沙箱不被调用」，所以把组织的 skill 临时停用（走与
    // `disable-skill.ts` 同一列 `skills.status`），跑完恢复，后面各条不受影响。
    await asApp(ORG, (c) => c.query(`UPDATE skills SET status = 'disabled' WHERE org_id = $1`, [ORG]));
    let outcome: { result: string; runs: number };
    try {
      outcome = await countedSandboxRuns(async () => {
        const id = await postMessage("帮我写个生成 pptx 的脚本看看", AGENT_BARE);
        await tick();
        return id;
      });
    } finally {
      await asApp(ORG, (c) => c.query(`UPDATE skills SET status = 'enabled' WHERE org_id = $1`, [ORG]));
    }
    const { result: runId, runs } = outcome;

    expect(runs).toBe(0);
    const run = await readRunRow(runId);
    expect(run.status).toBe("succeeded");
    expect(run.model_output_files).toHaveLength(0);
    const [assistant] = await readAssistantBody(runId);
    // 逐字节相同：没有追加任何执行说明、没有失败横幅。
    expect(assistant!.body).toBe(reply);
  }, 120_000);

  it("挂了 skill 但模型这轮只是在说话（没有可执行块）⇒ 沙箱调用计数仍为 0", async () => {
    await mountSkillOnThread();
    const reply = "我可以帮你做演示文稿、写提纲、也能把已有内容重排成三页。你想先从哪一步开始？";
    replyQueue(reply);

    const { result: runId, runs } = await countedSandboxRuns(async () => {
      const id = await postMessage("你都能做什么？");
      await tick();
      return id;
    });

    expect(runs).toBe(0);
    const run = await readRunRow(runId);
    expect(run.model_output_files).toHaveLength(0);
    expect((await readAssistantBody(runId))[0]!.body).toBe(reply);
  }, 120_000);

  /**
   * **T3-CP 反证**：把判据改成恒真，上面两条必红。
   *
   * 一条「沙箱没被调用」的断言，在一个**本来就没东西可执行**的输入上是永远绿的。
   * 所以这里证明那两次输入确实分别带着**可执行块**和**已挂载的 skill**——
   * 也就是说，判据只要少一条，上面就一定有一条会翻。
   */
  it("T3-CP：证明上面两条输入确实各自踩在判据的一条腿上（少一条就会执行）", async () => {
    // 第 ① 条的输入：有可执行块，缺的只是"挂了 skill"。
    expect(replyWithScript({ prose: "这是给你看的示例代码：" })).toContain("```run_script");
    // 第 ② 条的输入：挂了 skill（`mountSkillOnThread` 写了真行），缺的只是可执行块。
    await mountSkillOnThread();
    const mounted = await asApp(ORG, (c) => c.query(
      `SELECT 1 FROM thread_skill_mounts WHERE org_id=$1 AND thread_id=$2 AND removed_at IS NULL`,
      [ORG, THREAD],
    ));
    expect(mounted.rows.length).toBeGreaterThan(0);
  });
});

/* ═══════════════════════════════ T4 ═══════════════════════════════ */

describe("T4 失败诚实：真实 stderr 出现在消息里，不翻译成「请重试」", () => {
  it("脚本恒失败 ⇒ 助手消息带真实 stderr 原文，且不匹配 /请重试|please try again/i", async () => {
    await mountSkillOnThread();
    replyQueue(replyWithScript({ marker: "__LOOPBACK_ALWAYS_FAIL__" }));

    const { result: runId, runs } = await countedSandboxRuns(async () => {
      const id = await postMessage("做个 deck");
      await tick();
      return id;
    });

    // 重试上限 3 次，三次都失败。
    expect(runs).toBe(3);

    const run = await readRunRow(runId);
    // ⚠ 脚本失败**不 fail run**：用户拿到的是一条带着真实失败原因的回复，不是"没人答"。
    expect(run.status).toBe("succeeded");
    expect(run.model_output_files).toHaveLength(0);

    const [assistant] = await readAssistantBody(runId);
    expect(assistant!.body).toContain("SCRIPT_FAILED_AFTER_RETRIES");
    // 真实 stderr 原样出现——#660 / #1611 两次事故的落点。
    expect(assistant!.body).toContain("TypeError: pres.ShapeType is not a function");
    expect(assistant!.body).toContain("at Module._compile");
    expect(assistant!.body).not.toMatch(/请重试|please try again/i);

    // 一条"说了失败"的消息不该同时挂着附件。
    expect(await readAttachments(assistant!.id)).toHaveLength(0);
  }, 120_000);
});

/* ═══════════════════════════════ T5 ═══════════════════════════════ */

describe("T5 回喂重试循环真的在重试", () => {
  it("第 1 次失败、第 2 次成功 ⇒ 确实发生 2 次执行，且第 2 次的模型输入带着第 1 次的真实 stderr", async () => {
    await mountSkillOnThread();
    replyQueue(
      // 第 1 次：带 FAIL_ONCE 标记 ⇒ 沙箱第一次非零退出。
      replyWithScript({ marker: "__LOOPBACK_FAIL_ONCE__", fileName: "Retry_Deck.pptx" }),
      // 第 2 次（回喂后重新生成）：干净脚本。
      replyWithScript({ prose: "抱歉，上一版用错了 API，这是修正版：", fileName: "Retry_Deck.pptx" }),
    );

    const { result: runId, runs } = await countedSandboxRuns(async () => {
      const id = await postMessage("做个 deck");
      await tick();
      return id;
    });

    // ① 确实执行了 2 次——不是第一次就蒙对。
    expect(runs).toBe(2);

    // ② 模型被调了 2 次：第 1 次是这一轮的正常回复，第 2 次才是回喂重生成。
    expect(modelCalls).toHaveLength(2);

    // ③ 第 2 次的输入里带着第 1 次的**真实** stderr，不是一句「上次失败了」。
    const secondCall = JSON.stringify(modelCalls[1]!.body);
    expect(secondCall).toContain("TypeError: pres.ShapeType is not a function");
    expect(secondCall).toContain("exit code 1");
    // 且回喂的确实是沙箱吐出来的那一段，不是测试自己编的字符串。
    expect(LOOPBACK_REAL_STDERR.split("\n").every((line) => secondCall.includes(line.trim())))
      .toBe(true);

    // ④ 第 2 次成功，产物照常一路走到底。
    const run = await readRunRow(runId);
    expect(run.status).toBe("succeeded");
    expect(run.model_output_files).toHaveLength(1);
    const file = run.model_output_files[0]!;
    expect(file.name).toBe("Retry_Deck.pptx");
    expect(inspectPptx(await readBackBytes(file.objectKey)).slideCount).toBe(3);
  }, 120_000);
});
