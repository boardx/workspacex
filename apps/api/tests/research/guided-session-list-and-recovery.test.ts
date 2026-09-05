import { ModelGuidedResearchCheckpointGenerator } from "../../src/application/research/model-guided-checkpoint-generator";
import { DeterministicGuidedResearchCheckpointGenerator } from "../../src/domain/research/guided-research-checkpoint-generator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
  // This suite isolates checkpoint persistence; real model generation is verified separately.
  const fixtureGenerator = new DeterministicGuidedResearchCheckpointGenerator();
  vi.spyOn(ModelGuidedResearchCheckpointGenerator.prototype, "generateDirections").mockImplementation((brief) => fixtureGenerator.generateDirections(brief));
  vi.spyOn(ModelGuidedResearchCheckpointGenerator.prototype, "generateOutline").mockImplementation((directions) => fixtureGenerator.generateOutline(directions));
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
    body: JSON.stringify({ title: "欧洲储能进入研究", tags: ["欧洲", "储能"], idempotencyKey: key, collaboratorUserIds, brief }),
  });
}

describe("F168 guided research session list and recovery", () => {
  it("creates once per owner idempotency key and resumes from the persisted stage", async () => {
    const first = await create();
    expect(first.status).toBe(201);
    const created = C.operations.createGuidedResearchSession.out.parse(await first.json());
    expect(created).toMatchObject({
      title: "欧洲储能进入研究", tags: ["欧洲", "储能"], stage: "directions", resumeStage: "directions", status: "active", progress: 20,
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

  it("persists the lifecycle and transactionally retracts completed checkpoints", async () => {
    const created = C.operations.createGuidedResearchSession.out.parse(await (await create("create-lifecycle")).json());

    const premature = await fetch(`${base}/research/guided-sessions/${created.sessionId}/complete`, {
      method: "POST",
      headers: auth(OWNER),
      body: JSON.stringify({}),
    });
    expect(premature.status).toBe(409);
    expect(await premature.json()).toMatchObject({ reasonCode: "RESEARCH_STAGE_CONFLICT" });

    const directionsResponse = await fetch(`${base}/research/guided-sessions/${created.sessionId}/directions/generate`, {
      method: "POST",
      headers: auth(OWNER),
      body: JSON.stringify({}),
    });
    expect(directionsResponse.status).toBe(201);
    const directions = C.operations.generateResearchDirections.out.parse(await directionsResponse.json());
    const directionCandidate = directions.directions.versions.at(-1)!;

    const confirmedDirectionsResponse = await fetch(`${base}/research/guided-sessions/${created.sessionId}/directions`, {
      method: "PUT",
      headers: auth(OWNER),
      body: JSON.stringify({ candidateVersion: directionCandidate.version, directions: directionCandidate.items }),
    });
    expect(confirmedDirectionsResponse.status).toBe(200);
    const confirmedDirections = C.operations.confirmResearchDirections.out.parse(await confirmedDirectionsResponse.json());

    const outlineResponse = await fetch(`${base}/research/guided-sessions/${created.sessionId}/outline/generate`, {
      method: "POST",
      headers: auth(OWNER),
      body: JSON.stringify({}),
    });
    expect(outlineResponse.status).toBe(201);
    const outline = C.operations.generateResearchOutline.out.parse(await outlineResponse.json());
    const outlineCandidate = outline.outline.versions.at(-1)!;

    const confirmedOutlineResponse = await fetch(`${base}/research/guided-sessions/${created.sessionId}/outline`, {
      method: "PUT",
      headers: auth(OWNER),
      body: JSON.stringify({ candidateVersion: outlineCandidate.version, outline: outlineCandidate.items }),
    });
    expect(confirmedOutlineResponse.status).toBe(200);
    const confirmedOutline = C.operations.confirmResearchOutline.out.parse(await confirmedOutlineResponse.json());
    expect(confirmedOutline.stage).toBe("researching");
    expect(confirmedOutline.resumeStage).toBe("researching");

    const reportResponse = await fetch(
      `${base}/research/guided-sessions/${created.sessionId}/researching/complete`,
      {
        method: "POST",
        headers: auth(OWNER),
        body: JSON.stringify({ sourceCount: 3 }),
      },
    );
    expect(reportResponse.status).toBe(201);
    const reported = C.operations.finishGuidedResearchCollection.out.parse(await reportResponse.json());
    expect(reported).toMatchObject({
      stage: "report",
      resumeStage: "report",
      status: "active",
      sourceCount: 3,
    });

    const completedResponse = await fetch(`${base}/research/guided-sessions/${created.sessionId}/complete`, {
      method: "POST", headers: auth(OWNER), body: "{}",
    });
    expect(completedResponse.status).toBe(201);
    expect(C.operations.completeGuidedResearchSession.out.parse(await completedResponse.json()).status).toBe("completed");

    const regeneratedReportResponse = await fetch(`${base}/research/guided-sessions/${created.sessionId}/researching/complete`, {
      method: "POST", headers: auth(OWNER), body: JSON.stringify({ sourceCount: 2 }),
    });
    expect(regeneratedReportResponse.status).toBe(201);
    expect(C.operations.finishGuidedResearchCollection.out.parse(await regeneratedReportResponse.json()))
      .toMatchObject({ stage: "report", status: "active", sourceCount: 2 });
    expect((await fetch(`${base}/research/guided-sessions/${created.sessionId}/complete`, {
      method: "POST", headers: auth(OWNER), body: "{}",
    })).status).toBe(201);

    const hiddenBriefUpdate = await fetch(`${base}/research/guided-sessions/${created.sessionId}/brief`, {
      method: "PUT",
      headers: auth(SAME_ORG_OTHER),
      body: JSON.stringify({ briefVersion: 1, brief: { ...brief, topic: "不应泄露的修改" } }),
    });
    expect(hiddenBriefUpdate.status).toBe(404);
    expect(await hiddenBriefUpdate.json()).toMatchObject({ reasonCode: "RESEARCH_NOT_FOUND" });

    const reconfirmedOutlineResponse = await fetch(`${base}/research/guided-sessions/${created.sessionId}/outline`, {
      method: "PUT",
      headers: auth(OWNER),
      body: JSON.stringify({
        candidateVersion: confirmedOutline.outline.candidateVersion,
        outline: confirmedOutline.outline.versions.at(-1)!.items.map((item, index) => index === 0 ? { ...item, title: "回访后更新的大纲" } : item),
      }),
    });
    expect(reconfirmedOutlineResponse.status).toBe(200);
    const reconfirmedOutline = C.operations.confirmResearchOutline.out.parse(await reconfirmedOutlineResponse.json());
    expect(reconfirmedOutline).toMatchObject({
      stage: "researching", resumeStage: "researching", status: "active", progress: 60, sourceCount: 0, reportId: null,
    });

    const reportAgain = await fetch(`${base}/research/guided-sessions/${created.sessionId}/researching/complete`, {
      method: "POST", headers: auth(OWNER), body: JSON.stringify({ sourceCount: 2 }),
    });
    expect(reportAgain.status).toBe(201);

    const reconfirmedDirectionsResponse = await fetch(`${base}/research/guided-sessions/${created.sessionId}/directions`, {
      method: "PUT",
      headers: auth(OWNER),
      body: JSON.stringify({
        candidateVersion: confirmedDirections.directions.candidateVersion,
        directions: confirmedDirections.directions.versions.at(-1)!.items.map((item, index) => index === 0 ? { ...item, title: "回访后更新的方向" } : item),
      }),
    });
    expect(reconfirmedDirectionsResponse.status).toBe(200);
    const reconfirmedDirections = C.operations.confirmResearchDirections.out.parse(await reconfirmedDirectionsResponse.json());
    expect(reconfirmedDirections).toMatchObject({
      stage: "outline", resumeStage: "outline", status: "active", progress: 40, sourceCount: 0, reportId: null,
      outline: { candidateVersion: null, confirmedVersion: null, versions: [] },
    });

    const regeneratedOutlineResponse = await fetch(`${base}/research/guided-sessions/${created.sessionId}/outline/generate`, {
      method: "POST", headers: auth(OWNER), body: "{}",
    });
    expect(regeneratedOutlineResponse.status).toBe(201);
    const regeneratedOutline = C.operations.generateResearchOutline.out.parse(await regeneratedOutlineResponse.json());
    const regeneratedOutlineCandidate = regeneratedOutline.outline.versions.at(-1)!;
    const confirmedAgainResponse = await fetch(`${base}/research/guided-sessions/${created.sessionId}/outline`, {
      method: "PUT", headers: auth(OWNER),
      body: JSON.stringify({ candidateVersion: regeneratedOutlineCandidate.version, outline: regeneratedOutlineCandidate.items }),
    });
    expect(confirmedAgainResponse.status).toBe(200);
    expect((await fetch(`${base}/research/guided-sessions/${created.sessionId}/researching/complete`, {
      method: "POST", headers: auth(OWNER), body: JSON.stringify({ sourceCount: 1 }),
    })).status).toBe(201);

    const reconfirmedBriefResponse = await fetch(`${base}/research/guided-sessions/${created.sessionId}/brief`, {
      method: "PUT", headers: auth(OWNER),
      body: JSON.stringify({ briefVersion: 1, brief: { ...brief, topic: "回访后更新的主题" } }),
    });
    expect(reconfirmedBriefResponse.status).toBe(200);
    const reconfirmedBrief = C.operations.getGuidedResearchSession.out.parse(await reconfirmedBriefResponse.json());
    expect(reconfirmedBrief).toMatchObject({
      sessionId: created.sessionId, briefVersion: 2, brief: { topic: "回访后更新的主题" },
      stage: "directions", resumeStage: "directions", status: "active", progress: 20, sourceCount: 0, reportId: null,
      directions: { candidateVersion: null, confirmedVersion: null, versions: [] },
      outline: { candidateVersion: null, confirmedVersion: null, versions: [] },
    });

    const staleBrief = await fetch(`${base}/research/guided-sessions/${created.sessionId}/brief`, {
      method: "PUT", headers: auth(OWNER),
      body: JSON.stringify({ briefVersion: 1, brief }),
    });
    expect(staleBrief.status).toBe(409);
    expect(await staleBrief.json()).toMatchObject({ reasonCode: "RESEARCH_CHECKPOINT_CONFLICT" });

    const afterStaleBrief = C.operations.getGuidedResearchSession.out.parse(await (await fetch(
      `${base}/research/guided-sessions/${created.sessionId}`, { headers: auth(OWNER) },
    )).json());
    expect(afterStaleBrief.brief.topic).toBe("回访后更新的主题");
  });
});
