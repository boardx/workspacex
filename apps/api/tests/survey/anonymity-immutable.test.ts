import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { addOrgMember, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-survey-anonymity-4037";
const OTHER = "org-survey-anonymity-other-4037";
const USER = "u-survey-anonymity-4037";
let app: NestExpressApplication;
let base = "";
const auth = (org = ORG) => ({
  "x-kernel-test-principal": `${USER}:${org}`,
  "content-type": "application/json",
});
const request = (path: string, method = "GET", body?: unknown, org = ORG) =>
  fetch(base + path, {
    method,
    headers: auth(org),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const draft = {
  title: "匿名性不可变",
  questions: [],
  template: { id: "report", title: "报告", sections: [] },
};

beforeAll(async () => {
  await migrateOnce();
  await resetOrgs(ORG, OTHER);
  const fixture = await seedOrg({ orgId: ORG, projectId: "survey-anonymity-project" });
  await addOrgMember(ORG, USER, "consultant", fixture.teams.energy!);
  await seedOrg({ orgId: OTHER, projectId: "survey-anonymity-other-project" });
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
}, 120000);

afterAll(async () => {
  await app?.close();
  await resetOrgs(ORG, OTHER);
});

describe("survey anonymity immutability", () => {
  it.each([
    ["anonymous", "identified"],
    ["identified", "anonymous"],
  ] as const)("rejects %s → %s before mutation", async (createdAs, attempted) => {
    const createdResponse = await request("/surveys", "POST", {
      draft,
      anonymity: createdAs,
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json();

    const response = await request(`/surveys/${created.id}`, "PUT", {
      draft,
      expectedVersion: created.version,
      anonymity: attempted,
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      reasonCode: "ANONYMITY_IMMUTABLE",
    });
    expect(await (await request(`/surveys/${created.id}`)).json()).toMatchObject({
      anonymity: createdAs,
      version: 1,
    });
  });

  it("uses identical not-found responses across tenant and random identifiers", async () => {
    const created = await (
      await request("/surveys", "POST", { draft, anonymity: "anonymous" })
    ).json();

    const hidden = await request(`/surveys/${created.id}`, "GET", undefined, OTHER);
    const random = await request("/surveys/sv-does-not-exist", "GET");

    expect(hidden.status).toBe(404);
    expect(random.status).toBe(404);
    const hiddenBody = await hidden.json();
    const randomBody = await random.json();
    delete hiddenBody.traceId;
    delete randomBody.traceId;
    expect(hiddenBody).toEqual(randomBody);
  });
});
