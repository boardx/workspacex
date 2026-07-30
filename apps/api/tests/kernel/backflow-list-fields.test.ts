process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { artifact as C, identity as identityContract } from "@repo/contracts";
import {
  addBinding,
  addOrgMember,
  addProjectMember,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
} from "../support/db";
import { makeHarness, seedArtifact, type Harness } from "../support/binding-fixture";
import { toOrgId } from "../../src/domain/org-id";
import { bindToProjectStep } from "../../src/application/artifact/bind-to-project-step";
import { listBackflow } from "../../src/application/artifact/list-backflow";
import { NoProjectRoleError } from "../../src/application/artifact/binding-errors";
import { pinVersion } from "../../src/application/artifact/pin-version";

/**
 * F06 -- 「已回流的产出与版本」: the four fields, and what a zod parse cannot tell you (V3/AC3).
 *
 * ## Why `safeParse` is not the assertion
 *
 * `BackflowEntry.parse({ mode: "live", version: 1, pinnedBy: "", pinnedAt: "" })` SUCCEEDS.
 * Every field present, every type right, and the row answers none of the three questions AC3
 * asks -- which mode, which version, who froze it and when. That is the same split F09 found
 * between the Pack's V2 and V10, and it is recorded there as the reason the two cannot be one
 * assertion.
 *
 * So this file asserts BOTH: the response conforms to the contract (hard rule 6), AND the
 * four fields are non-empty, AND -- explicitly -- that the schema alone would not have caught
 * the second one. The third assertion is what stops the second from being deleted later as
 * redundant.
 */

const ORG = "org-f06-backflow";
const PROJECT = "proj-f06-backflow";
const OTHER_PROJECT = "proj-f06-backflow-2";
const AUTHOR = "u-f06b-author";
const OUTSIDER = "u-f06b-outsider";
/** In the project, but in a DIFFERENT team -- the I-13 probe. */
const OTHER_TEAM = "u-f06b-otherteam";

let h: Harness;
let app: NestExpressApplication;
let BASE: string;
let fx: Awaited<ReturnType<typeof seedOrg>>;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  h = await makeHarness("f06b");
  const { createApp } = await import("../../src/main");
  app = await createApp();
  // Port 0 -- the kernel assigns a free one. Deriving a port from a hash collides across
  // runs, which CI hit on its second run.
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await app?.close();
  await h?.close();
  if (h?.root) await rm(h.root, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetOrgs(ORG);
  fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await h.db.withTenant(toOrgId(ORG), (s) =>
    // F116: `kind` is NOT NULL with no default.
    s.query("INSERT INTO projects (id, org_id, name, kind) VALUES ($1,$2,$3,'workshop')", [
      OTHER_PROJECT, ORG, "second project",
    ]),
  );
  await addOrgMember(ORG, AUTHOR, "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, AUTHOR, "facilitator", null);
  await addProjectMember(ORG, OTHER_PROJECT, AUTHOR, "facilitator", null);
  await addOrgMember(ORG, OTHER_TEAM, "consultant", fx.teams.platform!);
  await addProjectMember(ORG, PROJECT, OTHER_TEAM, "facilitator", null);
  await addOrgMember(ORG, OUTSIDER, "consultant", fx.teams.platform!);
});

const org = () => toOrgId(ORG);
const listAs = (userId: string, projectId = PROJECT, stepId?: string) =>
  listBackflow(h.deps, { userId, orgId: org(), projectId, stepId });

const getBackflow = (userId: string, projectId = PROJECT, query = "") =>
  fetch(`${BASE}/projects/${projectId}/backflow${query}`, {
    headers: { "x-kernel-test-principal": `${userId}:${ORG}` },
  });

/** One live and one pinned binding on two steps of one project. */
async function seedTwoEntries() {
  const a = await seedArtifact(h, ORG, PROJECT, ["as it stood\n"], AUTHOR);
  const live = await bindToProjectStep(h.deps, {
    userId: AUTHOR, orgId: org(), artifactId: a.artifactId,
    projectId: PROJECT, stepId: "step-live", mode: "live",
  });
  const pinned = await bindToProjectStep(h.deps, {
    userId: AUTHOR, orgId: org(), artifactId: a.artifactId,
    projectId: PROJECT, stepId: "step-pinned", mode: "pinned",
    sourceVersionId: a.versionIds[0]!,
  });
  return { a, live, pinned };
}

/* ────────────────────────────────── V3 / AC3 ────────────────────────────────────────── */

