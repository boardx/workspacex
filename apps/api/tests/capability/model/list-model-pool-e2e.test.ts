/**
 * `GET /models` 端到端，打真实 PostgreSQL（#1381，收口 `POOL_LISTING_GAP`）。
 *
 * 同 `register-model-e2e.test.ts` 的纪律：断的是「这条路由真的存在、真的能被打到」，
 * 不是「用例逻辑对不对」（那是 `application/model/list-model-pool.ts` 自己的事）。
 *
 * ## 断言与反证
 *
 *   ① 空池组织 ⇒ `[]`（真实空态，不是造出来的默认值）
 *   ② 接入一个模型后能读到它，字段与 `registerModel` 提交的一致，且带 `credentialConfigured`
 *   ③ 凭据 / 端点密文**不在**响应体里，即使已经接入了一个真凭据
 *   ④ 非 admin ⇒ 403 NOT_ORG_ADMIN
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { agentRuntime as C } from "@repo/contracts";
import { addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";
// ⚠ `MODEL_CREDENTIAL_KEY` 不在这里设，由 `vitest.config.ts` 统一下发（见 register-model-e2e 文件头）。

const ORG = "org-1381-pool";
const ADMIN = "u-1381-admin";
const MEMBER = "u-1381-member";

const PLAINTEXT = "sk-live-1381-e2e-must-never-be-echoed";
const ENDPOINT = "https://10.0.0.9.internal.invalid/v1";

let app: NestExpressApplication;
let BASE = "";

const principal = (user: string) => ({
  "x-kernel-test-principal": `${user}:${ORG}`,
  "content-type": "application/json",
});

const registerBody = (overrides: Record<string, unknown> = {}) => ({
  kind: "self-hosted",
  shape: "single",
  vendor: "本地部署 · 1381",
  displayName: "qwen-1381-e2e",
  capabilityTags: ["文本生成"],
  contextWindow: 32_000,
  unitPrice: 0,
  complianceAttrs: [],
  credential: PLAINTEXT,
  endpoint: ENDPOINT,
  members: [],
  ...overrides,
});

const postModel = (payload: unknown, user = ADMIN) =>
  fetch(`${BASE}/models`, { method: "POST", headers: principal(user), body: JSON.stringify(payload) });

const getModels = (user = ADMIN) => fetch(`${BASE}/models`, { headers: principal(user) });

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 180_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: "proj-1381" });
  await addOrgMember(ORG, ADMIN, "admin", null);
  await addOrgMember(ORG, MEMBER, "consultant", null);
});

describe("① 空池组织", () => {
  it("返回 `[]`，不是默认清单", async () => {
    const response = await getModels();
    const text = await response.text();
    expect(response.status, text).toBe(200);
    expect(JSON.parse(text)).toEqual([]);
  });
});

describe("② 接入后能读到，字段与提交的一致", () => {
  it("kind / vendor / displayName / capabilityTags / contextWindow / unitPrice / status / credentialConfigured 都对得上", async () => {
    const created = await postModel(registerBody());
    const createdOut = C.operations.registerModel.out.parse(await created.json());

    const response = await getModels();
    const raw = (await response.json()) as unknown[];
    expect(response.status).toBe(200);

    const parsed = C.operations.listModelPool.out.safeParse(raw);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(raw)).toBeNull();
    const rows = parsed.success ? parsed.data : [];
    expect(rows.length).toBe(1);

    const row = rows[0]!;
    expect(row.modelId).toBe(createdOut.modelId);
    expect(row.status).toBe("待测试");
    expect(row.kind).toBe("self-hosted");
    expect(row.vendor).toBe("本地部署 · 1381");
    expect(row.displayName).toBe("qwen-1381-e2e");
    expect(row.capabilityTags).toEqual(["文本生成"]);
    expect(row.contextWindow).toBe(32_000);
    expect(row.unitPrice).toBe(0);
    expect(row.credentialConfigured).toBe(true);
  });
});

describe("③ 凭据不在响应里，即使已经接入了一个真凭据", () => {
  it("整个响应体里没有明文、没有密文、没有 `credential`/`endpoint` 键", async () => {
    await postModel(registerBody());
    const response = await getModels();
    const text = await response.text();

    expect(text.length).toBeGreaterThan(10);
    expect(text).toContain("credentialConfigured");

    expect(text).not.toContain(PLAINTEXT);
    expect(text).not.toContain(ENDPOINT);
    expect(text).not.toContain('"credential"');
    expect(text).not.toContain('"endpoint"');
  });
});

describe("④ 非管理员被拒", () => {
  it("consultant ⇒ 403 NOT_ORG_ADMIN", async () => {
    await postModel(registerBody());
    const response = await getModels(MEMBER);
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("NOT_ORG_ADMIN");
  });
});
