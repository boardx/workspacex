/**
 * F112 —— I-31：批准卡的模型标识、单价与折算金额恒来自 model registry，
 * 本模块不存在硬编码的模型名或价目表（chat 束 domain.md E 组）。
 *
 * ## 两条断言
 *
 * 1. **动态**：改 registry 里的单价，同一动作的批准卡金额随之变化——不是读一次就
 *    缓存、也不是从别处的常量表算出来的。
 * 2. **静态**：`domain/chat/approval-gate.ts`（价格/策略判定的落点）源码里不出现
 *    任何模型型号字面量或货币单价常量——`I-31` 的字面「本模块不存在硬编码」这句话
 *    只能由读源码文本来验证，运行时断言证明不了"没有第二条硬编码路径"。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import {
  addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatThread } from "../support/chat-db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f112-registrybudget";
const PROJECT = "proj-f112-registrybudget";
const THREAD = "f112-t-registrybudget";
const MODEL = "f112-model-registry-priced";

let BASE: string;
let app: NestExpressApplication;

const as = (userId: string) => ({
  "x-kernel-test-principal": `${userId}:${ORG}`,
  "content-type": "application/json",
});

async function insertModel(unitPrice: number) {
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO models
         (id, org_id, kind, shape, vendor, display_name, capability_tags, context_window,
          unit_price, compliance_attrs, status)
       VALUES ($1,$2,'self-hosted','single','acme','registry-priced','{}',8000,$3,'{}','已启用')`,
      [MODEL, ORG, unitPrice],
    ),
  );
}

async function setUnitPrice(unitPrice: number) {
  await asApp(ORG, (c) =>
    c.query("UPDATE models SET unit_price = $1 WHERE id = $2 AND org_id = $3", [
      unitPrice, MODEL, ORG,
    ]),
  );
}

async function createApprovalRequest() {
  const r = await fetch(`${BASE}/chat/threads/${THREAD}/approval-requests`, {
    method: "POST",
    headers: as("u-fac"),
    body: JSON.stringify({
      threadId: THREAD,
      agentId: "ledger",
      action: "按 registry 单价折算预算",
      dataScope: [{ name: "项目库", confidential: false }],
      proposedModels: [MODEL],
      estimatedTokens: 10_000,
    }),
  });
  return { status: r.status, body: (await r.json()) as { budget: { amount: number; currency: string } } };
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 180_000);

afterAll(async () => {
  await app?.close();
  await resetOrgs(ORG);
});

beforeAll(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, "u-fac", "consultant", null);
  await addProjectMember(ORG, PROJECT, "u-fac", "facilitator", null);
  await addChatThread({
    orgId: ORG, id: THREAD, projectId: PROJECT, groupId: null,
    visibilityScope: "plenary", createdBy: "u-fac", title: "registry 供数",
  });
}, 60_000);

describe("I-31（动态）：批准卡金额随 registry 单价变化", () => {
  it("单价 10 → 金额 100；改单价为 25 后再发起 → 金额 250", async () => {
    await insertModel(10);
    const first = await createApprovalRequest();
    expect(first.status).toBe(200);
    expect(first.body.budget.amount).toBe(100); // 10_000 / 1000 * 10
    expect(first.body.budget.currency.length).toBeGreaterThan(0);

    await setUnitPrice(25);
    const second = await createApprovalRequest();
    expect(second.status).toBe(200);
    expect(second.body.budget.amount).toBe(250); // 10_000 / 1000 * 25
    expect(second.body.budget.amount).not.toBe(first.body.budget.amount);
  });

  it("请求了一个 registry 里不存在的模型 id → REGISTRY_UNAVAILABLE，不出卡（不回落硬编码价目）", async () => {
    const r = await fetch(`${BASE}/chat/threads/${THREAD}/approval-requests`, {
      method: "POST",
      headers: as("u-fac"),
      body: JSON.stringify({
        threadId: THREAD,
        agentId: "ledger",
        action: "引用一个不存在的模型",
        dataScope: [{ name: "项目库", confidential: false }],
        proposedModels: ["no-such-model-in-registry"],
        estimatedTokens: 1000,
      }),
    });
    const body = (await r.json()) as { reasonCode?: string };
    expect(r.status).toBe(422);
    expect(body.reasonCode).toBe("REGISTRY_UNAVAILABLE");
  });
});

describe("I-31（静态）：判定与折算模块源码里没有硬编码的模型名或价目", () => {
  it("approval-gate.ts 不包含已知的模型/厂商名字面量，也不包含裸的价格常量", async () => {
    const path = fileURLToPath(
      new URL("../../src/domain/chat/approval-gate.ts", import.meta.url),
    );
    const source = readFileSync(path, "utf-8");
    const forbiddenVendorOrModelNames = [
      "gpt-", "qwen", "claude", "sonnet", "opus", "openai", "anthropic",
      "deepseek", "llama", "gemini", "whisper",
    ];
    for (const needle of forbiddenVendorOrModelNames) {
      expect(source.toLowerCase().includes(needle), `source unexpectedly contains "${needle}"`).toBe(false);
    }
    // 唯一允许出现的数字是公式本身的常量（token 折算的 1000 与四舍五入的 100），
    // 而不是任何形如「单价 = 12.5」的价目字面量。
    expect(source).not.toMatch(/unitPrice\s*=\s*\d/);
    expect(source).not.toMatch(/¥|￥|CNY\s*\d/);
  });
});
