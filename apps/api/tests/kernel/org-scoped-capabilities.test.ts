/**
 * F15 acceptance V2 (organizations are isolated) and V10 (the two layers are SERIAL and
 * distinguishable) -- uc-0-5 R3 steps 3-4, R7, R9, R12 V2 / V10.
 *
 * Plus the response half of the single-source chain (contract-design hard rule 6): every
 * route added by F15 has its body checked against `C.operations.<op>.out`, with a reverse
 * assertion proving those schemas reject drift -- otherwise the whole section is a
 * safeParse that says yes to everything.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { identity as C } from "@repo/contracts";
import {
  addCapability,
  addOrgMember,
  asApp,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
} from "../support/db";
import { listCapabilities } from "../../src/application/identity/list-capabilities";
import {
  CAPABILITY_REPOSITORY,
  type CapabilityRepository,
} from "../../src/application/identity/capability-ports";
import {
  DECISION_ID_FACTORY,
  IDENTITY_REPOSITORY,
  type DecisionIdFactory,
  type IdentityRepository,
} from "../../src/application/identity/ports";
import { toOrgId } from "../../src/domain/org-id";
import { OFFICIAL_SKILLS } from "../../scripts/backfill-platform-skills";

/** design-delta `platform-owned-skills`：kind=skill 恒含这四个官方 skill，见
 *  no-builtin-capability-lists.test.ts 同名常量的头注（id 不带 `cap-` 前缀，
 *  与 `skills.id` 逐字相同——「找不到 Skill」根因修复）。 */
const PLATFORM_SKILL_IDS = OFFICIAL_SKILLS.map((s) => `skill-platform-${s.stableName}`).sort();

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG_A = "org-cap-a";
const ORG_B = "org-cap-b";
const BOTH = "u-both";
const OUTSIDER = "u-outsider";
/** Member of ORG_A's platform team only -- the person V10 is about. */
const PLATFORM = "u-platform";

let BASE: string;
let app: NestExpressApplication;
let fxA: Awaited<ReturnType<typeof seedOrg>>;
let fxB: Awaited<ReturnType<typeof seedOrg>>;
let deps: { repo: IdentityRepository; capabilities: CapabilityRepository; ids: DecisionIdFactory };

const authFor = (user: string, org: string) => ({ "x-kernel-test-principal": `${user}:${org}` });

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  deps = {
    repo: app.get<IdentityRepository>(IDENTITY_REPOSITORY),
    capabilities: app.get<CapabilityRepository>(CAPABILITY_REPOSITORY),
    ids: app.get<DecisionIdFactory>(DECISION_ID_FACTORY),
  };
});

afterAll(async () => {
  await app?.close();
  await resetOrgs(ORG_A, ORG_B);
});

beforeEach(async () => {
  await resetOrgs(ORG_A, ORG_B);
  fxA = await seedOrg({ orgId: ORG_A, projectId: `${ORG_A}-p` });
  fxB = await seedOrg({ orgId: ORG_B, projectId: `${ORG_B}-p` });
  await addOrgMember(ORG_A, BOTH, "admin", fxA.teams.energy!);
  await addOrgMember(ORG_B, BOTH, "admin", fxB.teams.energy!);
  await addOrgMember(ORG_A, PLATFORM, "consultant", fxA.teams.platform!);
  await addOrgMember(ORG_B, OUTSIDER, "consultant", null);
});

const get = (user: string, org: string, kind: string) =>
  fetch(`${BASE}/capabilities?orgId=${org}&kind=${kind}`, { headers: authFor(user, org) });

