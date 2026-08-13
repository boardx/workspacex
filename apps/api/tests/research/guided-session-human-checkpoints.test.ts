import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { research as C } from "@repo/contracts";
import { addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f169-guided-research";
const OWNER = "u-f169-owner";
const COLLABORATOR = "u-f169-collaborator";
const OUTSIDER = "u-f169-outsider";
let app: NestExpressApplication;
let base = "";

const auth = { "content-type": "application/json", "x-kernel-test-principal": `${OWNER}:${ORG}` };
const brief = { topic: "欧洲储能", goal: "选择首批进入市场", timeRange: "2025-2028", region: "欧洲", focus: "市场与政策" };

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const address = app.getHttpServer().address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}, 120_000);

afterAll(async () => { await app?.close(); await resetOrgs(ORG); });

beforeEach(async () => {
  await resetOrgs(ORG);
  const fixture = await seedOrg({ orgId: ORG, projectId: "proj-f169" });
  await addOrgMember(ORG, OWNER, "consultant", fixture.teams.energy!);
  await addOrgMember(ORG, COLLABORATOR, "consultant", fixture.teams.energy!);
  await addOrgMember(ORG, OUTSIDER, "consultant", fixture.teams.energy!);
});

async function create(collaboratorUserIds: string[] = []) {
  const response = await fetch(`${base}${C.operations.createGuidedResearchSession.path}`, {
    method: "POST", headers: auth, body: JSON.stringify({ idempotencyKey: `f169-${crypto.randomUUID()}`, collaboratorUserIds, brief }),
  });
  const created = C.operations.createGuidedResearchSession.out.parse(await response.json());
  expect(created.briefVersion).toBe(1);
  expect(created.briefConfirmedAt).not.toBeNull();
  return created;
}

describe("F169 guided research human checkpoints", () => {
  it("confirms edited directions, regenerates a candidate, and preserves the confirmed version", async () => {
    const created = await create();
    const generatedResponse = await fetch(`${base}/research/guided-sessions/${created.sessionId}/directions/generate`, { method: "POST", headers: auth, body: "{}" });
    expect(generatedResponse.status).toBe(201);
    const generated = C.operations.generateResearchDirections.out.parse(await generatedResponse.json());
    const candidate = generated.directions.versions.at(-1)!;

    const edited = candidate.items.map((item, index) => index === 0 ? { ...item, title: "人工编辑的方向" } : item);
    const confirmedResponse = await fetch(`${base}/research/guided-sessions/${created.sessionId}/directions`, {
      method: "PUT", headers: auth, body: JSON.stringify({ candidateVersion: candidate.version, directions: edited }),
    });
    expect(confirmedResponse.status).toBe(200);
    const confirmed = C.operations.confirmResearchDirections.out.parse(await confirmedResponse.json());
    const confirmedVersion = confirmed.directions.confirmedVersion!;

    const regenerated = C.operations.generateResearchDirections.out.parse(await (await fetch(
      `${base}/research/guided-sessions/${created.sessionId}/directions/generate`, { method: "POST", headers: auth, body: "{}" },
    )).json());
    expect(regenerated.directions.candidateVersion).toBeGreaterThan(confirmedVersion);
    expect(regenerated.directions.confirmedVersion).toBe(confirmedVersion);
    expect(regenerated.directions.versions.find((version) => version.version === confirmedVersion)?.items[0]?.title).toBe("人工编辑的方向");
  });

  it("generates an outline only from confirmed directions and confirms a non-empty edited outline", async () => {
    const created = await create();
    const generated = C.operations.generateResearchDirections.out.parse(await (await fetch(
      `${base}/research/guided-sessions/${created.sessionId}/directions/generate`, { method: "POST", headers: auth, body: "{}" },
    )).json());
    const candidate = generated.directions.versions.at(-1)!;
    const allDisabled = await fetch(`${base}/research/guided-sessions/${created.sessionId}/directions`, {
      method: "PUT", headers: auth, body: JSON.stringify({ candidateVersion: candidate.version, directions: candidate.items.map((item) => ({ ...item, enabled: false })) }),
    });
    expect(allDisabled.status).toBe(400);

    await fetch(`${base}/research/guided-sessions/${created.sessionId}/directions`, {
      method: "PUT", headers: auth, body: JSON.stringify({ candidateVersion: candidate.version, directions: candidate.items }),
    });
    const outlineResponse = await fetch(`${base}/research/guided-sessions/${created.sessionId}/outline/generate`, { method: "POST", headers: auth, body: "{}" });
    expect(outlineResponse.status).toBe(201);
    const outlined = C.operations.generateResearchOutline.out.parse(await outlineResponse.json());
    const outlineCandidate = outlined.outline.versions.at(-1)!;
    const confirmedResponse = await fetch(`${base}/research/guided-sessions/${created.sessionId}/outline`, {
      method: "PUT", headers: auth,
      body: JSON.stringify({ candidateVersion: outlineCandidate.version, outline: outlineCandidate.items.map((item, index) => index === 0 ? { ...item, title: "人工编辑章节" } : item) }),
    });
    expect(confirmedResponse.status).toBe(200);
    const confirmed = C.operations.confirmResearchOutline.out.parse(await confirmedResponse.json());
    expect(confirmed.stage).toBe("outline");
    expect(confirmed.outline.versions.find((version) => version.version === confirmed.outline.confirmedVersion)?.items[0]?.title).toBe("人工编辑章节");
  });

  it("allows an explicit collaborator to edit checkpoints while hiding them from other org members", async () => {
    const created = await create([COLLABORATOR]);
    const collaboratorAuth = { ...auth, "x-kernel-test-principal": `${COLLABORATOR}:${ORG}` };
    const generated = await fetch(`${base}/research/guided-sessions/${created.sessionId}/directions/generate`, {
      method: "POST", headers: collaboratorAuth, body: "{}",
    });
    expect(generated.status).toBe(201);
    expect(C.operations.generateResearchDirections.out.parse(await generated.json()).directions.candidateVersion).toBe(1);

    const outsiderAuth = { ...auth, "x-kernel-test-principal": `${OUTSIDER}:${ORG}` };
    const hidden = await fetch(`${base}/research/guided-sessions/${created.sessionId}/directions/generate`, {
      method: "POST", headers: outsiderAuth, body: "{}",
    });
    expect(hidden.status).toBe(404);
    const hiddenBody = await hidden.json() as { reasonCode?: string };
    expect(hiddenBody.reasonCode).toBe("RESEARCH_NOT_FOUND");
  });
});
