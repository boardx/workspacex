/**
 * F15 acceptance V8 -- every configuration change is recorded, with who / when / which
 * capability / before and after (uc-0-5 R7, R12 V8) -- and D-U5's disable semantics
 * (uc-0-5 R4 A3).
 *
 * ## Why `affectedInFlightCalls` is asserted in both directions here
 *
 * The contract states it is PART OF THE CONTRACT, not telemetry: the confirmation dialog
 * says "N in-flight calls will be interrupted" and an admin picks `interrupt` or `drain` on
 * the strength of that number. Asserting only "it is 0 when nothing is running" would pass
 * against a hardcoded zero -- which is exactly what the field would be if nobody ever wired
 * it, and it would keep passing after the agent runtime arrives.
 *
 * Phase-00 has no agent runtime, so the calls here are registered through the port directly.
 * That is stated rather than dressed up: what is proven is that the path from registry to
 * response carries a real number, and that the two modes do different things to running
 * calls.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { provenance as P } from "@repo/contracts";
import { addCapability, addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { IN_FLIGHT_CALLS } from "../../src/application/identity/capability-ports";
import { PROVENANCE_READER, type ProvenanceReader } from "../../src/application/provenance/ports";
import type { InMemoryInFlightCalls } from "../../src/infrastructure/identity/in-memory-in-flight-calls";
import { toOrgId } from "../../src/domain/org-id";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-cap-prov";
const ADMIN = "u-cap-admin";
const CONSULTANT = "u-cap-consultant";

let BASE: string;
let app: NestExpressApplication;
let events: ProvenanceReader;
let inFlight: InMemoryInFlightCalls;

const auth = (user: string) => ({
  "x-kernel-test-principal": `${user}:${ORG}`,
  "content-type": "application/json",
});

interface MutateResult {
  listing: { id: string; name: string; enabled: boolean; scope: string };
  provenanceEventId: string;
  affectedInFlightCalls: number;
}

const mutate = (user: string, body: unknown): Promise<Response> =>
  fetch(`${BASE}/capabilities/mutate`, {
    method: "POST",
    headers: auth(user),
    body: JSON.stringify(body),
  });

const mutateOk = async (user: string, body: unknown): Promise<MutateResult> => {
  const r = await mutate(user, body);
  expect(r.status, await r.clone().text()).toBe(200);
  return (await r.json()) as MutateResult;
};

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  events = app.get<ProvenanceReader>(PROVENANCE_READER);
  // The SAME instance the controller holds -- registering a call on a different one would
  // prove nothing about what the response reports.
  inFlight = app.get<InMemoryInFlightCalls>(IN_FLIGHT_CALLS);
});

afterAll(async () => {
  await app?.close();
  await resetOrgs(ORG);
});

beforeEach(async () => {
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: `${ORG}-p` });
  await addOrgMember(ORG, ADMIN, "admin", fx.teams.energy!);
  await addOrgMember(ORG, CONSULTANT, "consultant", fx.teams.energy!);
});

const trailFor = async (targetId: string) =>
  (await events.query(toOrgId(ORG), { targetKind: "capability", targetId })).events;

describe("V8: every change lands in provenance_events with before and after", () => {
  it("add", async () => {
    const r = await mutateOk(ADMIN, {
      orgId: ORG, kind: "agent", op: "add",
      // #619: kind="agent" 时 abbr/duty 必填。
      payload: { name: "Bookkeeper", scope: "org-wide", abbr: "BK", duty: "记账与对账" },
    });
    const trail = await trailFor(r.listing.id);
    expect(trail).toHaveLength(1);
    const e = trail[0]!;
    expect(e.id).toBe(r.provenanceEventId);
    expect(e.type).toBe("capability-added");
    expect(e.actorId).toBe(ADMIN);
    expect(e.target).toEqual({ kind: "capability", id: r.listing.id });
    expect(e.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // `before: null` stated, not omitted. A missing key reads as "nobody recorded it".
    expect(e.detail.before).toBeNull();
    expect((e.detail.after as { name: string }).name).toBe("Bookkeeper");
  });

  it("update -- before and after actually differ", async () => {
    const added = await mutateOk(ADMIN, {
      orgId: ORG, kind: "skill", op: "add", payload: { name: "cashflow", scope: "org-wide" },
    });
    const updated = await mutateOk(ADMIN, {
      orgId: ORG, kind: "skill", op: "update",
      payload: { id: added.listing.id, name: "cashflow-v2" },
    });
    const trail = await trailFor(added.listing.id);
    const e = trail.find((x) => x.type === "capability-updated")!;
    expect(e).toBeDefined();
    // Both values present AND different: a recorder that wrote the new value into both
    // fields would satisfy "before and after exist" and record nothing.
    expect((e.detail.before as { name: string }).name).toBe("cashflow");
    expect((e.detail.after as { name: string }).name).toBe("cashflow-v2");
    expect(updated.listing.name).toBe("cashflow-v2");
  });

  it("disable -- the mode and the affected count are IN the record", async () => {
    const added = await mutateOk(ADMIN, {
      orgId: ORG, kind: "mcp", op: "add", payload: { name: "crm-mcp", scope: "org-wide" },
    });
    const r = await mutateOk(ADMIN, {
      orgId: ORG, kind: "mcp", op: "disable", payload: { id: added.listing.id },
    });
    expect(r.listing.enabled).toBe(false);
    const e = (await trailFor(added.listing.id)).find((x) => x.type === "capability-disabled")!;
    expect(e.detail.disableMode).toBe("interrupt");
    expect(e.detail.affectedInFlightCalls).toBe(0);
    expect((e.detail.before as { enabled: boolean }).enabled).toBe(true);
    expect((e.detail.after as { enabled: boolean }).enabled).toBe(false);
  });

  it("the three event types are the shared contract's, and an invented one is rejected", () => {
    // Closedness, not a count (E-4): a reviewed new event type must not be blocked by an
    // assertion about how many there are.
    for (const t of ["capability-added", "capability-updated", "capability-disabled"]) {
      expect(P.ProvenanceEventType.safeParse(t).success).toBe(true);
    }
    expect(P.ProvenanceEventType.safeParse("capability-tweaked").success).toBe(false);
  });
});

describe("D-U5: interrupt is the default, drain is the choice, and they differ observably", () => {
  let capId: string;

  beforeEach(async () => {
    const added = await mutateOk(ADMIN, {
      orgId: ORG, kind: "model", op: "add", payload: { name: "gpu-box", scope: "org-wide" },
    });
    capId = added.listing.id;
  });

  it("affectedInFlightCalls reports ZERO when nothing is running", async () => {
    const r = await mutateOk(ADMIN, { orgId: ORG, kind: "model", op: "disable", payload: { id: capId } });
    expect(r.affectedInFlightCalls).toBe(0);
  });

  it("...and reports N when N are running -- the direction a hardcoded zero fails", async () => {
    inFlight.begin(toOrgId(ORG), capId, "call-1");
    inFlight.begin(toOrgId(ORG), capId, "call-2");
    inFlight.begin(toOrgId(ORG), capId, "call-3");
    const r = await mutateOk(ADMIN, { orgId: ORG, kind: "model", op: "disable", payload: { id: capId } });
    expect(r.affectedInFlightCalls).toBe(3);
  });

  it("a call against a DIFFERENT capability is not counted", async () => {
    await addCapability({ orgId: ORG, id: "cap-other", kind: "model", name: "other-box" });
    inFlight.begin(toOrgId(ORG), "cap-other", "call-other");
    const r = await mutateOk(ADMIN, { orgId: ORG, kind: "model", op: "disable", payload: { id: capId } });
    expect(r.affectedInFlightCalls).toBe(0);
  });

  it("interrupt (the default) terminates the running calls", async () => {
    inFlight.begin(toOrgId(ORG), capId, "call-i");
    // No disableMode in the body: D-U5's default. The safe-but-annoying one, because only
    // the other mistake is unsafe.
    await mutateOk(ADMIN, { orgId: ORG, kind: "model", op: "disable", payload: { id: capId } });
    expect(inFlight.outcomeOf("call-i")).toBe("terminated");
  });

  it("drain lets the running calls finish -- the observable difference", async () => {
    inFlight.begin(toOrgId(ORG), capId, "call-d");
    await mutateOk(ADMIN, {
      orgId: ORG, kind: "model", op: "disable", payload: { id: capId }, disableMode: "drain",
    });
    // Not "terminated". If both modes did the same thing, the choice in the dialog would be
    // decoration -- and this is the assertion that would fail.
    expect(inFlight.outcomeOf("call-d")).toBe("draining");
  });

  it("both modes stop NEW calls -- otherwise drain would mean 'carry on forever'", async () => {
    await mutateOk(ADMIN, {
      orgId: ORG, kind: "model", op: "disable", payload: { id: capId }, disableMode: "drain",
    });
    expect(await inFlight.admits(toOrgId(ORG), capId)).toBe(false);
    expect(inFlight.begin(toOrgId(ORG), capId, "call-new")).toBe(false);
  });

  it("an invalid disableMode is refused by the contract schema, not defaulted", async () => {
    // Silently falling back to `interrupt` on a typo would cut live calls the admin thought
    // they were draining.
    const r = await mutate(ADMIN, {
      orgId: ORG, kind: "model", op: "disable", payload: { id: capId }, disableMode: "pause",
    });
    expect(r.status).toBe(400);
  });
});

describe("members follow the configuration; they do not change it (R5 / R7)", () => {
  it("a consultant is refused, with a reason code rather than a bare 403", async () => {
    const r = await mutate(CONSULTANT, {
      orgId: ORG, kind: "agent", op: "add", payload: { name: "Sneaky", scope: "org-wide" },
    });
    expect(r.status).toBe(403);
    expect((await r.json()) as { reasonCode: string }).toMatchObject({
      reasonCode: "PROJECT_ROLE_INSUFFICIENT",
    });
  });

  it("...and nothing was written", async () => {
    await mutate(CONSULTANT, {
      orgId: ORG, kind: "agent", op: "add", payload: { name: "Sneaky", scope: "org-wide" },
    });
    const body = (await fetch(`${BASE}/capabilities?orgId=${ORG}&kind=agent`, {
      headers: auth(ADMIN),
    }).then((r) => r.json())) as { name: string }[];
    expect(body.map((x) => x.name)).not.toContain("Sneaky");
  });

  it("the refusal itself is recorded -- a denied probe must not be free", async () => {
    await mutate(CONSULTANT, {
      orgId: ORG, kind: "agent", op: "add", payload: { name: "Sneaky", scope: "org-wide" },
    });
    const page = await events.query(toOrgId(ORG), { types: ["unauthorized-attempt"] });
    expect(page.events).toHaveLength(1);
    expect(page.events[0]!.actorId).toBe(CONSULTANT);
    expect(page.events[0]!.detail.operation).toBe("mutateCapability");
  });

  it("a non-member gets 404, not 403 -- the organization's existence is not disclosed", async () => {
    const r = await mutate("u-nobody", {
      orgId: ORG, kind: "agent", op: "add", payload: { name: "X", scope: "org-wide" },
    });
    expect(r.status).toBe(404);
  });
});

describe("the payload is validated even though the contract leaves it open", () => {
  it("add without a name is a field-level 400, not a row with an empty name", async () => {
    const r = await mutate(ADMIN, { orgId: ORG, kind: "agent", op: "add", payload: { scope: "org-wide" } });
    expect(r.status).toBe(400);
    const body = (await r.json()) as { fields?: { path: string }[] };
    expect(body.fields?.some((f) => f.path === "name")).toBe(true);
  });

  it("update cannot flip `enabled` -- that path exists so D-U5 cannot be walked around", async () => {
    const added = await mutateOk(ADMIN, {
      orgId: ORG, kind: "agent", op: "add",
      payload: { name: "Keeper", scope: "org-wide", abbr: "KP", duty: "test fixture agent" },
    });
    // REJECTED, not silently ignored (changed 2026-07-29 when the contract's payload
    // schemas became `.strict()`).
    //
    // Ignoring it was the weaker guarantee: the caller gets a 200 and believes the
    // capability is now disabled, while it is still serving traffic. A 400 tells them to
    // use `op: "disable"`, which is the path that carries an interruption mode, a count of
    // in-flight calls and a provenance record (D-U5).
    const rejected = await mutate(ADMIN, {
      orgId: ORG, kind: "agent", op: "update",
      payload: { id: added.listing.id, enabled: false },
    });
    expect(rejected.status, await rejected.clone().text()).toBe(400);

    const body = (await fetch(`${BASE}/capabilities?orgId=${ORG}&kind=agent`, {
      headers: auth(ADMIN),
    }).then((r) => r.json())) as { enabled: boolean }[];
    // And nothing changed -- a refused request must not have half-applied.
    expect(body[0]!.enabled).toBe(true);
  });

  it("a team-only capability with no owning team is refused at the boundary", async () => {
    // An unanswerable visibility rule gets resolved as "allow" by whoever implements the
    // caller, so it must never be storable. 400 rather than 500: the contract schema catches
    // it before SQL does, so the admin gets a field to fix.
    const r = await mutate(ADMIN, {
      orgId: ORG, kind: "agent", op: "add", payload: { name: "Halfway", scope: "team-only" },
    });
    expect(r.status).toBe(400);
  });

  it("...and the DATABASE refuses it too, which is the half that holds for every writer", async () => {
    // Counter-proof for the constraint itself. The schema check above is one edit away from
    // being removed; the CHECK is not, and it covers writers that never see the schema.
    // #619: abbr/duty 补上非空值——本测试要验的是 team-only 那条 CHECK，不是 abbr/duty
    // 那条（那条有它自己的反证，见 `capability-listings-agent-fields.test.ts`）。
    // 缺了它们，多条 CHECK 都会被同一个 INSERT 撞上，谁先报错不是本测试关心的事。
    // #1705：role_label 同理补上非空值——理由与 abbr/duty 完全相同（否则本测试可能
    // 撞上 `capability_listings_agent_needs_role_label` 而不是本测试要验的那条）。
    await expect(
      asApp(ORG, (c) =>
        c.query(
          `INSERT INTO capability_listings (id, org_id, kind, name, scope, owner_team_id, abbr, duty, role_label)
           VALUES ('cap-halfway', $1, 'agent', 'Halfway', 'team-only', NULL, 'HW', 'test fixture agent', 'HW')`,
          [ORG],
        ),
      ),
    ).rejects.toThrow(/capability_listings_team_only_needs_team/);
  });
});
