process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { artifact as C } from "@repo/contracts";
import {
  addOrgMember,
  addProjectMember,
  asApp,
  asOwner,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedAgendaSegment,
  seedOrg,
} from "../support/db";
import { makeHarness, seedArtifact, type Harness } from "../support/binding-fixture";
import { toOrgId } from "../../src/domain/org-id";
import { bindToProjectStep } from "../../src/application/artifact/bind-to-project-step";
import { upgradeBinding } from "../../src/application/artifact/upgrade-binding";
import { listBackflow } from "../../src/application/artifact/list-backflow";
import { VersionChangedError } from "../../src/application/artifact/pin-version";
import {
  CannotDowngradeError,
  ProjectRoleInsufficientError,
} from "../../src/application/artifact/binding-errors";

/**
 * F06 -- A2/A3: live may be upgraded to pinned; pinned may never go back (I-11 / I-8).
 *
 * ## Every refusal is asserted from BOTH sides
 *
 * A rule that only exists in a use case holds until the second use case, and a rule that only
 * exists on UPDATE is bypassed by DELETE-then-INSERT. 0007 is this project's recorded example:
 * `REVOKE DELETE ON artifact_versions` was real, was tested, and guarded a door next to an
 * open one -- `DELETE FROM artifacts` cascaded straight through it, with every immutability
 * test green.
 *
 * So each prohibition below is exercised through the use case AND directly against the
 * database, and each is paired with the permitted neighbour that proves the mechanism is not
 * simply refusing everything.
 */

const ORG = "org-f06-upgrade";
const PROJECT = "proj-f06-upgrade";
const STEP = "f06u-step-synthesis";
const AUTHOR = "u-f06u-author";
const MEMBER = "u-f06u-member";

let h: Harness;
let app: NestExpressApplication;
let BASE: string;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  h = await makeHarness("f06u");
  const { createApp } = await import("../../src/main");
  app = await createApp();
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
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, AUTHOR, "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, AUTHOR, "facilitator", null);
  await addOrgMember(ORG, MEMBER, "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, MEMBER, "member", null);

  // F118: artifact_bindings.agenda_segment_id now has a composite FK into agenda_segments. This file's
  // stepIds are opaque labels for "which step" a binding targets -- seed a real row for each
  // literal used anywhere below (note: "somewhere-else" at line ~250 is deliberately NOT
  // seeded -- that assertion tests that re-targeting is refused by the BEFORE-UPDATE trigger
  // before the FK is ever consulted, and seeding it would silently change what is proven).
  for (const step of [
    STEP, "f06u-step-a", "f06u-step-b", "f06u-step-live", "f06u-step-pin", "f06u-step-raise", "f06u-step-draft",
  ]) {
    await seedAgendaSegment(ORG, PROJECT, step);
  }
});

const org = () => toOrgId(ORG);

const bind = (mode: "draft" | "live" | "pinned", agendaSegmentId: string, sourceVersionId?: string, artifactId?: string) =>
  bindToProjectStep(h.deps, {
    userId: AUTHOR, orgId: org(), artifactId: artifactId!, projectId: PROJECT,
    agendaSegmentId, mode, sourceVersionId,
  });

