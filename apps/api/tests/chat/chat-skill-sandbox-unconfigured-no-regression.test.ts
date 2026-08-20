/**
 * #1652 T2 —— **没配沙箱的部署，chat 行为与接沙箱之前逐字节相同**。
 *
 * ## 这一格是"新增能力不破坏既有 chat"的唯一机械保证
 *
 * #1624 给 chat 加了一条「模型写脚本 → 真的执行 → 产物挂附件」的路径。这条路径的
 * 每一格断言都在证明它**能**工作。没有任何一格在证明：**在它没被启用的部署上，
 * 用户看到的东西一个字都没变**。而后者才是绝大多数部署当下的处境——本仓的 compose
 * 默认只起 Postgres，沙箱容器是可选件。
 *
 * `run-skill-script.ts` 的头注把这条写成「`deps.sandbox` 不注入 ⇒ 这条路径整段不存在」，
 * `execute-run.ts` 里连 system prompt 的追加也挂在**同一个前提**上。这支测试问的是
 * 合成层的问题：`kernel.module.ts` 在**沙箱地址一个都没配**的时候，到底有没有让那个
 * 前提为假。
 *
 * ⚠ 这不是理论洁癖。若前提恒真，一个没接沙箱的部署会出现这条链：
 *   system prompt 里多出执行协议 → 模型据此吐出 `run_script` 块 → 上层去执行 →
 *   `HttpSkillSandbox` 因为没有地址而抛 `SANDBOX_UNAVAILABLE` → 用户本来好好的一条
 *   回复被追加上一段失败横幅。**这条回归只有走真栈才看得见**：应用层的单元测试
 *   自己决定注不注入 `sandbox`，它永远测不到 `kernel.module.ts` 注入了什么。
 *
 * ## 为什么单独一个文件
 *
 * 沙箱地址是在 DI provider 的 `useFactory` 里读的，进程内只解析一次。同一个文件里
 * 既要"配了"又要"没配"，就得起两个 Nest app 并让 env 在它们之间变——那是在赌
 * 构造顺序。vitest 一个文件一个进程，分开写才是确定的。
 */
import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatThread } from "../support/chat-db";
import {
  AGENT_RUN_EXECUTOR, type AgentRunExecutorPort,
} from "../../src/application/agent-run/ports";
import { RUN_SCRIPT_PROTOCOL_PROMPT } from "../../src/application/skill/run-script-with-retries";
import { toOrgId } from "../../src/domain/org-id";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-i1652-nosandbox";
const PROJECT = "proj-i1652-nosandbox";
const THREAD = "thread-i1652-nosandbox";
const ACTOR = "u-i1652-nosandbox";
const PROVIDER = "i1652-nosandbox-loopback";
const MODEL = "i1652-model";
const AGENT = "agent-i1652-nosandbox";
const AGENT_V1 = "agent-version-i1652-nosandbox-v1";
const SKILL = "skill-i1652-nosandbox";
const SKILL_V1 = "skill-version-i1652-nosandbox-v1";

const sha256 = (v: string): string => createHash("sha256").update(v).digest("hex");

/**
 * 模型的回复里**故意**带一个可执行块。
 *
 * 这是本文件唯一能把回归逼出来的输入形状：如果合成层错误地启用了执行路径，
 * 正是这样一段回复会被拿去执行、然后带回一段 `SANDBOX_UNAVAILABLE` 横幅。
 * 用一段没有代码块的散文当输入，这支测试会在任何实现下都绿。
 */
const REPLY_WITH_SCRIPT = [
  "当然可以。用 pptxgenjs 大概是这样写：",
  "",
  "```run_script",
  "const PptxGenJS = require('pptxgenjs');",
  "const pres = new PptxGenJS();",
  "pres.addSlide().addText('未配沙箱的部署也该原样看到这段', { x: 0.5, y: 0.5 });",
  "pres.writeFile({ fileName: 'demo.pptx' });",
  "```",
  "",
  "把它跑起来就能拿到文件。",
].join("\n");

let modelServer: Server;
let modelBase = "";
let modelCalls: { system: string }[] = [];

async function startModelStub(): Promise<void> {
  modelServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          messages?: { role: string; content: string }[];
        };
        const system = (body.messages ?? []).filter((m) => m.role === "system")
          .map((m) => m.content).join("\n");
        modelCalls.push({ system });
      } catch { modelCalls.push({ system: "" }); }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        choices: [{ message: { role: "assistant", content: REPLY_WITH_SCRIPT } }],
      }));
    });
  });
  await new Promise<void>((resolve) => modelServer.listen(0, "127.0.0.1", resolve));
  modelBase = `http://127.0.0.1:${String((modelServer.address() as AddressInfo).port)}`;
}

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

