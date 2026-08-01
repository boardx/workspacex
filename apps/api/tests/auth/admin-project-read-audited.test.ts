import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { provenance as P } from "@repo/contracts";
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
 * F06 / D-18, sentences 2-4 of the issue's user_visible_behavior:
 *
 *   「管理员读项目层内容成功但立即产生一条审计记录，且该记录对项目负责人可见；
 *    管理员在「看我的访问记录」可看到同一条；
 *    管理员不因身份自动获得任何项目内容读取权。」
 *
 * ## Relation to `tests/kernel/admin-audit-access-visible-to-lead.test.ts`
 *
 * That file is F03's exhaustive proof of R4 A1 (append-only grants, injected-failure
 * ordering, the CHECK constraint mirroring the contract enum). This file does not repeat
 * that machinery -- it asserts F06's OWN four-sentence promise as ONE scenario per
 * assertion, on the same running HTTP surface, so this feature has its own GitHub-visible
 * verification independent of which sprint originally built the mechanism underneath it.
 *
 * The one thing genuinely new here relative to that file: sentence 3 is asserted as "the
 * SAME event id appears in both the lead's view and the admin's own view" -- not merely
 * "each view is non-empty" -- because two views that happen to both have one row each
 * could still be looking at two different accesses.
 */
process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

let BASE: string;
const ORG = "org-f06-audit";
const PROJECT = "proj-f06-audit";
const ITEM = "item-f06-audit";

let app: NestExpressApplication;
let fx: Awaited<ReturnType<typeof seedOrg>>;

const as = (userId: string) => ({
  "x-kernel-test-principal": `${userId}:${ORG}`,
  "content-type": "application/json",
});

const read = (userId: string, purpose: "work" | "audit") =>
  fetch(`${BASE}/identity/content/read`, {
    method: "POST",
    headers: as(userId),
    body: JSON.stringify({ orgId: ORG, projectId: PROJECT, itemId: ITEM, purpose }),
  });

const trail = (userId: string, q: Record<string, string> = {}) =>
  fetch(`${BASE}/provenance?${new URLSearchParams({ orgId: ORG, ...q }).toString()}`, {
    headers: as(userId),
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
  fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, "u-f06-admin", "admin", fx.teams.energy!);
  // 「项目负责人」= org role `lead` (UC-0.3 R5); the project roles (facilitator/groupLead/
  // member/observer) are a different axis. Getting this wrong points the visibility
  // requirement at the wrong person.
  await addOrgMember(ORG, "u-f06-lead", "lead", fx.teams.energy!);
  await addContentItem({
    orgId: ORG, id: ITEM, ownerUserId: "u-f06-lead", projectId: PROJECT,
    body: "the project's shared minutes",
  });
});

describe("D-18 sentence 2: an audit read succeeds and writes a trail visible to the lead", () => {
  it("the read returns 200 with content and a provenance event id", async () => {
    const res = await read("u-f06-admin", "audit");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.body).toBe("the project's shared minutes");
    expect(typeof body.provenanceEventId).toBe("string");
  });

  it("the project lead can find that exact access", async () => {
    const readBody = (await (await read("u-f06-admin", "audit")).json()) as {
      provenanceEventId: string;
    };

    const page = (await (
      await trail("u-f06-lead", { targetKind: "project", targetId: PROJECT })
    ).json()) as { events: Record<string, unknown>[] };

    const access = page.events.filter((e) => e.type === "admin-project-access");
    expect(access).toHaveLength(1);
    expect(access[0]!.id).toBe(readBody.provenanceEventId);
    expect(access[0]!.actorId).toBe("u-f06-admin");
    expect((access[0]!.target as { id: string }).id).toBe(PROJECT);

    const parsed = P.operations.queryProvenance.out.safeParse(page);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(page)).toBeNull();
  });
});

describe("D-18 sentence 3: 「看我的访问记录」 shows the SAME event, not merely a similar one", () => {
  it("the admin's own-history view names the identical event id the lead saw", async () => {
    const readBody = (await (await read("u-f06-admin", "audit")).json()) as {
      provenanceEventId: string;
    };

    const leadPage = (await (
      await trail("u-f06-lead", { targetKind: "project", targetId: PROJECT })
    ).json()) as { events: Record<string, unknown>[] };
    const adminPage = (await (await trail("u-f06-admin", { actorId: "u-f06-admin" })).json()) as {
      events: Record<string, unknown>[];
    };

    expect(leadPage.events).toHaveLength(1);
    expect(adminPage.events).toHaveLength(1);
    // The load-bearing assertion: same id in both views, not "each view has one row".
    expect(adminPage.events[0]!.id).toBe(leadPage.events[0]!.id);
    expect(adminPage.events[0]!.id).toBe(readBody.provenanceEventId);
  });

  it("repeat access shows up as repeat rows in the admin's own history -- not folded into one", async () => {
    await read("u-f06-admin", "audit");
    await read("u-f06-admin", "audit");
    const page = (await (await trail("u-f06-admin", { actorId: "u-f06-admin" })).json()) as {
      events: unknown[];
    };
    expect(page.events).toHaveLength(2);
  });
});

describe("D-18 sentence 4: 管理员不因身份自动获得任何项目内容读取权", () => {
  it("the SAME admin reading the SAME item for ordinary work is refused", async () => {
    const res = await read("u-f06-admin", "work");
    expect(res.status).toBe(403);
    expect(((await res.json()) as { reasonCode: string }).reasonCode).toBe(
      "ADMIN_NOT_SUPERUSER",
    );
  });

  it("...and the refusal leaves NO audit trail -- audit is the exemption, not ambient access", async () => {
    await read("u-f06-admin", "work");
    const page = (await (
      await trail("u-f06-lead", { targetKind: "project", targetId: PROJECT })
    ).json()) as { events: unknown[] };
    expect(page.events).toEqual([]);
  });

  it("an admin who separately holds a project role reads normally -- it is the ROLE, not the org identity", async () => {
    await addProjectMember(ORG, PROJECT, "u-f06-admin", "member", null);
    const res = await read("u-f06-admin", "work");
    expect(res.status).toBe(200);
    // ...and because this was an ordinary role-based read, not the audit exemption, it
    // still leaves no admin-project-access row.
    const page = (await (
      await trail("u-f06-lead", { targetKind: "project", targetId: PROJECT })
    ).json()) as { events: Record<string, unknown>[] };
    expect(page.events.filter((e) => e.type === "admin-project-access")).toEqual([]);
  });
});
