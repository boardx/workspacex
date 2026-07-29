import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { identity as C } from "@repo/contracts";
import {
  addBinding,
  addContentItem,
  addOrgMember,
  addProjectMember,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
  workerPort,
} from "../support/db";

/**
 * F03 obligation 1 -- an administrator is not a superuser (D-18 / UC-0.3 AC1).
 *
 * ## Why this file exists when `rbac-two-layer.test.ts` already asserts AC1
 *
 * That file asserts it about `decide()`. This one asserts it about the ENDPOINT THAT
 * RETURNS CONTENT. The gap between those two is the entire risk: a decision function can
 * be correct, thoroughly tested, and never consulted by the code path that actually hands
 * over a body. D-18 is a statement about reads, so it has to be proved on a read.
 *
 * ## Every denial here is paired
 *
 * "The admin is denied" is satisfied by an endpoint that denies everyone, which would pass
 * while being completely broken. So each denial is accompanied by the request that MUST
 * succeed -- same item, same org, someone who holds the project role.
 */
process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const PORT = workerPort(33231);
const BASE = `http://127.0.0.1:${PORT}`;
const ORG = "org-f03-deny";
const PROJECT = "proj-f03-deny";
const ITEM = "item-f03-deny";

let app: NestExpressApplication;
let fx: Awaited<ReturnType<typeof seedOrg>>;

const as = (userId: string) => ({
  "x-kernel-test-principal": `${userId}:${ORG}`,
  "content-type": "application/json",
});

const read = (
  userId: string,
  opts: { itemId?: string; purpose?: "work" | "audit"; projectId?: string } = {},
) =>
  fetch(`${BASE}/identity/content/read`, {
    method: "POST",
    headers: as(userId),
    body: JSON.stringify({
      orgId: ORG,
      projectId: opts.projectId ?? PROJECT,
      itemId: opts.itemId ?? ITEM,
      purpose: opts.purpose ?? "work",
    }),
  });

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
  await addContentItem({
    orgId: ORG, id: ITEM, ownerUserId: "u-facilitator", projectId: PROJECT,
    body: "the workshop's shared notes",
  });
  // The admin: full org standing, no role in this project. That combination is the
  // entire subject of AC1.
  await addOrgMember(ORG, "u-admin", "admin", fx.teams.energy!);
  await addOrgMember(ORG, "u-facilitator", "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, "u-facilitator", "facilitator", null);
});

describe("AC1 / D-18: on the real read path, an admin is not a superuser", () => {
  it("an org admin with no project role is REFUSED the content", async () => {
    const res = await read("u-admin");
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    // Not a bare 403. The user has to be able to tell "you are an admin and that is still
    // not a project role" from "your team cannot see this resource" -- they lead to
    // completely different next actions (UC-0.3 R8).
    expect(body.reasonCode).toBe("ADMIN_NOT_SUPERUSER");
    // And no content came back under any key.
    expect(JSON.stringify(body)).not.toContain("the workshop's shared notes");
  });

  it("the facilitator gets the SAME item, so the denial is a boundary and not an outage", async () => {
    const res = await read("u-facilitator");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect((body as { body: string }).body).toBe("the workshop's shared notes");
    // Not an audit read, so nothing was logged: a trail that fills up with ordinary work
    // is a trail nobody reads.
    expect((body as { provenanceEventId: unknown }).provenanceEventId).toBeNull();
    // The response conforms to the contract, denial paths included (修订 B / B-8).
    const parsed = C.operations.readContent.out.safeParse(body);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(body)).toBeNull();
  });

  it("a compliance officer is refused too, and is refused the audit exemption as well", async () => {
    await addOrgMember(ORG, "u-compliance", "compliance", fx.teams.energy!);
    expect((await read("u-compliance")).status).toBe(403);
    // D-U3 gives compliance the audit CHAIN, and says in the same breath that this does
    // not confer project content read. So `purpose: "audit"` buys them nothing -- the one
    // place where compliance and admin genuinely differ.
    const audit = await read("u-compliance", { purpose: "audit" });
    expect(audit.status).toBe(403);
    expect(((await audit.json()) as { reasonCode: string }).reasonCode).toBe("ADMIN_NOT_SUPERUSER");
  });

  it("an admin WITH a project role reads normally -- the org role was never the problem", async () => {
    await addProjectMember(ORG, PROJECT, "u-admin", "member", null);
    const res = await read("u-admin");
    // This is the other half of "not a superuser": being an admin neither grants nor
    // removes anything. Without it, an implementation that simply blocks admins would
    // pass every other assertion in this file.
    expect(res.status).toBe(200);
  });

  it("an observer is refused: this endpoint is not the `read.published` surface", async () => {
    await addOrgMember(ORG, "u-observer", "consultant", fx.teams.energy!);
    await addProjectMember(ORG, PROJECT, "u-observer", "observer", null);
    const res = await read("u-observer");
    expect(res.status).toBe(403);
    expect(((await res.json()) as { reasonCode: string }).reasonCode).toBe(
      "PROJECT_ROLE_INSUFFICIENT",
    );
  });
});

