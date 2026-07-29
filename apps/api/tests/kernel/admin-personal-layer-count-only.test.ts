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
 * F03 obligation 2 -- invariant I-8: the personal layer yields COUNTS ONLY.
 *
 * ## The exact wording matters, and this file is written to it
 *
 * I-8 says: "the response body contains NO content field", and then adds "not: the content
 * field is empty". Those are two different failures and only one of them stays fixed.
 *
 * An empty string is a value somebody fills in later, one reasonable-looking step at a
 * time -- "the list needs a title", "just a preview". A MISSING KEY cannot be filled in
 * without editing the contract, which is a review. So the assertions below check the set
 * of keys, not the values, and they check it in the contract's schema too, so the shape
 * cannot grow a content field even before an implementation exists to fill it.
 */
process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const PORT = 33232;
const BASE = `http://127.0.0.1:${PORT}`;
const ORG = "org-f03-personal";
const PROJECT = "proj-f03-personal";
const SECRET = "the private note nobody else may read";

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

const readItem = (requester: string, itemId: string, purpose: "work" | "audit" = "work") =>
  fetch(`${BASE}/identity/content/read`, {
    method: "POST",
    headers: as(requester),
    body: JSON.stringify({ orgId: ORG, projectId: PROJECT, itemId, purpose }),
  });

/** Anything that could plausibly carry a body. The point is that NONE of these appear. */
const CONTENT_ISH = /^(content|body|text|excerpt|preview|snippet|items|notes|title)$/i;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(PORT);
});

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, "u-admin", "admin", fx.teams.energy!);
  await addOrgMember(ORG, "u-owner", "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, "u-owner", "facilitator", null);
  await addContentItem({
    orgId: ORG, id: "personal-1", ownerUserId: "u-owner", layer: "personal", body: SECRET,
  });
  await addContentItem({
    orgId: ORG, id: "personal-2", ownerUserId: "u-owner", layer: "personal", body: "another one",
  });
});

describe("I-8: an admin querying somebody's personal layer gets a count and nothing else", () => {
  it("the response body has NO content key -- not an empty one", async () => {
    const res = await summary("u-admin", "u-owner");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.itemCount).toBe(2);
    // Key SET, not key values. `body.content === ""` would satisfy a value assertion while
    // being the failure I-8 names explicitly.
    expect(Object.keys(body).sort()).toEqual(["itemCount", "reasonCode", "userId"]);
    expect(Object.keys(body).filter((k) => CONTENT_ISH.test(k))).toEqual([]);
    // Belt and braces: no fragment of the secret anywhere in the payload, under any key.
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  it("says WHY there is only a number", async () => {
    const body = (await (await summary("u-admin", "u-owner")).json()) as Record<string, unknown>;
    // A bare number with no explanation reads as a loading failure. R8 asks for the
    // reason, not just the refusal.
    expect(body.reasonCode).toBe("PERSONAL_LAYER_CLOSED");
  });

  it("the owner's own summary carries no denial reason", async () => {
    const body = (await (await summary("u-owner", "u-owner")).json()) as Record<string, unknown>;
    expect(body.itemCount).toBe(2);
    expect(body.reasonCode).toBeNull();
    // Still counts only, even for the owner: this endpoint's job is counting. The owner
    // reads their own content through /identity/content/read, asserted below.
    expect(Object.keys(body).filter((k) => CONTENT_ISH.test(k))).toEqual([]);
  });

  it("the count is real -- it moves when the personal layer does", async () => {
    // Without this, an endpoint hardcoded to `itemCount: 2` would pass everything above.
    await addContentItem({
      orgId: ORG, id: "personal-3", ownerUserId: "u-owner", layer: "personal", body: "third",
    });
    const body = (await (await summary("u-admin", "u-owner")).json()) as Record<string, unknown>;
    expect(body.itemCount).toBe(3);
  });

  it("counts only the personal layer, not everything that user owns", async () => {
    await addContentItem({
      orgId: ORG, id: "proj-item", ownerUserId: "u-owner", projectId: PROJECT, body: "shared",
    });
    const body = (await (await summary("u-admin", "u-owner")).json()) as Record<string, unknown>;
    expect(body.itemCount).toBe(2);
  });
});

describe("the personal layer is closed on the read path too, which is where content lives", () => {
  it("an admin is refused a personal item -- `purpose: audit` included", async () => {
    for (const purpose of ["work", "audit"] as const) {
      const res = await readItem("u-admin", "personal-1", purpose);
      expect(res.status, `purpose=${purpose}`).toBe(403);
      const body = (await res.json()) as Record<string, unknown>;
      // The audit exemption of R4 A1 is about PROJECT content. Letting it reach the
      // personal layer would make the boundary a habit rather than a rule, since anybody
      // can type `purpose: "audit"`.
      expect(body.reasonCode, `purpose=${purpose}`).toBe("PERSONAL_LAYER_CLOSED");
      expect(JSON.stringify(body)).not.toContain(SECRET);
    }
  });

  it("a facilitator on the project is refused it as well -- this is not about roles", async () => {
    await addOrgMember(ORG, "u-other", "consultant", fx.teams.energy!);
    await addProjectMember(ORG, PROJECT, "u-other", "facilitator", null);
    const res = await readItem("u-other", "personal-1");
    expect(res.status).toBe(403);
    expect(((await res.json()) as { reasonCode: string }).reasonCode).toBe("PERSONAL_LAYER_CLOSED");
  });

  it("the owner reads their own personal item", async () => {
    const res = await readItem("u-owner", "personal-1");
    // The other half. "Nobody can read the personal layer" would satisfy every assertion
    // above and would have deleted the feature.
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.body).toBe(SECRET);
    expect(body.layer).toBe("personal");
  });
});

describe("the shape itself cannot grow a content field", () => {
  it("the contract's `out` schema declares exactly three keys, none content-ish", () => {
    // This is the assertion that survives a rewrite of the implementation. The runtime
    // checks above prove today's handler; this one proves the SHAPE, so a future response
    // that happens to include a body would fail contract validation before it ships.
    const shape = C.operations.getPersonalLayerSummary.out.shape;
    expect(Object.keys(shape).sort()).toEqual(["itemCount", "reasonCode", "userId"]);
    expect(Object.keys(shape).filter((k) => CONTENT_ISH.test(k))).toEqual([]);
  });

  it("the schema REJECTS a body carrying content, so the check above is not vacuous", () => {
    const withContent = {
      userId: "u-owner", itemCount: 2, reasonCode: "PERSONAL_LAYER_CLOSED",
      content: SECRET,
    };
    const parsed = C.operations.getPersonalLayerSummary.out.strict().safeParse(withContent);
    expect(parsed.success).toBe(false);
    // And the legitimate body still passes -- otherwise `.strict()` rejecting everything
    // would make the line above meaningless.
    expect(
      C.operations.getPersonalLayerSummary.out
        .strict()
        .safeParse({ userId: "u-owner", itemCount: 2, reasonCode: null }).success,
    ).toBe(true);
  });
});