const post = (path: string, body: unknown, userId = AUTHOR) =>
  fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "x-kernel-test-principal": `${userId}:${ORG}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const modeOf = (bindingId: string) =>
  asOwner(async (c) => {
    const r = await c.query<{ mode: string; pinned_version_id: string | null }>(
      `SELECT mode, pinned_version_id FROM artifact_bindings WHERE id = $1`,
      [bindingId],
    );
    return r.rows[0] ?? null;
  });

/* ──────────────────────────────── A2: upgrades work ─────────────────────────────────── */

describe("A2: an upgrade really upgrades", () => {
  it("live -> pinned freezes at the head the caller declared, and the badge changes", async () => {
    const a = await seedArtifact(h, ORG, PROJECT, ["v1\n", "v2\n"], AUTHOR);
    const live = await bind("live", STEP, undefined, a.artifactId);
    expect((await listBackflow(h.deps, { userId: AUTHOR, orgId: org(), projectId: PROJECT }))[0]!.badge)
      .toBe("live");

    const pinned = await upgradeBinding(h.deps, {
      userId: AUTHOR, orgId: org(), bindingId: live.id, expectedHeadVersion: 2,
    });

    expect(pinned.id).toBe(live.id);
    expect(pinned.mode).toBe("pinned");
    // The head at the moment of upgrade -- v2 -- not v1 and not a newly minted v3. See the
    // module header on `upgrade-binding.ts`: A2's prose says a new version is minted, and the
    // contract's `in` carries no content with which to mint one.
    expect(pinned.pinnedVersionId).toBe(a.versionIds[1]);
    expect(await modeOf(live.id)).toEqual({ mode: "pinned", pinned_version_id: a.versionIds[1] });

    const rows = await listBackflow(h.deps, { userId: AUTHOR, orgId: org(), projectId: PROJECT });
    expect(rows[0]!.badge).toBe("pinned");
    expect(rows[0]!.version).toBe(2);
  });

  it("draft -> pinned is also an upgrade, and draft -> live is the only way to publish", async () => {
    const a = await seedArtifact(h, ORG, PROJECT, ["v1\n"], AUTHOR);

    const draft = await bind("draft", "f06u-step-a", undefined, a.artifactId);
    const nowPinned = await upgradeBinding(h.deps, {
      userId: AUTHOR, orgId: org(), bindingId: draft.id, expectedHeadVersion: 1,
    });
    expect(nowPinned.mode).toBe("pinned");

    // `usecases.md` has no draft -> live operation at all: `upgradeBinding` always produces
    // `pinned`. So publishing a draft as a live reference has exactly one home, and it is
    // `bindToProjectStep` re-binding the same step.
    const b = await seedArtifact(h, ORG, PROJECT, ["v1\n"], AUTHOR);
    const draft2 = await bind("draft", "f06u-step-b", undefined, b.artifactId);
    const live = await bind("live", "f06u-step-b", undefined, b.artifactId);
    expect(live.id).toBe(draft2.id);
    expect(live.mode).toBe("live");
  });

  it("a plain member may not upgrade, though the binding is right there", async () => {
    const a = await seedArtifact(h, ORG, PROJECT, ["v1\n"], AUTHOR);
    const live = await bind("live", STEP, undefined, a.artifactId);
    await expect(
      upgradeBinding(h.deps, { userId: MEMBER, orgId: org(), bindingId: live.id, expectedHeadVersion: 1 }),
    ).rejects.toBeInstanceOf(ProjectRoleInsufficientError);
    expect((await modeOf(live.id))!.mode).toBe("live");
  });
});

/* ─────────────────────── expectedHeadVersion does real work ─────────────────────────── */

describe("E4/V6: upgrading against a stale head is refused, not silently retargeted", () => {
  it("a caller that thinks the head is 1 while it is 2 gets VERSION_CHANGED and nothing moves", async () => {
    const a = await seedArtifact(h, ORG, PROJECT, ["v1\n", "v2\n"], AUTHOR);
    const live = await bind("live", STEP, undefined, a.artifactId);

    await expect(
      upgradeBinding(h.deps, { userId: AUTHOR, orgId: org(), bindingId: live.id, expectedHeadVersion: 1 }),
    ).rejects.toBeInstanceOf(VersionChangedError);
    // The binding is untouched -- a refusal that half-applied would be worse than none.
    expect(await modeOf(live.id)).toEqual({ mode: "live", pinned_version_id: null });

    // Counter-proof: with the true head it succeeds, so the refusal is about staleness and
    // not about upgrades being broken.
    const ok = await upgradeBinding(h.deps, {
      userId: AUTHOR, orgId: org(), bindingId: live.id, expectedHeadVersion: 2,
    });
    expect(ok.pinnedVersionId).toBe(a.versionIds[1]);
  });
});

/* ────────────────────────────── A3: no downgrade, any route ─────────────────────────── */

describe("A3 / I-11: a pinned binding never goes back", () => {
  it("pinned -> live and pinned -> draft are refused through the bind path", async () => {
    const a = await seedArtifact(h, ORG, PROJECT, ["v1\n"], AUTHOR);
    const pinned = await bind("pinned", STEP, a.versionIds[0], a.artifactId);

    for (const mode of ["live", "draft"] as const) {
      await expect(
        bind(mode, STEP, undefined, a.artifactId),
        `pinned -> ${mode} was allowed`,
      ).rejects.toBeInstanceOf(CannotDowngradeError);
    }
    expect((await modeOf(pinned.id))!.mode).toBe("pinned");
  });

  it("live -> draft is refused too, and so is re-pointing a pinned binding at a newer version", async () => {
    const a = await seedArtifact(h, ORG, PROJECT, ["v1\n", "v2\n"], AUTHOR);

    const live = await bind("live", "f06u-step-live", undefined, a.artifactId);
    await expect(bind("draft", "f06u-step-live", undefined, a.artifactId)).rejects.toBeInstanceOf(
      CannotDowngradeError,
    );
    expect((await modeOf(live.id))!.mode).toBe("live");

    // The case a rank comparison cannot see: same mode, same rank, and the citation moves.
    const pinned = await bind("pinned", "f06u-step-pin", a.versionIds[0], a.artifactId);
    await expect(bind("pinned", "f06u-step-pin", a.versionIds[1], a.artifactId)).rejects.toBeInstanceOf(
      CannotDowngradeError,
    );
    expect((await modeOf(pinned.id))!.pinned_version_id).toBe(a.versionIds[0]);

    // ...and upgradeBinding cannot re-point it either, which is the ONLY reachable route to
    // `CANNOT_DOWNGRADE` from that operation -- its input carries no mode. Reported: the code's
    // name does not describe this case.
    await expect(
      upgradeBinding(h.deps, { userId: AUTHOR, orgId: org(), bindingId: pinned.id, expectedHeadVersion: 2 }),
    ).rejects.toBeInstanceOf(CannotDowngradeError);
  });

  it("the DATABASE refuses a downgrade even when the use case is skipped entirely", async () => {
    // Every assertion above goes through `bindToProjectStep`. If the rule lived only there,
    // all of them would stay green while a second writer -- a migration, a repair script, the
    // next use case -- walked straight past it.
    const a = await seedArtifact(h, ORG, PROJECT, ["v1\n", "v2\n"], AUTHOR);
    const pinned = await bind("pinned", STEP, a.versionIds[0], a.artifactId);

    await expect(
      asApp(ORG, (c) =>
        c.query(
          `UPDATE artifact_bindings SET mode='live', pinned_version_id=NULL WHERE id=$1`,
          [pinned.id],
        ),
      ),
    ).rejects.toThrow(/CANNOT_DOWNGRADE/);

    await expect(
      asApp(ORG, (c) =>
        c.query(`UPDATE artifact_bindings SET pinned_version_id=$2 WHERE id=$1`, [
          pinned.id, a.versionIds[1],
        ]),
      ),
    ).rejects.toThrow(/CANNOT_DOWNGRADE/);

    // ...and re-targeting the binding at a different step, which would keep the id an audit
    // trail recorded while changing what it refers to.
    await expect(
      asApp(ORG, (c) =>
        c.query(`UPDATE artifact_bindings SET agenda_segment_id='somewhere-else' WHERE id=$1`, [pinned.id]),
      ),
    ).rejects.toThrow(/cannot be re-targeted/);

    // Counter-proof: an UPDATE that RAISES the mode passes the same trigger. Without this,
    // a trigger that raised on every UPDATE would look identical.
    const live = await bind("live", "f06u-step-raise", undefined, a.artifactId);
    await asApp(ORG, (c) =>
      c.query(`UPDATE artifact_bindings SET mode='pinned', pinned_version_id=$2 WHERE id=$1`, [
        live.id, a.versionIds[0],
      ]),
    );
    expect((await modeOf(live.id))!.mode).toBe("pinned");
  });

  it("DELETE is the same downgrade spelled differently, and it is refused as one", async () => {
    // 0007's lesson, applied before it can be learned again. Delete the pinned binding,
    // re-insert it as live, and the project side goes from 已定版 v1 to 实时·随源变动 with
    // every UPDATE-side assertion above still green.
    const a = await seedArtifact(h, ORG, PROJECT, ["v1\n"], AUTHOR);
    const pinned = await bind("pinned", STEP, a.versionIds[0], a.artifactId);

    // The runtime role holds no DELETE on this table at all -- the first of the two locks.
    await expect(
      asApp(ORG, (c) => c.query(`DELETE FROM artifact_bindings WHERE id = $1`, [pinned.id])),
    ).rejects.toThrow(/permission denied/i);

    // ...and the OWNER is refused too, which is the lock that matters: a REVOKE leaves
    // "fix it by hand in prod" available, and that is how immutable records actually move.
    await expect(
      asOwner((c) => c.query(`DELETE FROM artifact_bindings WHERE id = $1`, [pinned.id])),
    ).rejects.toThrow(/CANNOT_DOWNGRADE/);

    // Cascade counts as an interface (this is exactly what 0007 found): deleting the project
    // reaches the row through ON DELETE CASCADE and must be refused for the same reason.
    await expect(
      asOwner((c) => c.query(`DELETE FROM projects WHERE id = $1`, [PROJECT])),
    ).rejects.toThrow(/CANNOT_DOWNGRADE/);

    // Counter-proof one: a DRAFT binding is not a citation, and deleting it is allowed --
    // so the trigger discriminates rather than refusing everything.
    const b = await seedArtifact(h, ORG, PROJECT, ["v1\n"], AUTHOR);
    const draft = await bind("draft", "f06u-step-draft", undefined, b.artifactId);
    await asOwner((c) => c.query(`DELETE FROM artifact_bindings WHERE id = $1`, [draft.id]));
    expect(await modeOf(draft.id)).toBeNull();

    // Counter-proof two: tenant teardown still works. If the discriminator answered "not a
    // teardown" to everything, this would hang the whole suite's cleanup -- and if it
    // answered "teardown" to everything, the three refusals above would not have fired.
    await asOwner((c) => c.query(`DELETE FROM organizations WHERE id = $1`, [ORG]));
    const left = await asOwner(async (c) => {
      const r = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM artifact_bindings WHERE org_id = $1`,
        [ORG],
      );
      return r.rows[0]!.n;
    });
    expect(left).toBe("0");
  });
});