describe("AC3: the org layer still applies, and says so", () => {
  beforeEach(async () => {
    await addBinding({
      orgId: ORG,
      subject: { kind: "team", id: fx.teams.platform! },
      object: { kind: "artifact", id: ITEM },
      scope: "team-only",
      ownerTeamId: fx.teams.platform!,
    });
  });

  it("a team-only item is refused to a facilitator outside that team, as an ORG-layer denial", async () => {
    const res = await read("u-facilitator");
    expect(res.status).toBe(403);
    // The project role was sufficient. Reporting this as a project-layer problem sends the
    // user looking for a role they already hold.
    expect(((await res.json()) as { reasonCode: string }).reasonCode).toBe("ORG_SCOPE_DENIED");
  });

  it("`purpose: audit` does NOT open a team-only resource to an admin", async () => {
    const res = await read("u-admin", { purpose: "audit" });
    // R4 A1's exemption is from the PROJECT layer -- "I hold no role in this session".
    // If it also lifted resource visibility, `purpose: "audit"` would be a master key that
    // anybody can type, which is the shape of the thing D-18 forbids.
    expect(res.status).toBe(403);
    expect(((await res.json()) as { reasonCode: string }).reasonCode).toBe("ORG_SCOPE_DENIED");
  });

  it("the same item IS readable from inside the owning team", async () => {
    await addOrgMember(ORG, "u-platform", "consultant", fx.teams.platform!);
    await addProjectMember(ORG, PROJECT, "u-platform", "facilitator", null);
    expect((await read("u-platform")).status).toBe(200);
  });
});

describe("uc-0-1 V4: a draft is 404, not 403 -- for admins included", () => {
  beforeEach(async () => {
    await addContentItem({
      orgId: ORG, id: "item-draft", ownerUserId: "u-facilitator", projectId: PROJECT,
      status: "draft", body: "half-written thoughts",
    });
  });

  it("an admin reading somebody's draft for audit gets 404", async () => {
    const res = await read("u-admin", { itemId: "item-draft", purpose: "audit" });
    // 403 would answer "is there something here I cannot see". For a draft, that answer is
    // itself the disclosure -- which is why the draft check runs BEFORE the audit
    // exemption in `decideContentRead`.
    expect(res.status).toBe(404);
  });

  it("the draft's 404 is byte-identical to a nonexistent item's", async () => {
    const draft = await read("u-admin", { itemId: "item-draft", purpose: "audit" });
    const ghost = await read("u-admin", { itemId: "no-such-item", purpose: "audit" });
    expect(draft.status).toBe(ghost.status);
    const strip = (b: Record<string, unknown>) => ({ ...b, traceId: "<any>" });
    expect(strip((await draft.json()) as Record<string, unknown>)).toEqual(
      strip((await ghost.json()) as Record<string, unknown>),
    );
  });

  it("the creator reads their own draft", async () => {
    const res = await read("u-facilitator", { itemId: "item-draft" });
    // Without this half, "drafts are invisible to everyone" would pass -- and that is a
    // different, broken feature.
    expect(res.status).toBe(200);
    expect(((await res.json()) as { body: string }).body).toBe("half-written thoughts");
  });
});

describe("a non-member cannot even learn the organization exists", () => {
  it("gets 404, the same as for a nonexistent org", async () => {
    const res = await fetch(`${BASE}/identity/content/read`, {
      method: "POST",
      headers: { "x-kernel-test-principal": `u-stranger:${ORG}`, "content-type": "application/json" },
      body: JSON.stringify({ orgId: ORG, projectId: PROJECT, itemId: ITEM, purpose: "work" }),
    });
    expect(res.status).toBe(404);
  });
});
