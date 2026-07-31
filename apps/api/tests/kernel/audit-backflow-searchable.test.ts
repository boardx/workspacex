import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { provenance as P } from "@repo/contracts";
import {
  addOrgMember,
  addProjectMember,
  asApp,
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
import { withdrawEvidence } from "../../src/application/artifact/withdraw-evidence";
import {
  CannotDowngradeError,
  ProjectRoleInsufficientError,
} from "../../src/application/artifact/binding-errors";
import { queryProvenance } from "../../src/application/provenance/query-provenance";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgArtifactRepository } from "../../src/infrastructure/artifact/pg-artifact-repository";

/**
 * F08 obligation 2 -- R12 V7 / V8 / E5.
 *
 *   V7  每次定版与绑定可按操作者、时间、Artifact、模式检索；越权尝试也有安全审计
 *   V8  任何接口试图修改/删除已定版快照全被拒 **并记录审计**
 *   E5  证据撤回不改快照，改为在引用处标注，并通知拍板人复核
 *
 * ## What this file refuses to accept as a pass
 *
 * "An event row exists" is the assertion that passes against a system whose trail is
 * unreadable, and "the query returned something" is the one that passes against a trail
 * where every event looks the same. So each retrieval axis V7 names is asserted by
 * SEPARATING two events that differ only along that axis -- two actors, two moments, two
 * artifacts, two modes -- and requiring the filter to return one and not the other. A
 * filter that ignored its argument would return both and go red.
 *
 * The refusal half is asserted the same way and one step further: a refused attempt must
 * leave a record AND the response must not reveal whether the thing refused exists. Those
 * two pull in opposite directions, which is why they are asserted together, over HTTP,
 * comparing two responses byte for byte.
 */

const ORG = "org-f08-search";
const PROJECT = "proj-f08-search";
const STEP = "f08s-step-discovery";
const AUTHOR = "u-f08-author";
const SECOND = "u-f08-second";
const MEMBER = "u-f08-member";
const LEAD = "u-f08-lead";

let h: Harness;
let app: NestExpressApplication;
let BASE: string;

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const org = () => toOrgId(ORG);

/** The audit trail as the lead sees it -- through the shared query surface, never raw SQL. */
async function trail(
  filter: Parameters<typeof queryProvenance>[1]["filter"],
  requesterId = LEAD,
) {
  return queryProvenance(
    { repo: new PgIdentityRepository(h.db), reader: h.provenance },
    { requesterId, orgId: org(), filter },
  );
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  h = await makeHarness("f08s");
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
  await resetOrgs(ORG);
});

