/**
 * #595 —— **验收第 4 条，端到端**：URL 导入的 skill 出现在一次真实的 chat 调用里。
 *
 * ## 为什么这个文件必须存在
 *
 * 交接与后续勘探反复写明：「至今没有任何 skill 从浏览器被导入过，`/chat` 里也从未
 * 验证过调用」。段 2（URL 导入 controller，PR #606）与 A2（本文件的 pin 写路径）
 * 各自的单元/集成测试都只证明"自己那一层正确"——**没有一条测过接起来会不会通**。
 * 本文件走完整条链：
 *
 *   `POST /admin/skills/url-imports`（真实取回，loopback 服务器）
 *     → `POST /admin/agents/:agentId/skill-pins`
 *     → `POST /chat/threads/:threadId/messages`
 *     → `AgentRunExecutorPort.tick()`（同 #414/#413 既有测试用的同一个执行器）
 *     → 断言**发给模型的 system prompt 字面包含 URL 导入的那份内容**。
 *
 * ⚠ 最后一步是关键：不是断言"run 成功了"（成功了也可能没读到 skill），
 *   而是断言**送到模型那一侧的字节里，确实有 URL 导入进来的那段文字**——
 *   这是唯一能把"导入的内容"和"被调用"这两个词真正连起来的断言。
 *
 * ## 复用而不是重造
 *
 * 模型侧的 loopback 服务器、`tick()` 触发、`readRun` 轮询逻辑全部照抄
 * `no-tool-run-writeback.test.ts` 的既有装置——那套装置已经证明能驱动一次真实调用，
 * 本文件不重新发明,只换"skill 从哪来"这一段。
 *
 * ## ⚠ 第①步走用例层（DNS 打桩），不是 HTTP——理由是**生产装配没有 DNS 接缝**
 *
 * `url-import-composition.ts` 的同一性断言（`url-import-binding-guard.test.ts`）钉死了
 * 生产只能绑 `fetchImportSource` 本身，**不能**在生产路径上开一个"测试可以换 DNS"的口子——
 * 那样的口子本身就是下一次 SSRF 绕过。⇒ 从 HTTP controller 打进来的请求，DNS 解析不出
 * `allowed.example` 就是真的走不通（`url-import-http-route.test.ts` 已经验过 HTTP 层的
 * 授权/SSRF/契约校验，走的是**回放**路径，不需要真解析）。
 *
 * 本文件要证的是**下一段链路**（skill → pin → chat），不是重新证一遍"HTTP 导入能连网"。
 * 所以第①步复用 `url-import-persists-real-db.test.ts` 已经验证过的手法：直接调用例层
 * `importSkillFromUrl`（DNS 打桩到 loopback），产出真实落库、真实发布的 skill 版本；
 * 第③④⑤步（pin / 发消息 / 驱动执行）**全部走真实 HTTP**，因为那才是本文件新增的证明面。
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentRuntime as AR } from "@repo/contracts";
import { addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addChatThread } from "../support/chat-db";
import { AGENT_RUN_EXECUTOR, type AgentRunExecutorPort } from "../../src/application/agent-run/ports";
import { toOrgId } from "../../src/domain/org-id";
import { testTlsMaterial } from "../support/tls";
import { fetchImportSource, type ImportFetchSeams } from "../../src/infrastructure/skill/http-import-fetcher";
import { importSkillFromUrl, type ImportSourceFetcher } from "../../src/application/skill-import/import-skill-from-url";
import { PgSkillUrlImportRepository } from "../../src/infrastructure/skill/pg-skill-url-import-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-i595-e2e-loop";
const PROJECT = "proj-i595-e2e-loop";
const THREAD = "thread-i595-e2e-loop";
const ADMIN = "u-i595-e2e-admin";

const MODEL_PROVIDER = "wave2-loopback";
const API_KEY = "sk-i595-e2e-do-not-echo";

/** URL 导入源里真实写的一句话——之后要在模型收到的字节里逐字找它。 */
const IMPORTED_SKILL_MARKER = "第595号验收哨兵：来自浏览器URL导入的内容";
const IMPORTED_SKILL_BODY = `# Imported via URL\n\n${IMPORTED_SKILL_MARKER}\n`;

let importSourceServer: https.Server;
let importSourcePort = 0;
let savedCa: unknown;

let modelServer: Server;
let modelBase = "";
let capturedModelBodies: unknown[] = [];

let app: NestExpressApplication;
let BASE = "";

async function startImportSourceServer(): Promise<void> {
  const { cert, key } = testTlsMaterial();
  importSourceServer = https.createServer({ key, cert }, (_req, res) => {
    res.writeHead(200, { "content-type": "text/markdown" });
    res.end(IMPORTED_SKILL_BODY);
  });
  await new Promise<void>((resolve) => importSourceServer.listen(0, "127.0.0.1", resolve));
  importSourcePort = (importSourceServer.address() as AddressInfo).port;
  savedCa = https.globalAgent.options.ca;
  https.globalAgent.options.ca = [cert];
}

