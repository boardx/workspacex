import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { identity as C } from "@repo/contracts";
import {
  addContentItem,
  addOrgMember,
  addProjectMember,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
} from "../support/db";

/**
 * F06 / D-18, first user_visible_behavior sentence:
 * 「管理员查他人个人层只返回条目计数，内容字段不存在于响应体」。
 *
 * ## Why this file exists alongside `tests/kernel/admin-personal-layer-count-only.test.ts`
 *
 * That file is F03's own proof of invariant I-8 against `GetPersonalLayerSummary` in
 * isolation. F06 is the D-18 feature that PROMISES the four-sentence behavior as one
 * package (counts-only + audited project read + lead visibility + own history +
 * "admin gains nothing from identity alone") and is verified as its own GitHub-visible
 * unit. This file is F06's half of that package: it re-proves the counts-only sentence
 * on F06's own read path assumptions (an admin who ALSO has no project role at all, i.e.
 * the D-18 baseline case: identity confers nothing), rather than assuming F03's fixture
 * shape. `admin-project-read-audited.test.ts` carries the other three sentences.
 *
 * Kept intentionally thin: the exhaustive key-shape / schema-drift assertions already
 * live in F03's file, so this one does not re-litigate them -- it asserts the specific
 * claim F06's issue body states, once, directly against the running HTTP surface.
 */
process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

let BASE: string;
const ORG = "org-f06-personal";
const PROJECT = "proj-f06-personal";
const SECRET = "f06 owner's private draft judgement";

let app: NestExpressApplication;
let fx: Awaited<ReturnType<typeof seedOrg>>;

const as = (userId: string) => ({
  "x-kernel-test-principal": `${userId}:${ORG}`,
  "content-type": "application/json",
});

const summary = (requester: string, ofUser: string) =>
  fetch(`${BASE}/identity/personal-layer/summary?orgId=${ORG}&userId=${ofUser}`, {
    headers: as(requester),
  });

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  // The admin here holds NO project role at all -- D-18's baseline: "管理员不因身份自动
  // 获得任何项目内容读取权". If the admin also held a project role, a counts-only pass
  // could be explained by that role rather than by the personal-layer boundary itself.
  fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, "u-f06-admin", "admin", fx.teams.energy!);
  await addOrgMember(ORG, "u-f06-owner", "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, "u-f06-owner", "facilitator", null);
  await addContentItem({
    orgId: ORG, id: "f06-personal-1", ownerUserId: "u-f06-owner", layer: "personal", body: SECRET,
  });
  await addContentItem({
    orgId: ORG, id: "f06-personal-2", ownerUserId: "u-f06-owner", layer: "personal", body: "second entry",
  });
});

describe("D-18 sentence 1: 管理员查他人个人层只返回条目计数，内容字段不存在于响应体", () => {
  it("the response carries itemCount and nothing content-shaped", async () => {
    const res = await summary("u-f06-admin", "u-f06-owner");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.itemCount).toBe(2);
    // Exact key set -- a missing key cannot be filled in later without a contract review,
    // which is the whole point of I-8's "no field" wording over "empty field".
    expect(Object.keys(body).sort()).toEqual(["itemCount", "reasonCode", "userId"]);
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(JSON.stringify(body)).not.toContain("second entry");

    const parsed = C.operations.getPersonalLayerSummary.out.safeParse(body);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(body)).toBeNull();
  });

  it("D-18 sentence 4: the SAME admin cannot read the personal item's content by any purpose", async () => {
    for (const purpose of ["work", "audit"] as const) {
      const res = await fetch(`${BASE}/identity/content/read`, {
        method: "POST",
        headers: as("u-f06-admin"),
        body: JSON.stringify({
          orgId: ORG, projectId: PROJECT, itemId: "f06-personal-1", purpose,
        }),
      });
      expect(res.status, `purpose=${purpose}`).toBe(403);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.reasonCode, `purpose=${purpose}`).toBe("PERSONAL_LAYER_CLOSED");
      expect(JSON.stringify(body)).not.toContain(SECRET);
    }
  });

  it("COUNTER-PROOF: the owner's own summary is not mistaken for the closed case", async () => {
    // Without this, an implementation that always returns PERSONAL_LAYER_CLOSED (i.e.
    // treats everyone as if they were an admin reading someone else) would pass the tests
    // above while breaking the owner's own view of their count.
    const body = (await (await summary("u-f06-owner", "u-f06-owner")).json()) as Record<
      string,
      unknown
    >;
    expect(body.itemCount).toBe(2);
    expect(body.reasonCode).toBeNull();
  });
});
