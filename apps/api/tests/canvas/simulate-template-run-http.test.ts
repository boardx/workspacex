/**
 * 2026-08-26 —— `POST /canvas/templates/:key/simulate`：真实浏览器/HTTP → controller →
 * application → 一个**真的**（本地起的）OpenAI 兼容模型服务器，验证「chat 模拟」这条
 * 只读端口的四件事，同 `suggest-template-sections-http.test.ts` 的做法（同一类端口，
 * 同一套证明方式）：
 *
 * ① 模型正常返回时，响应体过契约 `.strict()` 校验，且**不写库**——`canvas_templates`
 *    表在调用前后行数不变，见用例文件头「只读，不产生任何副作用」。
 * ② system 指引真的传了模板结构——mock 上游把收到的 system 原样回显，断言里包含
 *    分区名，证明走的是 `buildCanvasTemplateGuidance` 那条真实链路，不是空指引。
 * ③ 模型调用失败 → 503 + `TEMPLATE_SIMULATION_UNAVAILABLE`。
 * ④ 非管理员被拒（`ROLE_INSUFFICIENT`），与 `createTemplate`/`suggestTemplateSections`
 *    同一个判定函数（`requireTemplateAdmin`），这里只补一条整合测试，不重复其单测。
 */
import { createServer, type Server } from "node:http";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { canvas as C } from "@repo/contracts";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-1799-simulate-run";
const ADMIN = "u-1799-admin";
const MEMBER = "u-1799-member";
const KEY = "tpl-1799-persona";

let app: NestExpressApplication;
let base = "";
let modelServer: Server;
let modelBase = "";
let modelMode: "valid" | "http-error" = "valid";
let modelCalls = 0;
let lastSystem = "";

const readJson = async (request: import("node:http").IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
};

beforeAll(async () => {
  modelServer = createServer(async (request, response) => {
    modelCalls += 1;
    const body = await readJson(request);
    const messages = body.messages as { role: string; content: string }[] | undefined;
    lastSystem = messages?.find((m) => m.role === "system")?.content ?? "";
    if (modelMode === "http-error") {
      response.statusCode = 500;
      response.end("upstream on fire");
      return;
    }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      choices: [{ message: { content: "```canvas\n模板: " + KEY + "\n## 姓名\n张三\n```" } }],
      usage: { total_tokens: 42 },
    }));
  });
  await new Promise<void>((resolve) => modelServer.listen(0, "127.0.0.1", resolve));
  const address = modelServer.address();
  modelBase = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  process.env.KERNEL_MODEL_PROVIDER = "test-qwen";
  process.env.KERNEL_MODEL_BASE_URL = modelBase;
  process.env.KERNEL_MODEL_API_KEY = "test-key";
  process.env.KERNEL_MODEL_TIMEOUT_MS = "2000";

  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const appAddress = app.getHttpServer().address();
  base = `http://127.0.0.1:${typeof appAddress === "object" && appAddress ? appAddress.port : 0}`;
}, 120_000);

afterAll(async () => {
  await app?.close();
  await resetOrgs(ORG);
  await new Promise<void>((resolve, reject) => modelServer.close((error) => (error ? reject(error) : resolve())));
});

beforeEach(async () => {
  modelMode = "valid";
  modelCalls = 0;
  lastSystem = "";
  await resetOrgs(ORG);
  const fixture = await seedOrg({ orgId: ORG, projectId: "proj-1799" });
  await addOrgMember(ORG, ADMIN, "admin", fixture.teams.energy ?? null);
  await addOrgMember(ORG, MEMBER, "consultant", fixture.teams.energy ?? null);
});

afterEach(() => {
  modelMode = "valid";
});

const auth = (userId: string) => ({
  "content-type": "application/json",
  "x-kernel-test-principal": `${userId}:${ORG}`,
});

const SECTIONS = [
  {
    sectionId: "sec-1", name: "姓名", type: "短文本" as const,
    order: 0, required: true, capacity: null, layout: null,
  },
  {
    sectionId: "sec-2", name: "痛点和挑战", type: "便利贴列表" as const,
    order: 1, required: false, capacity: 6, layout: null,
  },
];

const simulate = (prompt: string, userId = ADMIN, pathKey = KEY, bodyKey = pathKey) =>
  fetch(`${base}${C.operations.simulateTemplateRun.path.replace(":key", pathKey)}`, {
    method: "POST",
    headers: auth(userId),
    body: JSON.stringify({ key: bodyKey, prompt, sections: SECTIONS }),
  });

async function templateRowCount(): Promise<number> {
  return asApp(ORG, async (c) => {
    const r = await c.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM canvas_templates WHERE org_id = $1",
      [ORG],
    );
    return Number(r.rows[0]!.count);
  });
}

describe("2026-08-26 · POST /canvas/templates/:key/simulate", () => {
  it("① 模型正常返回：响应体过契约 strict 校验，且不写库", async () => {
    expect(await templateRowCount()).toBe(0);

    const res = await simulate("帮我画一份新用户画像");
    expect(res.status).toBe(200);
    expect(modelCalls).toBe(1);

    const parsed = C.operations.simulateTemplateRun.out.parse(await res.json());
    expect(parsed.text).toContain("```canvas");
    expect(parsed.modelId).toBe("qwen3.7-plus");

    // ⚠ 核心断言：这条端口只读，不落库——真的重新查一遍库，不信响应体。
    expect(await templateRowCount()).toBe(0);
  });

  it("② system 指引真的带上了传入的分区结构——走的是真实 chat 生成同一条链路", async () => {
    await simulate("帮我画一份新用户画像");
    expect(lastSystem).toContain("姓名");
    expect(lastSystem).toContain("痛点和挑战");
  });

  it("③ 模型调用本身失败（上游 500）→ 503 + TEMPLATE_SIMULATION_UNAVAILABLE，且不落库", async () => {
    modelMode = "http-error";
    const res = await simulate("帮我画一份新用户画像");
    expect(res.status).toBe(503);
    const body = await res.json() as { reasonCode?: unknown };
    expect(body.reasonCode).toBe("TEMPLATE_SIMULATION_UNAVAILABLE");
    expect(await templateRowCount()).toBe(0);
  });

  it("④ 非管理员被拒——与 suggestTemplateSections 同一个判定函数（ROLE_INSUFFICIENT），且模型没被调用", async () => {
    const res = await simulate("帮我画一份新用户画像", MEMBER);
    expect(res.status).toBe(403);
    const body = await res.json() as { reasonCode?: unknown };
    expect(body.reasonCode).toBe("ROLE_INSUFFICIENT");
    expect(modelCalls).toBe(0);
  });

  it("空 prompt 在契约边界被拒（400），不会走到模型调用", async () => {
    const res = await simulate("");
    expect(res.status).toBe(400);
    expect(modelCalls).toBe(0);
  });

  it("路径 key 与 body key 不一致 → 400，不静默挑一个", async () => {
    const res = await simulate("帮我画一份新用户画像", ADMIN, KEY, "other-key");
    expect(res.status).toBe(400);
    expect(modelCalls).toBe(0);
  });
});
