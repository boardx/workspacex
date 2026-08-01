/**
 * F45 -- V6·22-4 / D-15: the two-tier SLA. Logical invalidation is a same-request fact
 * (≤5 minutes, and this codebase makes it synchronous rather than racing a worker for it --
 * see `request-deletion.ts`'s header); physical deletion is a ≤30-day, project-overridable
 * deadline that `requestDeletion` only RECORDS (the worker that acts on it is F46).
 *
 * Also covers the pure half of `domain/files/deletion-cascade.ts` directly -- no database
 * needed for those assertions, only for the ones that exercise the real use case end to end.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { orgAdmin as OA } from "@repo/contracts";
import {
  CASCADE_KINDS, deriveLogicalCascadeStatus, logicalInvalidationDeadline, physicalDeletionDeadline,
  receiptEligible, withinLogicalSla, type CascadeResultEntry,
} from "../../src/domain/files/deletion-cascade";
import { addOrgMember, addProjectMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addBrowserArtifact } from "../support/files-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgProvenanceRepository } from "../../src/infrastructure/provenance/pg-provenance-repository";
import {
  PgCascadeInvalidationRepository, PgDeleteImpactRepository, PgDeletionTaskRepository, PgLegalHoldGate,
} from "../../src/infrastructure/files/pg-deletion-repository";
import { requestDeletion, type RequestDeletionDeps } from "../../src/application/files/request-deletion";
import { toOrgId } from "../../src/domain/org-id";

const okResults: readonly CascadeResultEntry[] = CASCADE_KINDS.map((kind) => ({ kind, result: "ok", detail: null }));

describe("pure domain: deriveLogicalCascadeStatus / receiptEligible (no database)", () => {
  it("all six ok -> 'running', never 'done' (F46's physical-delete worker owns that transition)", () => {
    expect(deriveLogicalCascadeStatus(okResults)).toBe("running");
    expect(receiptEligible(deriveLogicalCascadeStatus(okResults))).toBe(false);
  });

  it("🔴 N-17: ANY one 'failed' among the six -> the WHOLE task is 'partial-failure'", () => {
    const withOneFailed = okResults.map((r) => (r.kind === "ontology-edges" ? { ...r, result: "failed" as const } : r));
    expect(deriveLogicalCascadeStatus(withOneFailed)).toBe("partial-failure");
    expect(receiptEligible("partial-failure")).toBe(false);
  });

  it("fewer than six entries throws -- R11: a four-category implementation must fail LOUDLY, not report 'running'", () => {
    expect(() => deriveLogicalCascadeStatus(okResults.slice(0, 4))).toThrow(/six/);
  });

  it("the two deadlines derive from the SAME single source `WITHDRAWAL_SLA_MS` F14 already uses (D-15, one ruling)", () => {
    const requestedAt = new Date("2026-08-01T00:00:00.000Z");
    expect(logicalInvalidationDeadline(requestedAt).getTime()).toBe(requestedAt.getTime() + OA.WITHDRAWAL_SLA_MS.logicalRetire);
    expect(physicalDeletionDeadline(requestedAt, 30).getTime()).toBe(requestedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
  });

  it("physicalDeletionDeadline honors a project-level override, not a hardcoded 30 (O-01/N-20)", () => {
    const requestedAt = new Date("2026-08-01T00:00:00.000Z");
    const sevenDayGrace = physicalDeletionDeadline(requestedAt, 7);
    const thirtyDayGrace = physicalDeletionDeadline(requestedAt, 30);
    expect(sevenDayGrace.getTime()).toBeLessThan(thirtyDayGrace.getTime());
    expect(sevenDayGrace.getTime()).toBe(requestedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
  });

  it("withinLogicalSla: exactly at 5 minutes is within, past it is not", () => {
    const requestedAt = new Date("2026-08-01T00:00:00.000Z");
    const atFiveMinutes = new Date(requestedAt.getTime() + OA.WITHDRAWAL_SLA_MS.logicalRetire);
    const pastFiveMinutes = new Date(requestedAt.getTime() + OA.WITHDRAWAL_SLA_MS.logicalRetire + 1);
    expect(withinLogicalSla(requestedAt, atFiveMinutes)).toBe(true);
    expect(withinLogicalSla(requestedAt, pastFiveMinutes)).toBe(false);
  });
});

const ORG = "org-f45-sla";
const PROJECT = "proj-f45-sla";

class SeqIds {
  private n = 0;
  next(): string { return `d-${++this.n}`; }
}
// Namespaced with ORG (unique per test FILE) -- see the same class in
// `delete-impact-preview-confirm.test.ts` for why a bare counter collides across files.
class SeqRowIds {
  private n = 0;
  next(prefix: string): string { return `${prefix}-${ORG}-${++this.n}`; }
}

let db: PgDatabase;
let makeDeps: (now: Date, trashGraceDays: number) => RequestDeletionDeps;
const sharedIdFactory = new SeqRowIds();

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT, teamNames: ["energy"] });
  await addOrgMember(ORG, "u-fac", "consultant", `${ORG}-team-energy`);
  await addProjectMember(ORG, PROJECT, "u-fac", "facilitator", null, true);

  db = new PgDatabase(appConfig());
  const identity = new PgIdentityRepository(db);
  makeDeps = (now, trashGraceDays) => ({
    repo: identity, ids: new SeqIds(),
    impact: new PgDeleteImpactRepository(db),
    legalHold: new PgLegalHoldGate(db),
    cascades: new PgCascadeInvalidationRepository(db),
    tasks: new PgDeletionTaskRepository(db),
    provenance: new PgProvenanceRepository(db),
    idFactory: sharedIdFactory,
    now: () => now,
    trashGraceDays: async () => trashGraceDays,
  });
});

afterAll(async () => {
  await db?.close();
  await resetOrgs(ORG);
});

describe("V6·22-4 end to end: requestDeletion's deadlines match the requester-supplied clock and retention policy", () => {
  it("default 30-day grace: physicalDeletionDeadline is exactly requestedAt + 30 days", async () => {
    await addBrowserArtifact({ orgId: ORG, id: "f45sla-a", projectId: PROJECT, title: "a.pdf" });
    const requestedAt = new Date("2026-08-01T12:00:00.000Z");
    const out = await requestDeletion(makeDeps(requestedAt, 30), {
      userId: "u-fac", orgId: toOrgId(ORG), artifactId: "f45sla-a",
      reason: "V6 default grace", scope: null, confirmedImpact: true, actorKind: "user",
    });
    expect(out.logicalInvalidationDeadline).toBe(logicalInvalidationDeadline(requestedAt).toISOString());
    expect(out.physicalDeletionDeadline).toBe(physicalDeletionDeadline(requestedAt, 30).toISOString());
  });

  it("a project-level override (7 days) changes physicalDeletionDeadline, not logicalInvalidationDeadline (D-15's 5 minutes never moves)", async () => {
    await addBrowserArtifact({ orgId: ORG, id: "f45sla-b", projectId: PROJECT, title: "b.pdf" });
    const requestedAt = new Date("2026-08-01T12:00:00.000Z");
    const out = await requestDeletion(makeDeps(requestedAt, 7), {
      userId: "u-fac", orgId: toOrgId(ORG), artifactId: "f45sla-b",
      reason: "V6 project override", scope: null, confirmedImpact: true, actorKind: "user",
    });
    expect(out.logicalInvalidationDeadline).toBe(logicalInvalidationDeadline(requestedAt).toISOString());
    expect(out.physicalDeletionDeadline).toBe(physicalDeletionDeadline(requestedAt, 7).toISOString());
    expect(new Date(out.physicalDeletionDeadline).getTime()).toBeLessThan(
      new Date(physicalDeletionDeadline(requestedAt, 30).toISOString()).getTime(),
    );
  });

  it(
    "🔴 N-17/N-18: even though logical invalidation genuinely completes inside the SLA window, " +
      "NO receipt exists yet -- receiptId is non-null IFF physical deletion completed, and this " +
      "feature never runs the physical-delete worker (F46's job)",
    async () => {
      await addBrowserArtifact({ orgId: ORG, id: "f45sla-c", projectId: PROJECT, title: "c.pdf" });
      const requestedAt = new Date("2026-08-01T12:00:00.000Z");
      const out = await requestDeletion(makeDeps(requestedAt, 30), {
        userId: "u-fac", orgId: toOrgId(ORG), artifactId: "f45sla-c",
        reason: "V6 receipt gating", scope: null, confirmedImpact: true, actorKind: "user",
      });
      const task = await makeDeps(requestedAt, 30).tasks.getTask(toOrgId(ORG), out.taskId);
      expect(task!.receiptId).toBeNull();
      // The real phase-01 stub always fails ontology-edges, so this is 'partial-failure' --
      // but even in the counter-proof world where all six succeed (see the cascade test
      // file), the status tops out at 'running': the SLA clock for PHYSICAL deletion is
      // still open, and a receipt before that deadline would be exactly the "回执照出，而
      // 边还在图里" shape N-17 forbids, just for a different one of the six categories.
      expect(task!.status).not.toBe("done");
    },
  );
});