describe("V3: every row carries mode / version / pinnedBy / pinnedAt, none of them empty", () => {
  it("both modes fill all four, from different places", async () => {
    const { pinned, live } = await seedTwoEntries();
    const rows = await listAs(AUTHOR);
    expect(rows).toHaveLength(2);

    for (const row of rows) {
      const parsed = C.BackflowEntry.safeParse(row);
      expect(parsed.success ? null : parsed.error.issues, JSON.stringify(row)).toBeNull();
      // The half the schema cannot make. Each of these is a question AC3 requires the project
      // side to answer, and `""` is a legal value of every one of them.
      expect(row.mode, "mode was empty").toBeTruthy();
      expect(row.version, "version was not a positive number").toBeGreaterThan(0);
      expect(row.pinnedBy, "pinnedBy was empty").toBeTruthy();
      expect(row.pinnedAt, "pinnedAt was empty").toBeTruthy();
      expect(new Date(row.pinnedAt).getTime(), "pinnedAt is not a date").not.toBeNaN();
      // The contract declares mode and badge separately; they must never disagree.
      expect(row.badge).toBe(row.mode);
    }

    expect(rows.find((r) => r.bindingId === pinned.id)!.mode).toBe("pinned");
    expect(rows.find((r) => r.bindingId === live.id)!.mode).toBe("live");
    // pinnedBy is the person who created the version, not the person who bound it -- these
    // are different roles in R3 and the list must report the definer.
    expect(rows[0]!.pinnedBy).toBe(AUTHOR);
  });

  it("the emptiness assertion above is NOT redundant: the schema accepts an all-empty row", () => {
    // Stated so that nobody later removes the `toBeTruthy` checks as "already covered by the
    // parse". This entry parses, renders, occupies a row, and says nothing.
    const hollow = {
      bindingId: "", artifactId: "", title: "", mode: "live" as const,
      version: 1, pinnedBy: "", pinnedAt: "", badge: "live" as const,
    };
    expect(C.BackflowEntry.safeParse(hollow).success).toBe(true);
  });

  it("the four fields track WHAT MOVED: live re-reads the head, pinned does not", async () => {
    const { a, live, pinned } = await seedTwoEntries();
    const before = await listAs(AUTHOR);
    const pinnedAtBefore = before.find((r) => r.bindingId === pinned.id)!.pinnedAt;

    await pinVersion(
      { store: h.store, repo: h.deps.artifacts, ids: h.ids, provenance: h.provenance },
      {
        orgId: org(), artifactId: a.artifactId, expectedHeadVersion: 1,
        source: "conversation", title: "a chat", actorId: "u-second-definer",
        parts: { "messages.jsonl": new TextEncoder().encode("rewritten\n") },
      },
    );

    const after = await listAs(AUTHOR);
    const liveRow = after.find((r) => r.bindingId === live.id)!;
    const pinnedRow = after.find((r) => r.bindingId === pinned.id)!;

    // All FOUR fields move for live, not just the number: whoever defined v2 is now the
    // definer the project side names. Asserting only `version` would pass for an
    // implementation that reports v2's number alongside v1's author.
    expect(liveRow.version).toBe(2);
    expect(liveRow.pinnedBy).toBe("u-second-definer");
    expect(liveRow.pinnedAt).not.toBe(pinnedAtBefore);

    // ...and none of them move for pinned.
    expect(pinnedRow.version).toBe(1);
    expect(pinnedRow.pinnedBy).toBe(AUTHOR);
    expect(pinnedRow.pinnedAt).toBe(pinnedAtBefore);
  });
});

/* ─────────────────────────────── empty state (V5) ───────────────────────────────────── */

describe("V5: an empty project returns [], and no invented rows", () => {
  it("empty is empty -- and the same call is non-empty once something is bound", async () => {
    expect(await listAs(AUTHOR, OTHER_PROJECT)).toEqual([]);
    // Counter-proof. Without it, `return []` passes this describe block entirely.
    await seedTwoEntries();
    expect(await listAs(AUTHOR)).toHaveLength(2);
    // ...and the OTHER project is still empty, so the non-empty result is not a global list.
    expect(await listAs(AUTHOR, OTHER_PROJECT)).toEqual([]);
  });

  it("stepId narrows to one step, and to nothing for a step with no bindings", async () => {
    const { pinned } = await seedTwoEntries();
    const narrowed = await listAs(AUTHOR, PROJECT, "step-pinned");
    expect(narrowed.map((r) => r.bindingId)).toEqual([pinned.id]);
    expect(await listAs(AUTHOR, PROJECT, "step-that-has-nothing")).toEqual([]);
  });
});

/* ──────────────────────────── permission on the way out ─────────────────────────────── */