describe("V2: one person, two organizations, two configurations", () => {
  beforeEach(async () => {
    await addCapability({ orgId: ORG_A, id: "cap-a", kind: "agent", name: "A-only-agent" });
    await addCapability({ orgId: ORG_B, id: "cap-b", kind: "agent", name: "B-only-agent" });
  });

  it("the same user sees a different list in each, and neither contains the other's", async () => {
    const a = (await get(BOTH, ORG_A, "agent").then((r) => r.json())) as { name: string; orgId: string }[];
    const b = (await get(BOTH, ORG_B, "agent").then((r) => r.json())) as { name: string; orgId: string }[];

    expect(a.map((x) => x.name)).toEqual(["A-only-agent"]);
    expect(b.map((x) => x.name)).toEqual(["B-only-agent"]);
    // Stated as non-containment rather than inequality: two different lists could still each
    // be leaking one of the other's rows.
    expect(a.some((x) => x.name === "B-only-agent")).toBe(false);
    expect(b.some((x) => x.name === "A-only-agent")).toBe(false);
    expect(a.every((x) => x.orgId === ORG_A)).toBe(true);
    expect(b.every((x) => x.orgId === ORG_B)).toBe(true);
  });

  it("asking for another organization's configuration is refused, and does not reveal it exists", async () => {
    // 404 rather than 403: R9 calls a cross-organization configuration read a privilege
    // violation, and a 403 would confirm ORG_A is a real organization to somebody outside it.
    const r = await get(OUTSIDER, ORG_A, "agent");
    expect(r.status).toBe(404);
    const body = (await r.json()) as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toContain("A-only-agent");
  });

  it("RLS refuses it one layer down too, with no application code involved", async () => {
    // The application check above could be removed by a single edit. This one could not.
    const rows = await asApp(ORG_B, (c) =>
      c.query("SELECT id FROM capability_listings WHERE org_id = $1", [ORG_A]),
    );
    expect(rows.rowCount).toBe(0);
  });
});

describe("V10: the two layers are serial, and their failures are TOLD APART", () => {
  beforeEach(async () => {
    // Present in the organization, restricted to the energy team.
    await addCapability({
      orgId: ORG_A, id: "cap-energy", kind: "agent", name: "Energy-modeller",
      scope: "team-only", ownerTeamId: fxA.teams.energy!,
    });
    await addCapability({ orgId: ORG_A, id: "cap-open", kind: "agent", name: "Open-agent" });
  });

  it("layer one -- the organization simply does not have it: absent from BOTH halves", async () => {
    const r = await listCapabilities(deps, {
      userId: PLATFORM, orgId: toOrgId(ORG_A), kind: "blueprint",
    });
    expect(r.visible).toEqual([]);
    // The distinguishing assertion: nothing was WITHHELD either. There is no such capability
    // to withhold, and that is a different answer from "you may not see it".
    expect(r.withheld).toEqual([]);
  });

  it("layer two -- it exists but is another team's: withheld with ORG_SCOPE_DENIED", async () => {
    const r = await listCapabilities(deps, {
      userId: PLATFORM, orgId: toOrgId(ORG_A), kind: "agent",
    });
    expect(r.visible.map((c) => c.name)).toEqual(["Open-agent"]);
    expect(r.withheld).toHaveLength(1);
    expect(r.withheld[0]!.reasonCode).toBe("ORG_SCOPE_DENIED");
    // Not "NO_ORG_MEMBERSHIP": this person IS in the organization. Conflating the two sends
    // them to the wrong person to ask (UC-0.3 R8).
    expect(r.withheld[0]!.ref).toEqual({ kind: "capability", id: "cap-energy" });
    // And the decision is recoverable, like every other decision in the system.
    expect(r.withheld[0]!.permissionDecisionId).toBeTruthy();
  });

  it("a member of the owning team sees it -- so the denial above was the scope, not the row", async () => {
    const r = await listCapabilities(deps, { userId: BOTH, orgId: toOrgId(ORG_A), kind: "agent" });
    expect(r.visible.map((c) => c.name).sort()).toEqual(["Energy-modeller", "Open-agent"]);
    expect(r.withheld).toEqual([]);
  });

  it("the HTTP response carries only the visible half -- a stated contract limitation", async () => {
    // `listCapabilities.out` is `CapabilityListing[]`: there is nowhere in the response to
    // put the withheld half, so V10's distinction is only assertable at the use case. Written
    // down here rather than left as a surprise; reported as a contract gap.
    const body = (await get(PLATFORM, ORG_A, "agent").then((r) => r.json())) as { name: string }[];
    expect(body.map((x) => x.name)).toEqual(["Open-agent"]);
    expect(JSON.stringify(body)).not.toContain("ORG_SCOPE_DENIED");
  });

  it("a capability judged as visible was judged -- the guard cannot be skipped", async () => {
    // permission-filter holds the payload in a module-private WeakMap, so a listing that
    // reached `visible` provably went through `discloseDecided`. This asserts the other end:
    // a capability ref cannot be smuggled through the acl-bindings path instead.
    const { disclose } = await import("../../src/application/security/permission-filter");
    const { guard } = await import("../../src/application/security/permission-filter");
    await expect(
      disclose(
        { repo: deps.repo, ids: deps.ids },
        {
          userId: BOTH, orgId: toOrgId(ORG_A), action: "read.published", path: "cache",
          items: [guard({ kind: "capability", id: "cap-energy" }, { secret: true })],
        },
      ),
    ).rejects.toThrow(/cannot be judged by authorize/);
  });
});

