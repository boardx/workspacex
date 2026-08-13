import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { research as C } from "@repo/contracts";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f168-guided-research";
const OTHER_ORG = "org-f168-guided-research-other";
const OWNER = "u-f168-owner";
const SAME_ORG_OTHER = "u-f168-same-org-other";
const COLLABORATOR = "u-f168-collaborator";
let app: NestExpressApplication;
let base = "";
let db: PgDatabase;

const auth = (userId: string, orgId = ORG) => ({
  "content-type": "application/json",
  "x-kernel-test-principal": `${userId}:${orgId}`,
});

const brief = {
  topic: "欧洲储能市场进入策略",
  goal: "确定首批进入国家与进入方式",
  timeRange: "2025-2028",
  region: "欧洲",
  focus: "市场、政策、并网与竞争格局",
};

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const address = app.getHttpServer().address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}, 120_000);

afterAll(async () => {
  await app?.close();
  await resetOrgs(ORG, OTHER_ORG);
  await db.close();
});

beforeEach(async () => {
  await resetOrgs(ORG, OTHER_ORG);
  const fixture = await seedOrg({ orgId: ORG, projectId: "proj-f168" });
  await addOrgMember(ORG, OWNER, "consultant", fixture.teams.energy!);
  await addOrgMember(ORG, SAME_ORG_OTHER, "consultant", fixture.teams.energy!);
  await addOrgMember(ORG, COLLABORATOR, "consultant", fixture.teams.energy!);
  await seedOrg({ orgId: OTHER_ORG, projectId: "proj-f168-other" });
});

async function create(key = "create-f168", collaboratorUserIds: string[] = []) {
  return fetch(`${base}${C.operations.createGuidedResearchSession.path}`, {
    method: "POST",
    headers: auth(OWNER),
    body: JSON.stringify({ idempotencyKey: key, collaboratorUserIds, brief }),
  });
}

describe("F168 guided research session list and recovery", () => {
  it("creates once per owner idempotency key and resumes from the persisted stage", async () => {
    const first = await create();
    expect(first.status).toBe(201);
    const created = C.operations.createGuidedResearchSession.out.parse(await first.json());
    expect(created).toMatchObject({
      title: brief.topic, stage: "directions", resumeStage: "directions", status: "active", progress: 20,
    });

    const replay = await create();
    expect(replay.status).toBe(201);
    expect(C.operations.createGuidedResearchSession.out.parse(await replay.json()).sessionId)
      .toBe(created.sessionId);

    const detail = await fetch(`${base}/research/guided-sessions/${created.sessionId}`, {
      headers: auth(OWNER),
    });
    expect(detail.status).toBe(200);
    expect(C.operations.getGuidedResearchSession.out.parse(await detail.json()).stage)
      .toBe("directions");

    const list = await fetch(`${base}${C.operations.listGuidedResearchSessions.path}`, {
      headers: auth(OWNER),
    });
    expect(list.status).toBe(200);
    expect(C.operations.listGuidedResearchSessions.out.parse(await list.json()).items)
      .toHaveLength(1);
  });

  it("does not reveal an owner's private session to another member in the same org", async () => {
    const created = C.operations.createGuidedResearchSession.out.parse(await (await create()).json());

    const list = await fetch(`${base}${C.operations.listGuidedResearchSessions.path}`, {
      headers: auth(SAME_ORG_OTHER),
    });
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ items: [] });

    const detail = await fetch(`${base}/research/guided-sessions/${created.sessionId}`, {
      headers: auth(SAME_ORG_OTHER),
    });
    expect(detail.status).toBe(404);
    expect(await detail.json()).toMatchObject({ error: "not_found", reasonCode: "RESEARCH_NOT_FOUND" });
  });

  it("lists and restores a session for an explicit collaborator", async () => {
    const response = await create("create-shared", [COLLABORATOR]);
    expect(response.status).toBe(201);
    const created = C.operations.createGuidedResearchSession.out.parse(await response.json());

    const list = await fetch(`${base}${C.operations.listGuidedResearchSessions.path}`, {
      headers: auth(COLLABORATOR),
    });
    expect(list.status).toBe(200);
    expect(C.operations.listGuidedResearchSessions.out.parse(await list.json()).items)
      .toEqual([expect.objectContaining({ sessionId: created.sessionId })]);

    const detail = await fetch(`${base}/research/guided-sessions/${created.sessionId}`, {
      headers: auth(COLLABORATOR),
    });
    expect(detail.status).toBe(200);
    expect(C.operations.getGuidedResearchSession.out.parse(await detail.json()).sessionId)
      .toBe(created.sessionId);
  });

  it("rejects collaborator ids that are not members of the current organization", async () => {
    const response = await create("create-invalid-collaborator", ["u-not-an-org-member"]);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "bad_request", reasonCode: "INVALID_RESEARCH_COLLABORATOR" });
    const list = await fetch(`${base}${C.operations.listGuidedResearchSessions.path}`, { headers: auth(OWNER) });
    expect(C.operations.listGuidedResearchSessions.out.parse(await list.json()).items).toEqual([]);
  });

  it("rejects an idempotency replay whose brief or collaborators differ", async () => {
    expect((await create("create-fingerprint", [COLLABORATOR])).status).toBe(201);
    const changedCollaborator = await create("create-fingerprint", [SAME_ORG_OTHER]);
    expect(changedCollaborator.status).toBe(409);
    expect(await changedCollaborator.json()).toMatchObject({ reasonCode: "RESEARCH_CREATE_REPLAY_MISMATCH" });

    const list = await fetch(`${base}${C.operations.listGuidedResearchSessions.path}`, { headers: auth(SAME_ORG_OTHER) });
    expect(C.operations.listGuidedResearchSessions.out.parse(await list.json()).items).toEqual([]);
  });

  it("RLS also hides the session when queried under another tenant", async () => {
    await create();
    const rows = await db.withTenant(toOrgId(OTHER_ORG), (session) =>
      session.query("SELECT id FROM guided_research_sessions"),
    );
    expect(rows.rows).toEqual([]);
  });
});