async function seedAgent(): Promise<void> {
  const instructions = "You are the no-sandbox deployment agent.";
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
       VALUES ($1,$2,$3,'v1',$4,$5,'{}'::text[],$6,$7,'[]'::jsonb,$8,now(),now())`,
      [AGENT_V1, ORG, AGENT, sha256(instructions), instructions, PROVIDER, MODEL, ACTOR],
    );
    await c.query("UPDATE agents SET published_version_id=$1 WHERE id=$2 AND org_id=$3",
      [AGENT_V1, AGENT, ORG]);
  });
}

async function mountSkillOnThread(): Promise<void> {
  await asApp(ORG, (c) => c.query(
    `INSERT INTO thread_skill_mounts
       (mount_id, org_id, thread_id, skill_id, version_id, mounted_at, removed_at)
     VALUES ($1,$2,$3,$4,$5,now(),NULL)`,
    [`mount-i1652-ns-${randomUUID()}`, ORG, THREAD, SKILL, SKILL_V1],
  ));
}

let app: NestExpressApplication;
let BASE = "";

const tick = () => app.get<AgentRunExecutorPort>(AGENT_RUN_EXECUTOR).tick(toOrgId(ORG));

async function postMessage(text: string): Promise<string> {
  const response = await fetch(`${BASE}/chat/threads/${THREAD}/messages`, {
    method: "POST",
    headers: {
      "x-kernel-test-principal": `${ACTOR}:${ORG}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ clientMessageId: randomUUID(), text, agentId: AGENT }),
  });
  expect(response.status, await response.clone().text()).toBe(202);
  return (await response.json() as { agentRunId: string }).agentRunId;
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await startModelStub();

  process.env.KERNEL_MODEL_PROVIDER = PROVIDER;
  process.env.KERNEL_MODEL_BASE_URL = modelBase;
  process.env.KERNEL_MODEL_API_KEY = "sk-i1652-nosandbox";
  process.env.KERNEL_AGENT_RUN_AUTOSTART = "0";
  // ⚠ 本文件的**全部**主张都建立在这两个地址一个都没配上。显式删掉而不是"假设没人设过"：
  //   一个从别处泄漏进来的地址会让这支测试在一个已启用沙箱的部署上悄悄绿。
  delete process.env.KERNEL_SKILL_SANDBOX_BASE_URL;
  delete process.env.KERNEL_SKILL_SANDBOX_SOCKET;

  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  BASE = `http://127.0.0.1:${String((app.getHttpServer().address() as AddressInfo).port)}`;
}, 180_000);

afterAll(async () => {
  await app?.close();
  await new Promise<void>((resolve) => modelServer.close(() => resolve()));
});

beforeEach(async () => {
  modelCalls = [];
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ACTOR, "consultant", fx.teams.energy ?? null);
  await addProjectMember(ORG, PROJECT, ACTOR, "facilitator", null);
  await addChatThread({
    orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: ACTOR,
  });
  await seedSkillVersion();
  await seedAgent();
});

describe("T2 沙箱地址一个都没配 ⇒ chat 行为与接沙箱之前逐字节相同", () => {
  it("挂了 skill、模型也吐出了可执行块，仍然：不执行、不报错、正文一个字不变", async () => {
    await mountSkillOnThread();

    const runId = await postMessage("帮我做个 deck");
    await tick();

    const run = await asApp(ORG, (c) => c.query<{
      status: string;
      skill_version_ids: readonly string[];
      model_output_files: readonly unknown[];
    }>(
      `SELECT status, skill_version_ids, model_output_files
         FROM agent_runs WHERE org_id=$1 AND id=$2`, [ORG, runId],
    )).then((r) => r.rows[0]!);

    // 前提：这一轮**确实**挂着 skill。否则"没执行"是因为没挂，不是因为没配沙箱，
    // 这条测试就在证明一件与它主张无关的事。
    expect(run.skill_version_ids).toContain(SKILL_V1);
    expect(run.status).toBe("succeeded");
    expect(run.model_output_files).toHaveLength(0);

    const assistant = await asApp(ORG, (c) => c.query<{ id: string; body: string }>(
      `SELECT id, body FROM chat_messages
        WHERE org_id=$1 AND agent_run_id=$2 AND author_kind='agent'`, [ORG, runId],
    )).then((r) => r.rows);
    expect(assistant).toHaveLength(1);

    // ① 正文**逐字节**等于模型原文：既没有成功追加段，也没有失败横幅。
    expect(assistant[0]!.body).toBe(REPLY_WITH_SCRIPT);
    // ② 说清楚失败横幅长什么样，这样这条断言翻掉时能一眼看出是哪种回归。
    expect(assistant[0]!.body).not.toContain("SANDBOX_UNAVAILABLE");
    expect(assistant[0]!.body).not.toContain("脚本执行失败");
    expect(assistant[0]!.body).not.toContain("已在沙箱中执行");

    // ③ 没有附件。
    const attachments = await asApp(ORG, (c) => c.query(
      `SELECT 1 FROM chat_message_attachments WHERE org_id=$1 AND message_id=$2`,
      [ORG, assistant[0]!.id],
    ));
    expect(attachments.rows).toHaveLength(0);

    // ④ 连 **system prompt** 都一个字没多——执行协议那一段挂在同一个前提上。
    //    少了这条，一个"提示词照加、只是不执行"的实现会在上面三条下全绿，
    //    而它已经在改变模型的行为（模型会开始承诺自己能产出文件）。
    expect(modelCalls.length).toBeGreaterThan(0);
    expect(modelCalls[0]!.system).not.toContain(RUN_SCRIPT_PROTOCOL_PROMPT);
    expect(modelCalls[0]!.system).not.toContain("You can execute Node.js code in a sandbox");
  }, 120_000);
});