async function startModelServer(): Promise<void> {
  modelServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      try {
        capturedModelBodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        capturedModelBodies.push({});
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ack" } }] }));
    });
  });
  await new Promise<void>((resolve) => modelServer.listen(0, "127.0.0.1", resolve));
  modelBase = `http://127.0.0.1:${(modelServer.address() as AddressInfo).port}`;
}

const principal = (user: string, org: string) => ({
  "x-kernel-test-principal": `${user}:${org}`,
  "content-type": "application/json",
});

function resolveTo(address: string): ImportFetchSeams["lookup"] {
  const fn = (_h: string, o: { all?: boolean } | undefined, cb: Function): void =>
    o?.all === true ? cb(null, [{ address, family: 4 }]) : cb(null, address, 4);
  return fn as unknown as ImportFetchSeams["lookup"];
}

/** 生产取回层，只换 DNS——与 `url-import-persists-real-db.test.ts` 同一手法。 */
const loopbackFetcher: ImportSourceFetcher = (rawUrl, policy) =>
  fetchImportSource(rawUrl, policy, { lookup: resolveTo("127.0.0.1"), checkAddress: () => {} });

const tick = () => app.get<AgentRunExecutorPort>(AGENT_RUN_EXECUTOR).tick(toOrgId(ORG));

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await startImportSourceServer();
  await startModelServer();
  process.env.KERNEL_MODEL_PROVIDER = MODEL_PROVIDER;
  process.env.KERNEL_MODEL_BASE_URL = modelBase;
  process.env.KERNEL_MODEL_API_KEY = API_KEY;
  process.env.KERNEL_AGENT_RUN_AUTOSTART = "0";

  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 180_000);

afterAll(async () => {
  https.globalAgent.options.ca = savedCa as never;
  await app?.close();
  await new Promise<void>((resolve) => importSourceServer.close(() => resolve()));
  await new Promise<void>((resolve) => modelServer.close(() => resolve()));
});