/* ─────────────────────── the routes, and their contract-validated bodies ────────────── */

describe("POST /artifacts/:id/bindings and .../upgrade conform to the contract", () => {
  it("a successful bind and a successful upgrade both return a contract-valid Binding", async () => {
    const a = await seedArtifact(h, ORG, PROJECT, ["v1\n"], AUTHOR);

    const bindRes = await post(`/artifacts/${a.artifactId}/bindings`, {
      artifactId: a.artifactId, projectId: PROJECT, agendaSegmentId: STEP, mode: "live",
    });
    expect(bindRes.status).toBe(201);
    const bound = await bindRes.json();
    const p1 = C.operations.bindToProjectStep.out.safeParse(bound);
    expect(p1.success ? null : p1.error.issues, JSON.stringify(bound)).toBeNull();
    expect((bound as { mode: string }).mode).toBe("live");

    const upRes = await post(
      `/artifacts/bindings/${(bound as { id: string }).id}/upgrade`,
      { bindingId: (bound as { id: string }).id, expectedHeadVersion: 1 },
    );
    expect(upRes.status).toBe(201);
    const upgraded = await upRes.json();
    const p2 = C.operations.upgradeBinding.out.safeParse(upgraded);
    expect(p2.success ? null : p2.error.issues, JSON.stringify(upgraded)).toBeNull();
    expect((upgraded as { mode: string }).mode).toBe("pinned");
    expect((upgraded as { pinnedVersionId: string }).pinnedVersionId).toBe(a.versionIds[0]);
  });

  it("the refusal paths: 409 for a downgrade, 409 for a stale head, 403 for a member, 404 for nothing", async () => {
    const a = await seedArtifact(h, ORG, PROJECT, ["v1\n", "v2\n"], AUTHOR);
    const pinned = await bind("pinned", STEP, a.versionIds[0], a.artifactId);

    const down = await post(`/artifacts/${a.artifactId}/bindings`, {
      artifactId: a.artifactId, projectId: PROJECT, agendaSegmentId: STEP, mode: "live",
    });
    expect(down.status).toBe(409);
    expect(((await down.json()) as { error: string }).error).toBe("conflict");

    const live = await bind("live", "f06u-step-live", undefined, a.artifactId);
    const stale = await post(`/artifacts/bindings/${live.id}/upgrade`, {
      bindingId: live.id, expectedHeadVersion: 1,
    });
    expect(stale.status).toBe(409);

    const asMember = await post(
      `/artifacts/bindings/${live.id}/upgrade`,
      { bindingId: live.id, expectedHeadVersion: 2 },
      MEMBER,
    );
    expect(asMember.status).toBe(403);
    expect(((await asMember.json()) as { reasonCode: string }).reasonCode).toBe(
      "PROJECT_ROLE_INSUFFICIENT",
    );

    const missing = await post(`/artifacts/bindings/no-such-binding/upgrade`, {
      bindingId: "no-such-binding", expectedHeadVersion: 1,
    });
    expect(missing.status).toBe(404);

    // Nothing moved through any of the four refusals.
    expect((await modeOf(pinned.id))!.pinned_version_id).toBe(a.versionIds[0]);
    expect((await modeOf(live.id))!.mode).toBe("live");
  });

  it("a request body the contract rejects never reaches the use case", async () => {
    const a = await seedArtifact(h, ORG, PROJECT, ["v1\n"], AUTHOR);
    const res = await post(`/artifacts/${a.artifactId}/bindings`, {
      artifactId: a.artifactId, projectId: PROJECT, agendaSegmentId: STEP, mode: "archived",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; fields: { path: string }[] };
    expect(body.error).toBe("validation_failed");
    expect(body.fields.map((f) => f.path)).toContain("mode");
    // ...and nothing was written by the rejected request.
    const rows = await listBackflow(h.deps, { userId: AUTHOR, orgId: org(), projectId: PROJECT });
    expect(rows).toEqual([]);
  });

  it("counter-proof: the response schemas REJECT a drifted Binding", () => {
    const out = C.operations.bindToProjectStep.out;
    expect(out.safeParse({ id: "b" }).success).toBe(false);
    // `pinnedVersionId` is nullable, not optional -- a repository row type that drops it is
    // precisely the F01 defect, and it would be invisible without this.
    expect(
      out.safeParse({ id: "b", artifactId: "a", projectId: "p", agendaSegmentId: "s", mode: "live" }).success,
    ).toBe(false);
    expect(
      out.safeParse({
        id: "b", artifactId: "a", projectId: "p", agendaSegmentId: "s", mode: "archived",
        pinnedVersionId: null,
      }).success,
    ).toBe(false);
  });
});

/* ──────────────────────────── contract gaps, asserted ──────────────────────────────── */

describe("what the contract cannot say about downgrades", () => {
  it("the reachable downgrade is bindToProjectStep, and its `err` list has no CANNOT_DOWNGRADE", () => {
    // The refusal is implemented and returns 409; there is no contract code to name it with.
    // When the contract gains one, this goes red and points at the mapping in the controller.
    expect([...C.operations.bindToProjectStep.err]).not.toContain("CANNOT_DOWNGRADE");
    expect([...C.operations.upgradeBinding.err]).toContain("CANNOT_DOWNGRADE");
  });

  it("`upgradeBinding.in` carries no mode, so it cannot express a downgrade to refuse", () => {
    // Which is why the only reachable meaning of its `CANNOT_DOWNGRADE` is "this binding is
    // already pinned" -- a case the code's name does not describe.
    const shape = Object.keys(
      (C.operations.upgradeBinding.in as unknown as { shape: Record<string, unknown> }).shape,
    ).sort();
    expect(shape).toEqual(["bindingId", "expectedHeadVersion"]);
  });
});