beforeEach(async () => {
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  // Roles from the SIGNED identity matrix: facilitator/groupLead hold `group.submitOutput`,
  // member and observer do not (R5: 组员不可定版).
  await addOrgMember(ORG, AUTHOR, "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, AUTHOR, "facilitator", null);
  await addOrgMember(ORG, SECOND, "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, SECOND, "groupLead", null);
  await addOrgMember(ORG, MEMBER, "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, MEMBER, "member", null);
  // `lead` is 「项目负责人」 in this ontology (UC-0.3 R5) and is who may read the trail.
  await addOrgMember(ORG, LEAD, "lead", fx.teams.energy!);

  // F118: artifact_bindings.agenda_segment_id now has a composite FK into agenda_segments. This file
  // is about the provenance/audit trail, not segment lifecycle.
  await seedAgendaSegment(ORG, PROJECT, STEP);
  await seedAgendaSegment(ORG, PROJECT, "f08s-step-other");
});

/* ───────────────────────── V7: 定版与绑定都留痕，且可检索 ───────────────────────── */

describe("V7: every pin and every bind is retrievable", () => {
  it("a bind writes `bound`, an upgrade writes `pinned`, and the mode is in the record", async () => {
    const a = await seedArtifact(h, ORG, PROJECT, ["v1\n"], AUTHOR);
    const b = await bindToProjectStep(h.deps, {
      userId: AUTHOR, orgId: org(), artifactId: a.artifactId,
      projectId: PROJECT, agendaSegmentId: STEP, mode: "live",
    });
    await upgradeBinding(h.deps, {
      userId: SECOND, orgId: org(), bindingId: b.id, expectedHeadVersion: 1,
    });

    const page = await trail({ targetKind: "artifact", targetId: a.artifactId });
    const types = page.events.map((e) => e.type);
    expect(types).toContain("bound");
    expect(types).toContain("pinned");

    const bound = page.events.find((e) => e.type === "bound")!;
    // 「模式」 is one of V7's four retrieval axes. It is in `detail` because the shared
    // query surface has no `mode` filter -- reported as a contract defect (usecases.md
    // declares one, provenance.ts dropped it when the two bundles merged). Asserting the
    // field is present is what makes the defect a known gap rather than a silent one.
    expect((bound.detail as { mode: string }).mode).toBe("live");
    expect(bound.actorId).toBe(AUTHOR);

    const pinned = page.events.find((e) => e.type === "pinned")!;
    expect((pinned.detail as { mode: string }).mode).toBe("pinned");
    expect((pinned.detail as { previousMode: string }).previousMode).toBe("live");
    // The upgrade was performed by SECOND, not AUTHOR. If the writer had recorded "whoever
    // created the binding" this would still name AUTHOR and read as correct.
    expect(pinned.actorId).toBe(SECOND);

    // The page conforms to the SHARED contract, not to something this bundle invented.
    expect(P.operations.queryProvenance.out.safeParse(page).success).toBe(true);
  });

  it("by ARTIFACT: two artifacts, and the filter returns one of them", async () => {
    const a = await seedArtifact(h, ORG, PROJECT, ["a\n"], AUTHOR);
    const other = await seedArtifact(h, ORG, PROJECT, ["b\n"], AUTHOR);
    for (const art of [a, other]) {
      await bindToProjectStep(h.deps, {
        userId: AUTHOR, orgId: org(), artifactId: art.artifactId,
        projectId: PROJECT, agendaSegmentId: STEP, mode: "live",
      });
    }
    const page = await trail({ targetKind: "artifact", targetId: a.artifactId });
    expect(page.events.length).toBeGreaterThan(0);
    // Not "contains a" -- "contains ONLY a". The version that matters.
    expect(page.events.every((e) => e.target.id === a.artifactId)).toBe(true);
  });

  it("by OPERATOR: two actors on the SAME artifact, and the filter separates them", async () => {
    const a = await seedArtifact(h, ORG, PROJECT, ["v1\n"], AUTHOR);
    const b = await bindToProjectStep(h.deps, {
      userId: AUTHOR, orgId: org(), artifactId: a.artifactId,
      projectId: PROJECT, agendaSegmentId: STEP, mode: "live",
    });
    await upgradeBinding(h.deps, {
      userId: SECOND, orgId: org(), bindingId: b.id, expectedHeadVersion: 1,
    });

    const mine = await trail({ targetId: a.artifactId, targetKind: "artifact", actorId: SECOND });
    expect(mine.events).toHaveLength(1);
    expect(mine.events[0]!.type).toBe("pinned");
  });

  it("by TIME: a window that starts after the first event excludes it", async () => {
    const a = await seedArtifact(h, ORG, PROJECT, ["v1\n"], AUTHOR);
    const b = await bindToProjectStep(h.deps, {
      userId: AUTHOR, orgId: org(), artifactId: a.artifactId,
      projectId: PROJECT, agendaSegmentId: STEP, mode: "live",
    });
    const all = await trail({ targetKind: "artifact", targetId: a.artifactId });
    const boundAt = all.events.find((e) => e.type === "bound")!.at;

    await upgradeBinding(h.deps, {
      userId: SECOND, orgId: org(), bindingId: b.id, expectedHeadVersion: 1,
    });

    // Strictly after the bind. `now()` inside one transaction is fixed, so two events in the
    // same statement share a timestamp -- these are two separate calls, so they do not.
    const after = new Date(new Date(boundAt).getTime() + 1).toISOString();
    const later = await trail({ targetKind: "artifact", targetId: a.artifactId, since: after });
    expect(later.events.map((e) => e.type)).toEqual(["pinned"]);

    const earlier = await trail({ targetKind: "artifact", targetId: a.artifactId, until: boundAt });
    expect(earlier.events.map((e) => e.type)).toEqual(["bound"]);
  });

  it("by TYPE: `types` isolates the security audit from the lineage", async () => {
    const a = await seedArtifact(h, ORG, PROJECT, ["v1\n"], AUTHOR);
    await bindToProjectStep(h.deps, {
      userId: AUTHOR, orgId: org(), artifactId: a.artifactId,
      projectId: PROJECT, agendaSegmentId: STEP, mode: "live",
    });
    await expect(
      bindToProjectStep(h.deps, {
        userId: MEMBER, orgId: org(), artifactId: a.artifactId,
        projectId: PROJECT, agendaSegmentId: STEP, mode: "live",
      }),
    ).rejects.toBeInstanceOf(ProjectRoleInsufficientError);

    const security = await trail({ types: ["unauthorized-attempt"] });
    expect(security.events).toHaveLength(1);
    expect(security.events[0]!.actorId).toBe(MEMBER);
    // ...and the lineage query does NOT return it, which is the half that fails if `types`
    // is ignored: a filter that returns everything satisfies the assertion above.
    const lineage = await trail({ types: ["bound", "pinned"] });
    expect(lineage.events.every((e) => e.type !== "unauthorized-attempt")).toBe(true);
  });

  it("a pin through `pinVersion` is on the trail too, not only a binding upgrade", async () => {
    // `seedArtifact` pins v2 through the real `pinVersion`. Without this the whole file
    // could pass while 定版 itself -- V7's first word -- left no record.
    const a = await seedArtifact(h, ORG, PROJECT, ["v1\n", "v2\n"], AUTHOR);
    const page = await trail({ targetKind: "artifact", targetId: a.artifactId, types: ["pinned"] });
    expect(page.events).toHaveLength(1);
    expect((page.events[0]!.detail as { versionNumber: number }).versionNumber).toBe(2);
    expect((page.events[0]!.detail as { versionId: string }).versionId).toBe(a.versionIds[1]);
  });
});

/* ──────────────── V8 + 防枚举: 越权尝试留痕，且响应不泄露存在性 ──────────────── */

describe("V7/V8: a refused attempt is recorded, and reveals nothing", () => {
  it("re-binding a PINNED binding as live is refused AND audited", async () => {
    const a = await seedArtifact(h, ORG, PROJECT, ["v1\n"], AUTHOR);
    await bindToProjectStep(h.deps, {
      userId: AUTHOR, orgId: org(), artifactId: a.artifactId, projectId: PROJECT,
      agendaSegmentId: STEP, mode: "pinned", sourceVersionId: a.versionIds[0],
    });
    await expect(
      bindToProjectStep(h.deps, {
        userId: AUTHOR, orgId: org(), artifactId: a.artifactId,
        projectId: PROJECT, agendaSegmentId: STEP, mode: "live",
      }),
    ).rejects.toBeInstanceOf(CannotDowngradeError);

    const page = await trail({ types: ["unauthorized-attempt"] });
    expect(page.events).toHaveLength(1);
    // The actor HAD the role. A security trail that only records role failures misses every
    // attempt by an insider who has one -- and V8 is about exactly those attempts.
    expect(page.events[0]!.actorId).toBe(AUTHOR);
    expect((page.events[0]!.detail as { reasonCode: string }).reasonCode).toBe("CANNOT_DOWNGRADE");
  });

  /**
   * The anti-enumeration assertion, and it is asserted over HTTP because it is a claim about
   * the RESPONSE, not about a thrown error.
   *
   * Two requests from the same unauthorised caller: one names an artifact that exists, one
   * names an id that does not. If they differ in status, in body, or in which of them leaves
   * a trail, the endpoint is an oracle for "which ids are real" -- and the audit requirement
   * would have created that oracle, which is why the two are asserted together.
   */
  it("refusing an EXISTING artifact and a NONEXISTENT one look identical -- and both are audited", async () => {
    const a = await seedArtifact(h, ORG, PROJECT, ["v1\n"], AUTHOR);
    const ghost = "art-does-not-exist-f08";

    const post = async (artifactId: string) =>
      fetch(`${BASE}/artifacts/${artifactId}/bindings`, {
        method: "POST",
        headers: {
          "x-kernel-test-principal": `${MEMBER}:${ORG}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ artifactId, projectId: PROJECT, agendaSegmentId: STEP, mode: "live" }),
      });

    const real = await post(a.artifactId);
    const fake = await post(ghost);
    expect(real.status).toBe(fake.status);
    // `traceId` is per-request and carries nothing about the resource, so it is the one
    // field allowed to differ. Stripped explicitly rather than by comparing a subset of
    // keys: if a future field appears it must be compared, not silently ignored.
    const scrub = async (r: Response) => {
      const b = (await r.json()) as Record<string, unknown>;
      expect(typeof b.traceId, "every refusal is still traceable server-side").toBe("string");
      delete b.traceId;
      return JSON.stringify(b);
    };
    expect(await scrub(real)).toBe(await scrub(fake));
    // ...and it is a refusal, not two identical 200s. Without this the assertion above is
    // satisfied by an endpoint that allows everything.
    expect(real.status).toBe(403);

    const page = await trail({ types: ["unauthorized-attempt"], actorId: MEMBER });
    const targets = page.events.map((e) => e.target.id).sort();
    // BOTH recorded, including the one that does not exist. Auditing only real targets makes
    // "was it audited" a second channel for the same secret.
    expect(targets).toEqual([a.artifactId, ghost].sort());
  });
});

/* ─────────────────────────── E5: 证据撤回 ─────────────────────────── */

describe("E5: withdrawing evidence annotates and notifies, and never touches the snapshot", () => {
  const withdraw = (versionId: string, actorId = LEAD, reason = "上游访谈被受访者撤回") =>
    withdrawEvidence(
      {
        artifacts: new PgArtifactRepository(h.db),
        bindings: h.deps.bindings,
        identity: new PgIdentityRepository(h.db),
        provenance: h.provenance,
        notifier: h.provenance,
      },
      { orgId: org(), actorId, versionId, reason },
    );

  it("the snapshot is byte-identical before and after", async () => {
    const a = await seedArtifact(h, ORG, PROJECT, ["v1\n"], AUTHOR);
    const repo = new PgArtifactRepository(h.db);
    const before = await repo.findVersion(org(), a.versionIds[0]!);
    // Without this the whole test is vacuous: two nulls are deeply equal, so a lookup that
    // found nothing would prove the snapshot unchanged by never reading it.
    expect(before).not.toBeNull();
    await withdraw(a.versionIds[0]!);
    const after = await repo.findVersion(org(), a.versionIds[0]!);
    // The whole record, not just the hash: a `withdrawn` column added later would show up
    // here as a difference, which is the point -- I-1 says the version does not change.
    expect(after).toEqual(before);
  });

  it("the citing bindings are the annotated references, and live bindings are not", async () => {
    const a = await seedArtifact(h, ORG, PROJECT, ["v1\n"], AUTHOR);
    const cited = await bindToProjectStep(h.deps, {
      userId: AUTHOR, orgId: org(), artifactId: a.artifactId, projectId: PROJECT,
      agendaSegmentId: STEP, mode: "pinned", sourceVersionId: a.versionIds[0],
    });
    // A live binding on the same artifact. It does not CITE the version -- it resolves to
    // the head -- so annotating it would mark a reference that never rested on this evidence.
    const live = await bindToProjectStep(h.deps, {
      userId: SECOND, orgId: org(), artifactId: a.artifactId, projectId: PROJECT,
      agendaSegmentId: "f08s-step-other", mode: "live",
    });

    const r = await withdraw(a.versionIds[0]!);
    expect(r.annotatedReferences).toEqual([cited.id]);
    expect(r.annotatedReferences).not.toContain(live.id);
  });

  it("the approvers are told -- and 'told' means a row, not a returned list", async () => {
    const a = await seedArtifact(h, ORG, PROJECT, ["v1\n"], AUTHOR);
    await bindToProjectStep(h.deps, {
      userId: SECOND, orgId: org(), artifactId: a.artifactId, projectId: PROJECT,
      agendaSegmentId: STEP, mode: "pinned", sourceVersionId: a.versionIds[0],
    });

    const r = await withdraw(a.versionIds[0]!);
    // SECOND created the citation; AUTHOR pinned the bytes. Both have to review.
    expect([...r.notifiedApprovers].sort()).toEqual([AUTHOR, SECOND].sort());

    const rows = await asApp(ORG, async (c) => {
      const q = await c.query<{ recipient_id: string; provenance_event_id: string }>(
        `SELECT recipient_id, provenance_event_id FROM provenance_notifications ORDER BY recipient_id`,
      );
      return q.rows;
    });
    expect(rows.map((x) => x.recipient_id)).toEqual([AUTHOR, SECOND].sort());
    // Every notice points AT the event, so "why was I told" is one join and not a copy.
    expect(new Set(rows.map((x) => x.provenance_event_id))).toEqual(
      new Set([r.provenanceEventId]),
    );
  });

  it("the withdrawal is on the trail, found BY VERSION -- which is what a reference site asks", async () => {
    const a = await seedArtifact(h, ORG, PROJECT, ["v1\n", "v2\n"], AUTHOR);
    const r = await withdraw(a.versionIds[0]!);

    const page = await trail({ targetKind: "artifact-version", targetId: a.versionIds[0]! });
    expect(page.events).toHaveLength(1);
    expect(page.events[0]!.id).toBe(r.provenanceEventId);
    expect(page.events[0]!.type).toBe("evidence-withdrawn");
    expect((page.events[0]!.detail as { reason: string }).reason).toBe("上游访谈被受访者撤回");

    // v2 was NOT withdrawn. A reference site pinned to v2 must not render 「证据已撤回」, and
    // a lookup that ignored its target id would say it should.
    const other = await trail({ targetKind: "artifact-version", targetId: a.versionIds[1]! });
    expect(other.events).toHaveLength(0);
  });

  it("re-running the withdrawal does not double anyone's inbox", async () => {
    const a = await seedArtifact(h, ORG, PROJECT, ["v1\n"], AUTHOR);
    const first = await withdraw(a.versionIds[0]!);
    const second = await withdraw(a.versionIds[0]!);
    // Two EVENTS -- the trail is append-only, and both attempts really happened.
    const events = await trail({ types: ["evidence-withdrawn"] });
    expect(events.events).toHaveLength(2);
    expect(first.provenanceEventId).not.toBe(second.provenanceEventId);
    // ...but the notice is per (event, recipient), so a retry of the SAME withdrawal is
    // idempotent. Asserted on the first event's notices.
    const n = await asApp(ORG, async (c) => {
      const q = await c.query<{ n: string }>(
        `SELECT count(*) AS n FROM provenance_notifications WHERE provenance_event_id = $1`,
        [first.provenanceEventId],
      );
      return Number(q.rows[0]!.n);
    });
    expect(n).toBe(1);
  });

  /**
   * The ROUTE, not only the use case.
   *
   * Every assertion above calls `withdrawEvidence` directly, and all of them would stay
   * green with no controller wired at all -- which is the state F04 and F05 are honestly in
   * for their own operations. This one is here so "E5 is reachable" is a tested claim.
   */
  it("over HTTP: the route answers with the contract's three fields", async () => {
    const a = await seedArtifact(h, ORG, PROJECT, ["v1\n"], AUTHOR);
    const cited = await bindToProjectStep(h.deps, {
      userId: AUTHOR, orgId: org(), artifactId: a.artifactId, projectId: PROJECT,
      agendaSegmentId: STEP, mode: "pinned", sourceVersionId: a.versionIds[0],
    });

    const post = (versionId: string, userId: string) =>
      fetch(`${BASE}/artifacts/versions/${versionId}/evidence-withdrawn`, {
        method: "POST",
        headers: {
          "x-kernel-test-principal": `${userId}:${ORG}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ versionId, reason: "上游访谈被受访者撤回" }),
      });

    const res = await post(a.versionIds[0]!, LEAD);
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.annotatedReferences).toEqual([cited.id]);
    expect(body.notifiedApprovers).toEqual([AUTHOR]);
    expect(typeof body.provenanceEventId).toBe("string");

    // A caller outside the tenant and a version that does not exist are the same answer.
    const stranger = await post(a.versionIds[0]!, "u-f08-outsider");
    const ghost = await post("ver-nope-f08", LEAD);
    expect(stranger.status).toBe(404);
    expect(ghost.status).toBe(404);
  });

  it("a NON-MEMBER gets the same not-found as a nonexistent version", async () => {
    const a = await seedArtifact(h, ORG, PROJECT, ["v1\n"], AUTHOR);
    const stranger = withdraw(a.versionIds[0]!, "u-f08-stranger");
    const ghost = withdraw("ver-does-not-exist", LEAD);
    // Same error class, so the interface layer maps both to 404 and a caller outside the
    // tenant cannot tell a real version id from an invented one.
    await expect(stranger).rejects.toThrowError();
    await expect(ghost).rejects.toThrowError();
    const [s, g] = await Promise.all([
      stranger.catch((e: Error) => e.constructor.name),
      ghost.catch((e: Error) => e.constructor.name),
    ]);
    expect(s).toBe(g);
  });
});
