/**
 * 2026-08-23 —— `POST /canvas/templates/suggestions`：真实浏览器/HTTP → controller →
 * application → 一个**真的**（本地起的）OpenAI 兼容模型服务器，验证「AI 提议分区名」
 * 这条只读端口的三件事：
 *
 * ① 模型正常返回时，响应体过契约 `.strict()` 校验，且**不写库**——`canvas_templates`
 *    表在调用前后行数不变（见用例文件头「为什么不直接写库」）。
 * ② 模型返回解析不出来的东西 / 调用失败，两种失败都映射到同一个
 *    reasonCode（`TEMPLATE_SUGGESTION_UNAVAILABLE`），503。
 * ③ 非管理员被拒（`ROLE_INSUFFICIENT`），与 `createTemplate` 同一个判定函数
 *    （`requireTemplateAdmin`），这里只补一条整合测试，不重复其单测。
 *
 * 起一个真实本地 HTTP 服务器扮演模型 provider，是 `guided-workflow-command.test.ts`
 * 已经用过的做法——让真实的 `ConfiguredModelProvider` 代码路径原样跑一遍，不在应用图里
 * 塞任何 DI 替身。
 */
import { createServer, type Server } from "node:http";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { canvas as C } from "@repo/contracts";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-1798-suggest-sections";
const ADMIN = "u-1798-admin";
const MEMBER = "u-1798-member";

let app: NestExpressApplication;
let base = "";
let modelServer: Server;
let modelBase = "";
let modelMode: "valid" | "malformed" | "http-error" = "valid";
let modelCalls = 0;

const readJson = async (request: import("node:http").IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
};

beforeAll(async () => {
  modelServer = createServer(async (request, response) => {
    modelCalls += 1;
    await readJson(request); // 消费请求体，不校验形状——那是 `ConfiguredModelProvider` 自己的职责
    if (modelMode === "http-error") {
      response.statusCode = 500;
      response.end("upstream on fire");
      return;
    }
    response.setHeader("content-type", "application/json");
    const content = modelMode === "malformed"
      ? "not json at all"
      // 2026-08-25：`TemplateSectionSuggestion.type` 转为必填字段（提示词要求模型
      // 一起给出类型判断），mock 上游同步带上，否则响应解析不出来会误报成
      // `TEMPLATE_SUGGESTION_UNAVAILABLE`——这条 mock 不该测出「契约变了没跟上」
      // 之外的任何东西。
      : JSON.stringify({
        displayName: "商业模式画布",
        sections: [
          { name: "关键合作伙伴", type: "便利贴列表" }, { name: "关键业务", type: "便利贴列表" },
          { name: "价值主张", type: "便利贴列表" }, { name: "客户关系", type: "便利贴列表" },
          { name: "渠道", type: "便利贴列表" }, { name: "客户细分", type: "便利贴列表" },
          { name: "收入来源", type: "便利贴列表" }, { name: "成本结构", type: "便利贴列表" },
          { name: "关键资源", type: "便利贴列表" },
        ],
      });
    response.end(JSON.stringify({
      choices: [{ message: { content } }],
      usage: { total_tokens: 88 },
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
  await resetOrgs(ORG);
  const fixture = await seedOrg({ orgId: ORG, projectId: "proj-1798" });
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

const suggest = (prompt: string, userId = ADMIN) =>
  fetch(`${base}${C.operations.suggestTemplateSections.path}`, {
    method: "POST",
    headers: auth(userId),
    body: JSON.stringify({ prompt }),
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

describe("2026-08-23 · POST /canvas/templates/suggestions", () => {
  it("① 模型正常返回：响应体过契约 strict 校验，且不写库", async () => {
    expect(await templateRowCount()).toBe(0);

    const res = await suggest("商业模式画布");
    expect(res.status).toBe(200);
    expect(modelCalls).toBe(1);

    const parsed = C.operations.suggestTemplateSections.out.parse(await res.json());
    expect(parsed.suggestedDisplayName).toBe("商业模式画布");
    expect(parsed.sections.length).toBe(9);
    expect(parsed.sections.map((s) => s.name)).toContain("价值主张");

    // ⚠ 核心断言：这条端口只读，不落库——真的重新查一遍库，不信响应体。
    expect(await templateRowCount()).toBe(0);
  });

  it("② 模型回了解析不出来的 JSON → 503 + TEMPLATE_SUGGESTION_UNAVAILABLE，且不落库", async () => {
    modelMode = "malformed";
    const res = await suggest("商业模式画布");
    expect(res.status).toBe(503);
    const body = await res.json() as { reasonCode?: unknown };
    expect(body.reasonCode).toBe("TEMPLATE_SUGGESTION_UNAVAILABLE");
    expect(await templateRowCount()).toBe(0);
  });

  it("② 模型调用本身失败（上游 500）→ 同一个 reasonCode，不是两种文案", async () => {
    modelMode = "http-error";
    const res = await suggest("商业模式画布");
    expect(res.status).toBe(503);
    const body = await res.json() as { reasonCode?: unknown };
    expect(body.reasonCode).toBe("TEMPLATE_SUGGESTION_UNAVAILABLE");
  });

  it("③ 非管理员被拒——与 createTemplate 同一个判定函数（ROLE_INSUFFICIENT），且模型没被调用", async () => {
    const res = await suggest("商业模式画布", MEMBER);
    expect(res.status).toBe(403);
    const body = await res.json() as { reasonCode?: unknown };
    expect(body.reasonCode).toBe("ROLE_INSUFFICIENT");
    // 权限判定在模型调用之前——被拒的请求不该花一次模型调用的钱。
    expect(modelCalls).toBe(0);
  });

  it("空 prompt 在契约边界被拒（400），不会走到模型调用", async () => {
    const res = await suggest("");
    expect(res.status).toBe(400);
    expect(modelCalls).toBe(0);
  });
});