describe("disabled means disabled, not hidden (R8)", () => {
  it("a disabled capability is still returned, with enabled: false", async () => {
    await addCapability({
      orgId: ORG_A, id: "cap-off", kind: "mcp", name: "retired-mcp", enabled: false,
    });
    const body = (await get(BOTH, ORG_A, "mcp").then((r) => r.json())) as { name: string; enabled: boolean }[];
    // Hiding it would read as "the product cannot do this"; showing it disabled says "this
    // organization does not allow it", which is the true and actionable statement.
    expect(body).toHaveLength(1);
    expect(body[0]!.enabled).toBe(false);
  });
});

describe("hard rule 6: F15's routes return what the contract describes", () => {
  it("GET /capabilities -- populated", async () => {
    await addCapability({ orgId: ORG_A, id: "cap-r1", kind: "skill", name: "cashflow" });
    const body = await get(BOTH, ORG_A, "skill").then((r) => r.json());
    const parsed = C.operations.listCapabilities.out.safeParse(body);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(body)).toBeNull();
  });

  it("GET /capabilities -- empty, which is the case V1 is about", async () => {
    // design-delta `platform-owned-skills`: kind=skill is no longer a valid stand-in for
    // "unconfigured returns []" -- it now always carries the four platform skills (see
    // no-builtin-capability-lists.test.ts, which owns that assertion). Swapped to `mcp`,
    // still genuinely empty here, so this test keeps testing what V1 actually claims: the
    // endpoint has an empty case and it round-trips the contract shape.
    const body = await get(BOTH, ORG_A, "mcp").then((r) => r.json());
    const parsed = C.operations.listCapabilities.out.safeParse(body);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(body)).toBeNull();
    expect(body).toEqual([]);
  });

  it("POST /capabilities/mutate -- add", async () => {
    const body = await fetch(`${BASE}/capabilities/mutate`, {
      method: "POST",
      headers: { ...authFor(BOTH, ORG_A), "content-type": "application/json" },
      body: JSON.stringify({
        orgId: ORG_A, kind: "agent", op: "add",
        // #619: kind="agent" 时 abbr/duty 是必填字段（CapabilityPayloadError 否则）。
        payload: { name: "Bookkeeper", scope: "org-wide", abbr: "BK", duty: "记账与对账" },
      }),
    }).then((r) => r.json());
    const parsed = C.operations.mutateCapability.out.safeParse(body);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(body)).toBeNull();
  });

  it("POST /identity/switch-org still conforms once capabilities are real", async () => {
    await addCapability({ orgId: ORG_A, id: "cap-sw", kind: "model", name: "local-llm" });
    const body = await fetch(`${BASE}/identity/switch-org`, {
      method: "POST",
      headers: { ...authFor(BOTH, ORG_A), "content-type": "application/json" },
      body: JSON.stringify({ toOrgId: ORG_A }),
    }).then((r) => r.json());
    const parsed = C.operations.switchOrganization.out.safeParse(body);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(body)).toBeNull();
  });

  it("COUNTER-PROOF: those schemas reject bodies that drift", () => {
    // Without this the whole section could be a safeParse that says yes to everything.
    expect(C.operations.listCapabilities.out.safeParse([{ id: "x" }]).success).toBe(false);
    // A kind outside the closed enum must not sneak through.
    expect(
      C.operations.listCapabilities.out.safeParse([
        { id: "x", orgId: "o", kind: "workflow", name: "n", scope: "org-wide", enabled: true },
      ]).success,
    ).toBe(false);
    // A scope outside the closed enum likewise -- "org"/"team" is a drift this project has
    // already shipped once.
    expect(
      C.operations.listCapabilities.out.safeParse([
        { id: "x", orgId: "o", kind: "agent", name: "n", scope: "team", enabled: true },
      ]).success,
    ).toBe(false);
    // affectedInFlightCalls is part of the contract: a response without it is not valid.
    expect(
      C.operations.mutateCapability.out.safeParse({
        listing: { id: "x", orgId: "o", kind: "agent", name: "n", scope: "org-wide", enabled: true },
        provenanceEventId: "p",
      }).success,
    ).toBe(false);
  });
});