describe("the list is a guarded read, not a SELECT with an org_id", () => {
  it("someone with no role in the project is refused", async () => {
    await seedTwoEntries();
    await expect(listAs(OUTSIDER)).rejects.toBeInstanceOf(NoProjectRoleError);
  });

  it("a team-only artifact's row does not reach another team, though the project role does", async () => {
    const { live } = await seedTwoEntries();
    const rows = await listAs(OTHER_TEAM);
    // Counter-proof FIRST, in the same test: unbound => org-wide, so this requester sees it.
    // Without this the assertion below is satisfied by a requester who sees nothing at all.
    expect(rows.map((r) => r.bindingId)).toContain(live.id);

    const artifactId = rows[0]!.artifactId;
    await addBinding({
      orgId: ORG,
      subject: { kind: "team", id: fx.teams.energy! },
      object: { kind: "artifact", id: artifactId },
      scope: "team-only",
      ownerTeamId: fx.teams.energy!,
    });

    // The requester is a facilitator in the project and in the WRONG team. R7: the scope on
    // the artifact reaches everything derived from it, and the backflow row carries its title.
    expect(await listAs(OTHER_TEAM)).toEqual([]);
    // ...and the owning team still sees it, so the scope narrowed rather than the list dying.
    expect((await listAs(AUTHOR)).map((r) => r.bindingId)).toContain(live.id);
  });

  it("gap: this does NOT assert I-13 propagation, because a binding has no ObjectRef kind", () => {
    // Measured, not argued. Emptying `sources` in `pg-binding-repository.ts` -- i.e. removing
    // the derivation entirely -- changes NO outcome above, because the row is named as its
    // own artifact and judged directly. The strictest-scope traversal I-13 is about is
    // collapsed, and it gives the same answer only because there is exactly one source.
    //
    // The cause is that `ObjectRef.kind` is closed over three members and none of them is a
    // binding, in the API contract and in `acl_bindings.object_kind` alike. A row cannot be
    // named as itself, so it is named as its original.
    //
    // Asserted rather than described: when a fourth kind arrives, this goes red and the
    // guarded read above should be revisited to traverse rather than collapse.
    const shape = (
      C.operations.bindToProjectStep.out as unknown as { shape: Record<string, unknown> }
    ).shape;
    expect(Object.keys(shape)).not.toContain("scope");
    const kinds = (
      identityContract.operations.authorize.in as unknown as {
        shape: { object: { shape: { kind: { options: string[] } } } };
      }
    ).shape.object.shape.kind.options;
    expect([...kinds].sort()).toEqual(["artifact", "project", "segment"]);
  });
});

/* ─────────────────────── the response is contract-validated (rule 6) ────────────────── */

describe("GET /projects/:projectId/backflow conforms to the contract", () => {
  it("the 200 body parses as listBackflow.out", async () => {
    await seedTwoEntries();
    const res = await getBackflow(AUTHOR);
    expect(res.status).toBe(200);
    const body = await res.json();
    const parsed = C.operations.listBackflow.out.safeParse(body);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(body)).toBeNull();
    expect((body as unknown[]).length).toBe(2);
  });

  it("the empty body parses too -- [] is a valid response, not an error", async () => {
    const body = await getBackflow(AUTHOR, OTHER_PROJECT).then((r) => r.json());
    expect(C.operations.listBackflow.out.safeParse(body).success).toBe(true);
    expect(body).toEqual([]);
  });

  it("stepId travels through the query string and is validated by the contract's `in`", async () => {
    const { pinned } = await seedTwoEntries();
    const body = await getBackflow(AUTHOR, PROJECT, "?stepId=step-pinned").then((r) => r.json());
    expect(C.operations.listBackflow.out.safeParse(body).success).toBe(true);
    expect((body as { bindingId: string }[]).map((r) => r.bindingId)).toEqual([pinned.id]);
  });

  it("the refusal path: no project role => 403 naming the layer, and no rows", async () => {
    await seedTwoEntries();
    const res = await getBackflow(OUTSIDER);
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("forbidden");
    expect(body.reasonCode).toBe("NO_PROJECT_ROLE");
    // The refusal carries no rows and no artifact ids -- a 403 that leaks the list is a 200.
    expect(JSON.stringify(body)).not.toContain("artifact");
  });

  it("counter-proof: the same schema REJECTS a drifted body", () => {
    // Without this, every parse above is satisfied by a schema that accepts anything, and
    // this whole describe block would be green against a server returning nonsense.
    const out = C.operations.listBackflow.out;
    expect(out.safeParse([{ bindingId: "b" }]).success).toBe(false);
    // The field most likely to be dropped by a repository row type -- exactly F01's defect.
    expect(
      out.safeParse([
        { bindingId: "b", artifactId: "a", title: "t", mode: "live", version: 1, pinnedBy: "u", badge: "live" },
      ]).success,
      "pinnedAt may be omitted",
    ).toBe(false);
    // A badge outside the closed enum must not pass.
    expect(
      out.safeParse([
        {
          bindingId: "b", artifactId: "a", title: "t", mode: "live", version: 1,
          pinnedBy: "u", pinnedAt: "2026-01-01T00:00:00.000Z", badge: "archived",
        },
      ]).success,
    ).toBe(false);
    // ...and version 0 -- the state a version-less artifact would produce if the bind path
    // ever stopped refusing it.
    expect(
      out.safeParse([
        {
          bindingId: "b", artifactId: "a", title: "t", mode: "live", version: 0,
          pinnedBy: "u", pinnedAt: "2026-01-01T00:00:00.000Z", badge: "live",
        },
      ]).success,
    ).toBe(false);
  });
});
