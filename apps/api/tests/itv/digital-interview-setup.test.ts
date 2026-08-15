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

type DigitalInterviewResponse = {
  interviewId: string;
  version: number;
  topic: string | null;
  status: string;
  scope: { kind: string; projectId: string | null; researchProjectId: string | null };
};

function maskTrace(raw: string) {
  return raw.replace(/"traceId":"[^"]+"/, '"traceId":"<masked>"');
}

async function postCreate(input: { readonly requestId: string; readonly name?: string }) {
  const response = await fetch(`${base}/interviews/digital`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({
      name: input.name ?? "德国储能采购决策链",
      tags: ["采购", "德国市场"],
      scope: { kind: "none", projectId: null, researchProjectId: null },
      requestId: input.requestId,
    }),
  });
  return response;
}

async function createInterview(requestId = "create-f04") {
  const response = await postCreate({ requestId });
  expect(response.status).toBe(201);
  return await response.json() as DigitalInterviewResponse;
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
  const otherFixture = await seedOrg({ orgId: OTHER_ORG, projectId: "proj-f04-other" });
  await addOrgMember(OTHER_ORG, USER, "consultant", otherFixture.teams.energy!);
});

describe("F04 批量数字专家访谈 — HTTP 持久化验收门", () => {
  it("创建只持久化名称和标签；create replay 幂等、变更 payload 被拒绝，并在重启后恢复 scope", async () => {
    const first = await postCreate({ requestId: "create-f04" });
    expect(first.status).toBe(201);
    const firstRaw = await first.text();
    const created = JSON.parse(firstRaw) as DigitalInterviewResponse;
    expect(created).toMatchObject({
      topic: null,
      status: "topic_pending",
      version: 1,
      scope: { kind: "none", projectId: null, researchProjectId: null },
    });

    const replay = await postCreate({ requestId: "create-f04" });
    expect(replay.status).toBe(201);
    const replayRaw = await replay.text();
    expect(maskTrace(replayRaw)).toBe(maskTrace(firstRaw));

    const changedPayload = await postCreate({ requestId: "create-f04", name: "同一 key 不能创建第二场访谈" });
    expect(changedPayload.status).toBe(409);
    expect(await changedPayload.json()).toMatchObject({ reasonCode: "IDEMPOTENCY_KEY_REUSED" });

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
      scope: { kind: "none", projectId: null, researchProjectId: null },
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
    const firstRaw = await first.text();
    expect(JSON.parse(firstRaw)).toMatchObject({ status: "experts_pending", version: 2 });

    const retry = await confirm("谁拥有储能采购的最终否决权？");
    expect(retry.status).toBe(201);
    expect(maskTrace(await retry.text())).toBe(maskTrace(firstRaw));

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

    await restartApp();
    const restored = await fetch(`${base}/interviews/digital/${created.interviewId}`, { headers: auth });
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({
      topic: "先确认的主题",
      status: "experts_pending",
      version: 2,
    });
  });

  it("跨组织读取与不存在读取仅 traceId 不同，且不泄露原因或被寻址 id", async () => {
    const created = await createInterview();
    const denied = await fetch(`${base}/interviews/digital/${created.interviewId}`, { headers: otherAuth });
    const missing = await fetch(`${base}/interviews/digital/itv-f04-does-not-exist`, { headers: auth });

    expect(denied.status).toBe(404);
    expect(missing.status).toBe(404);
    const deniedRaw = await denied.text();
    const missingRaw = await missing.text();
    const maskTrace = (raw: string) => raw.replace(/"traceId":"[^"]+"/, '"traceId":"<masked>"');
    const traceOf = (raw: string) => /"traceId":"([^"]+)"/.exec(raw)?.[1];

    expect(traceOf(deniedRaw)).toBeTruthy();
    expect(traceOf(missingRaw)).toBeTruthy();
    expect(traceOf(deniedRaw)).not.toBe(traceOf(missingRaw));
    expect(maskTrace(deniedRaw)).toBe(maskTrace(missingRaw));
    for (const raw of [deniedRaw, missingRaw]) {
      expect(raw).not.toContain("reasonCode");
      expect(raw).not.toContain(created.interviewId);
      expect(raw).not.toContain("itv-f04-does-not-exist");
    }
  });
});
