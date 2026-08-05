/**
 * `POST /models` 端到端，**打真实 PostgreSQL**（#548, F48 / uc-20-1, I-6）。
 *
 * 上面那两个文件用假仓储断的是「用例逻辑对不对」。这个文件断的是别的东西：
 * **这条路由真的存在、真的能被打到、凭据真的以密文躺在 `model_secrets` 里**。
 * 「接口返回 201」和「库里真有一行」是两件事——#548 的起因正是十条契约、十四个
 * domain/application 文件全都在，而从进程外面看这个能力等于零。
 *
 * ## 断言与反证
 *
 *   ① 路由可达且落库          —— 反证：库里那行确实是这次请求造的（id 对得上）
 *   ② 凭据以**密文**入库      —— 反证：明文串在整张 model_secrets 里搜不到
 *   ③ 凭据**不在响应里**      —— 反证：同一份响应体里植入凭据，断言必须红
 *   ④ 非 admin ⇒ NOT_ORG_ADMIN，且**不落库**（越权不能留半行）
 *   ⑤ 词表外的合规属性 ⇒ 拒绝，且**不落库**（uc-20-1 E2 不留半截配置）
 *
 * ⚠ ② 读密文用的是 **owner 连接**（`asOwner`）。运行时角色 `app_rw` 在 0019 里
 *   被**列级 GRANT 挡着读不到 `ciphertext`**——那正是本设计要的。测试要证明「存进去的
 *   不是明文」，就必须绕到 owner 才看得见；用 `asApp` 会得到 permission denied，
 *   而那个错误会被误读成「没存」。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { agentRuntime as C } from "@repo/contracts";
import { addOrgMember, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";
// ⚠ `MODEL_CREDENTIAL_KEY` **不在这里设**，由 `vitest.config.ts` 的 `env` 统一下发。
//   缺 key 是**整个 API 的启动失败**（见 cipher 文件头），因此每一个调 `createApp()` 的
//   文件都需要它，不只是本文件。它曾经只在这里设过一次，代价是另外 63 个文件在
//   `NestFactory.create` 里 `process.abort()`，日志上只剩「Worker exited unexpectedly」。

const ORG = "org-548-pool";
const ADMIN = "u-548-admin";
const MEMBER = "u-548-member";

const PLAINTEXT = "sk-live-548-e2e-must-never-be-echoed";
const ENDPOINT = "https://10.0.0.7.internal.invalid/v1";

let app: NestExpressApplication;
let BASE = "";

const principal = (user: string) => ({
  "x-kernel-test-principal": `${user}:${ORG}`,
  "content-type": "application/json",
});

const body = (overrides: Record<string, unknown> = {}) => ({
  kind: "closed-api",
  shape: "single",
  vendor: "OpenAI",
  displayName: "gpt-548-e2e",
  capabilityTags: ["推理"],
  contextWindow: 256_000,
  unitPrice: 0.06,
  complianceAttrs: [],
  credential: PLAINTEXT,
  endpoint: ENDPOINT,
  members: [],
  ...overrides,
});

const postModel = (payload: unknown, user = ADMIN) =>
  fetch(`${BASE}/models`, { method: "POST", headers: principal(user), body: JSON.stringify(payload) });

/** 直接读库。⚠ owner 连接——见文件头。 */
const modelRows = () =>
  asOwner(async (c) => {
    const r = await c.query<{ id: string; status: string; display_name: string }>(
      "SELECT id, status, display_name FROM models WHERE org_id = $1",
      [ORG],
    );
    return r.rows;
  });

const secretRows = () =>
  asOwner(async (c) => {
    const r = await c.query<{ secret_kind: string; ciphertext: string; algorithm: string; key_id: string }>(
      "SELECT secret_kind, ciphertext, algorithm, key_id FROM model_secrets WHERE org_id = $1 ORDER BY secret_kind",
      [ORG],
    );
    return r.rows;
  });

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
  await seedOrg({ orgId: ORG, projectId: "proj-548" });
  await addOrgMember(ORG, ADMIN, "admin", null);
  await addOrgMember(ORG, MEMBER, "consultant", null);
});

describe("① 路由可达，模型真的落库", () => {
  it("201，出参过契约 strict 校验，库里真有那一行", async () => {
    // 前置：这条路由在本分支之前**根本不存在**——空态先钉住，否则下面的断言
    // 在一个「本来就有一行」的库上也会绿。
    expect(await modelRows()).toEqual([]);

    const response = await postModel(body());
    // ⚠ body 只能读一次：第一版把 `await response.text()` 当成断言的 message 传进来，
    //   于是流被消费掉，下面的 `.json()` 当场炸——红在了测试自己身上。
    const rawText = await response.text();
    expect(response.status, rawText).toBe(201);

    const raw = JSON.parse(rawText) as unknown;
    const parsed = C.operations.registerModel.out.safeParse(raw);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(raw)).toBeNull();
    const created = parsed.success ? parsed.data : null!;

    // I-1：刚接入的模型只能是 `待测试`。
    expect(created.status).toBe("待测试");

    // 库里真有，且就是这次请求造的那一行（id 对得上，不是碰巧有行）。
    const rows = await modelRows();
    expect(rows.length).toBe(1);
    expect(rows[0]!.id).toBe(created.modelId);
    expect(rows[0]!.status).toBe("待测试");
    expect(rows[0]!.display_name).toBe("gpt-548-e2e");
  });
});

