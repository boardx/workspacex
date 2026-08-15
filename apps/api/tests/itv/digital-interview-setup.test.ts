import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-digital-interview-f04";
const OTHER_ORG = "org-digital-interview-f04-other";
const USER = "u-digital-interview-f04";
const auth = { "x-kernel-test-principal": `${USER}:${ORG}` };
const otherAuth = { "x-kernel-test-principal": `${USER}:${OTHER_ORG}` };

let app: NestExpressApplication;
let base = "";
let db: PgDatabase;

async function startApp() {
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const address = app.getHttpServer().address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}

async function restartApp() {
  await app.close();
  await startApp();
}

async function createInterview(requestId = "create-f04") {
  const response = await fetch(`${base}/interviews/digital`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({
      name: "德国储能采购决策链",
      tags: ["采购", "德国市场"],
      scope: { kind: "none", projectId: null, researchProjectId: null },
      requestId,
    }),
  });
  expect(response.status).toBe(201);
  return await response.json() as { interviewId: string; version: number; topic: string | null; status: string };
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  await startApp();
}, 120_000);

afterAll(async () => {
  await app?.close();
  await resetOrgs(ORG, OTHER_ORG);
  await db.close();
});

beforeEach(async () => {
  await resetOrgs(ORG, OTHER_ORG);
  const fixture = await seedOrg({ orgId: ORG, projectId: "proj-f04" });
  await addOrgMember(ORG, USER, "consultant", fixture.teams.energy!);
  await seedOrg({ orgId: OTHER_ORG, projectId: "proj-f04-other" });
});

describe("F04 批量数字专家访谈 — HTTP 持久化验收门", () => {
  it("创建只持久化名称和标签；刷新及进程重建后仍恢复 topic_pending 与版本", async () => {
    const created = await createInterview();
    expect(created).toMatchObject({ topic: null, status: "topic_pending", version: 1 });

    await restartApp();
    const restored = await fetch(`${base}/interviews/digital/${created.interviewId}`, { headers: auth });
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({
      interviewId: created.interviewId,
      name: "德国储能采购决策链",
      tags: ["采购", "德国市场"],
      topic: null,
      status: "topic_pending",
      version: 1,
    });
  });

  it("确认主题只产生一个新版本；同 requestId 重试幂等，而改 payload 重用 key 被拒绝", async () => {
    const created = await createInterview();
    const confirm = (topic: string) => fetch(`${base}/interviews/digital/${created.interviewId}/topic/confirm`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ topic, requestId: "confirm-topic-f04", expectedVersion: created.version }),
    });

    const first = await confirm("谁拥有储能采购的最终否决权？");
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({ status: "experts_pending", version: 2 });

    const retry = await confirm("谁拥有储能采购的最终否决权？");
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ status: "experts_pending", version: 2 });

    const changedPayload = await confirm("同一 key 不能悄悄覆盖成另一个主题");
    expect(changedPayload.status).toBe(409);
    expect(await changedPayload.json()).toMatchObject({ reasonCode: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("陈旧 expectedVersion 冲突，且不会把已确认主题覆盖掉", async () => {
    const created = await createInterview();
    const first = await fetch(`${base}/interviews/digital/${created.interviewId}/topic/confirm`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ topic: "先确认的主题", requestId: "topic-current-f04", expectedVersion: 1 }),
    });
    expect(first.status).toBe(201);

    const stale = await fetch(`${base}/interviews/digital/${created.interviewId}/topic/confirm`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ topic: "不应覆盖", requestId: "topic-stale-f04", expectedVersion: 1 }),
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ reasonCode: "CONCURRENT_MODIFICATION" });
  });

  it("跨组织读取与不存在读取保持字节等价的 404", async () => {
    const created = await createInterview();
    const denied = await fetch(`${base}/interviews/digital/${created.interviewId}`, { headers: otherAuth });
    const missing = await fetch(`${base}/interviews/digital/itv-f04-does-not-exist`, { headers: auth });

    expect(denied.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await denied.text()).toBe(await missing.text());
  });
});