describe("验收第 4 条：URL 导入 → pin → chat 调用，端到端真的通", () => {
  it("URL 导入的 skill 内容，逐字出现在模型收到的 system prompt 里", async () => {
    await resetOrgs(ORG);
    const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
    await addOrgMember(ORG, ADMIN, "admin", fx.teams.energy ?? null);
    await addProjectMember(ORG, PROJECT, ADMIN, "facilitator", null);
    await addChatThread({
      orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: ADMIN,
    });
    capturedModelBodies = [];

    /* ── ① 走用例层把 skill 从"URL"真实导进来（DNS 打桩到 loopback，见文件头说明）── */
    const imported = await importSkillFromUrl(
      {
        orgId: ORG,
        actorId: ADMIN,
        sourceUrl: `https://allowed.example:${importSourcePort}/SKILL.md`,
        name: "验收哨兵 skill",
        idempotencyKey: `idem-${randomUUID()}`,
      },
      {
        identities: { findOrgMembership: async () => ({ orgRole: "admin" }) } as never,
        fetch: loopbackFetcher,
        repository: new PgSkillUrlImportRepository(new PgDatabase(appConfig())),
        policy: { localOnlyOrg: false },
      },
    );
    expect(imported.versionId).toBeTruthy();
    expect(imported.filePaths).toEqual(["SKILL.md"]);

    /* ── ② 通过 HTTP 建一个可发布的基线 agent（starter-pack 之外唯一可行的创建路径
     *     仍未实现——这里直接建库是承认这一点，不是绕过它；pin 那一步才是本测试的
     *     断言目标，agent 本身的创建路径不在本 issue 范围内）。 ── */
    const agentId = `agent-i595-e2e-${randomUUID()}`;
    const baselineVersionId = `agent-version-i595-e2e-${randomUUID()}`;
    await asApp(ORG, async (c) => {
      await c.query(
        `INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
         VALUES ($1,$2,$3,$4,'enabled',$5,now(),now())`,
        [agentId, ORG, agentId, "验收哨兵 agent", ADMIN],
      );
      const instructions = "You are the #595 acceptance sentinel agent.";
      await c.query(
        `INSERT INTO agent_versions
           (id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,
            model_provider,model_id,tool_policy,creator_id,created_at,published_at)
         VALUES ($1,$2,$3,'v1',$4,$5,'{}'::text[],$6,'sentinel-model','[]'::jsonb,$7,now(),now())`,
        [baselineVersionId, ORG, agentId, createHash("sha256").update(instructions).digest("hex"),
          instructions, MODEL_PROVIDER, ADMIN],
      );
      await c.query("UPDATE agents SET published_version_id=$1 WHERE id=$2 AND org_id=$3",
        [baselineVersionId, agentId, ORG]);
    });

    /* ── ③ 通过 HTTP pin：这才是本 issue 真正新增的写入点 ── */
    const pinResponse = await fetch(`${BASE}/admin/agents/${agentId}/skill-pins`, {
      method: "POST",
      headers: principal(ADMIN, ORG),
      body: JSON.stringify({
        agentId,
        skillVersionIds: [imported.versionId],
        expectedVersion: baselineVersionId,
      }),
    });
    expect(pinResponse.status).toBe(201);
    const pinned = AR.operations.setAgentSkillPins.out.parse(await pinResponse.json());
    expect(pinned.skillVersionIds).toEqual([imported.versionId]);

    /* ── ④ 通过 HTTP 发一条真实的 chat 消息给这个 agent ── */
    const messageResponse = await fetch(`${BASE}/chat/threads/${THREAD}/messages`, {
      method: "POST",
      headers: principal(ADMIN, ORG),
      body: JSON.stringify({
        clientMessageId: randomUUID(),
        text: "请确认你能看到验收哨兵 skill",
        agentId,
      }),
    });
    expect(messageResponse.status).toBe(202);
    const { agentRunId } = (await messageResponse.json()) as { agentRunId: string };

    /* ── ⑤ 驱动同一个生产执行器跑完这次 run ── */
    await tick();

    const runView = await fetch(`${BASE}/agent-runs/${agentRunId}`, { headers: principal(ADMIN, ORG) });
    const run = (await runView.json()) as { status: string };
    expect(run.status).toBe("succeeded");

    /* ── ⑥ 核心断言：模型收到的字节里，逐字有 URL 导入的那句话 ── */
    expect(capturedModelBodies).toHaveLength(1);
    const sentText = JSON.stringify(capturedModelBodies[0]);
    expect(sentText).toContain(IMPORTED_SKILL_MARKER);
  });

  /**
   * 反证（结构性，非破坏式）：如果 pin 这一步被跳过——即验收第 4 条描述的
   * "断口二"仍然存在——上面那条断言会红在哪？
   *
   * ⚠ 这条不是"改代码制造红"，而是**证明断言确实盯着 pin 这一步**：
   *   不调用 pin 接口，agent 的 `skill_version_ids` 就还是空数组，
   *   run 应当照常 succeeded（没有 skill 不是错误），但模型收到的内容里
   *   **不会**出现导入的那句话。少了这条，⑥ 那句 `toContain` 有可能因为
   *   别的原因（例如巧合子串）而通过，读者无法确认它真的在测"pin 生效"。
   */
  it("对照：不 pin，同一条消息发给同一个（未 pin 过的）agent，模型收到的内容里没有那句话", async () => {
    await resetOrgs(ORG);
    const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
    await addOrgMember(ORG, ADMIN, "admin", fx.teams.energy ?? null);
    await addProjectMember(ORG, PROJECT, ADMIN, "facilitator", null);
    await addChatThread({
      orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: ADMIN,
    });
    capturedModelBodies = [];

    const agentId = `agent-i595-e2e-nopins-${randomUUID()}`;
    const versionId = `agent-version-i595-e2e-nopins-${randomUUID()}`;
    await asApp(ORG, async (c) => {
      await c.query(
        `INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
         VALUES ($1,$2,$3,$4,'enabled',$5,now(),now())`,
        [agentId, ORG, agentId, "对照组 agent", ADMIN],
      );
      const instructions = "You are the #595 control-group agent (no skills pinned).";
      await c.query(
        `INSERT INTO agent_versions
           (id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,
            model_provider,model_id,tool_policy,creator_id,created_at,published_at)
         VALUES ($1,$2,$3,'v1',$4,$5,'{}'::text[],$6,'sentinel-model','[]'::jsonb,$7,now(),now())`,
        [versionId, ORG, agentId, createHash("sha256").update(instructions).digest("hex"),
          instructions, MODEL_PROVIDER, ADMIN],
      );
      await c.query("UPDATE agents SET published_version_id=$1 WHERE id=$2 AND org_id=$3",
        [versionId, agentId, ORG]);
    });

    const messageResponse = await fetch(`${BASE}/chat/threads/${THREAD}/messages`, {
      method: "POST",
      headers: principal(ADMIN, ORG),
      body: JSON.stringify({ clientMessageId: randomUUID(), text: "hello", agentId }),
    });
    expect(messageResponse.status).toBe(202);
    const { agentRunId } = (await messageResponse.json()) as { agentRunId: string };
    await tick();

    const runView = await fetch(`${BASE}/agent-runs/${agentRunId}`, { headers: principal(ADMIN, ORG) });
    const run = (await runView.json()) as { status: string };
    expect(run.status).toBe("succeeded");

    expect(capturedModelBodies).toHaveLength(1);
    expect(JSON.stringify(capturedModelBodies[0])).not.toContain(IMPORTED_SKILL_MARKER);
  });
});