describe("② 凭据以密文入库，明文在库里搜不到", () => {
  it("credential 与 endpoint 各一行密文，且都不是明文", async () => {
    await postModel(body());

    const secrets = await secretRows();
    expect(secrets.map((s) => s.secret_kind)).toEqual(["credential", "endpoint"]);

    const credential = secrets.find((s) => s.secret_kind === "credential")!;
    expect(credential.algorithm).toBe("aes-256-gcm");
    expect(credential.key_id).toMatch(/^k-[0-9a-f]{8}$/);
    expect(credential.ciphertext).not.toBe(PLAINTEXT);
    // AES-GCM 的自描述布局：iv.tag.body，三段十六进制。
    expect(credential.ciphertext).toMatch(/^[0-9a-f]{24}\.[0-9a-f]{32}\.[0-9a-f]+$/);

    // 反证：明文在**整张表**里都搜不到（不只是这两列）。
    const anywhere = await asOwner(async (c) => {
      const r = await c.query<{ hit: string }>(
        `SELECT model_id AS hit FROM model_secrets
          WHERE org_id = $1 AND (ciphertext LIKE '%' || $2 || '%' OR ciphertext LIKE '%' || $3 || '%')`,
        [ORG, PLAINTEXT, ENDPOINT],
      );
      return r.rows;
    });
    expect(anywhere, "明文原样躺在 model_secrets 里").toEqual([]);
  });

  it("运行时角色 `app_rw` **读不到** ciphertext —— 0019 的列级 GRANT 是活的", async () => {
    await postModel(body());
    // 这条不是锦上添花：I-6 的最后一道防线在数据库，不在 TypeScript。
    const { asApp } = await import("../../support/db");
    await expect(
      asApp(ORG, async (c) => c.query("SELECT ciphertext FROM model_secrets")),
    ).rejects.toThrow(/permission denied|ciphertext/i);
  });
});

describe("③ 凭据不在响应里（AC3 第一个面）", () => {
  it("整个响应体里没有凭据、没有端点、也没有密文", async () => {
    const response = await postModel(body());
    const text = await response.text();

    // 正样本：响应确实非空，否则下面三条在空串上也成立。
    expect(text.length).toBeGreaterThan(10);
    expect(text).toContain("modelId");

    expect(text).not.toContain(PLAINTEXT);
    expect(text).not.toContain(ENDPOINT);
    expect(text).not.toContain("credential");
    expect(text).not.toContain("endpoint");

    // 响应的键**恰好**是契约声明的两个，不是「碰巧没带凭据」。
    expect(Object.keys(JSON.parse(text) as object).sort()).toEqual(["modelId", "status"]);
  });

  it("反证：同一条断言，对一份植入了凭据的响应必须变红", async () => {
    const response = await postModel(body());
    const clean = await response.text();
    // 把真实响应改成「回显凭据」的样子——I-6 被打破时它就长这样。
    const leaked = JSON.stringify({ ...(JSON.parse(clean) as object), credential: PLAINTEXT });

    expect(leaked).toContain(PLAINTEXT); // 正样本
    expect(() => {
      expect(leaked).not.toContain(PLAINTEXT);
    }).toThrow();
  });
});

describe("④ 非管理员被拒，且不留任何行", () => {
  it("consultant ⇒ 403 NOT_ORG_ADMIN，库里零行", async () => {
    const response = await postModel(body(), MEMBER);
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("NOT_ORG_ADMIN");

    expect(await modelRows(), "越权请求留下了一行").toEqual([]);
    expect(await secretRows(), "越权请求留下了一条密文").toEqual([]);
  });
});

describe("⑤ 词表外的合规属性被拒，且不留半截配置（uc-20-1 E2）", () => {
  it("非空 complianceAttrs ⇒ 400 COMPLIANCE_ATTR_UNKNOWN，models 与 model_secrets 都是空的", async () => {
    // O-38：词表来自组织配置，当前为空 ⇒ 只有 `[]` 合法。空词表是**关着的门**，不是通配。
    const response = await postModel(body({ complianceAttrs: ["境内"] }));
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).toContain("COMPLIANCE_ATTR_UNKNOWN");

    // ⚠ **越界的是哪个值，今天到不了调用方**，这里如实断言现状而不是断言愿望。
    //   `AllExceptionsFilter` 的规矩是「唯一放行的异常细节是 `reasonCode`」
    //   （`lint-error-leak`），所以 controller 抛的 `unknown: ["境内"]` 被滤掉了。
    //   而 uc-20-1 要的是「必须指出卡在哪一项」——两者有真实缺口，单独上报，
    //   不在本 PR 里顺手给过滤器开第二个结构化口子（那是一次安全面的设计决定）。
    expect(text, "如果哪天它能过来了，说明过滤器被开了口子——回来重读这段").not.toContain("境内");

    expect(await modelRows(), "被拒的注册留下了模型行").toEqual([]);
    expect(await secretRows(), "被拒的注册留下了密文——半截配置").toEqual([]);
  });
});
