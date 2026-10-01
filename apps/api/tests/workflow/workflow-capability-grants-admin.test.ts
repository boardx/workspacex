/**
 * Workflow 能力授权管理面 —— 真实 PostgreSQL（workflow_capability_grants / provenance_events / org_memberships）。
 *
 * 反证：
 *   · 没有授权 → W029 `persist`（artifact.write / write）被执行前重查挡下（默认只读不变）；
 *   · admin 授予 write → 同一条重查放行；审计行（capability-updated，前后值）与写入同在；
 *   · admin 撤销 → 配置行删除，重查重新挡下；审计行 capability-disabled；
 *   · 非 admin → 403 NOT_ORG_ADMIN，库内未变，留下 unauthorized-attempt；
 *   · 目录外的分类 → 404 UNKNOWN_CAPABILITY，库内未变；
 *   · controller 响应过契约 `.strict()`。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { workflowCapabilityGrants as C } from "@repo/contracts";
import { ComposedEffectPermissionRecheck } from "../../src/application/workflow/effect-permission-recheck";
import { WorkflowCapabilityGrantService, buildCapabilityCatalog } from "../../src/application/workflow/workflow-capability-grants";
import type { WorkflowAccessPort } from "../../src/application/workflow/workflow-runtime-ports";
import { PRODUCT_LINE_WORKFLOWS } from "../../src/domain/work-content/product-workflow-definitions";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgProvenanceRepository } from "../../src/infrastructure/provenance/pg-provenance-repository";
import { PgEffectCapabilityAuthority, PgWorkflowCapabilityGrantStore } from "../../src/infrastructure/workflow/pg-effect-capability-authority";
import { WorkflowCapabilityGrantController } from "../../src/interface/controllers/workflow-capability-grant.controller";
import { toOrgId } from "../../src/domain/org-id";
import { addOrgMember, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const ORG = "org-wf-cap-grants";
const ADMIN = "u-wf-cap-admin";
const MEMBER = "u-wf-cap-member";

const W029 = PRODUCT_LINE_WORKFLOWS.find((w) => w.workflowId === "W029")!;
const PERSIST = W029.stages.find((s) => s.stageId === "persist")!;

/** 只测能力这条腿：成员资格 / Agent 版本两条腿恒放行。 */
const ALLOW_ACCESS: WorkflowAccessPort = {
  orgRoleOf: async () => "member",
  runnableAgentVersion: async () => "v1",
  workflowAllowlistRefusal: async () => null,
};

let db: PgDatabase;
let controller: WorkflowCapabilityGrantController;
let recheck: ComposedEffectPermissionRecheck;

const principal = (userId: string) => ({ userId, orgId: toOrgId(ORG) }) as never;

function recheckPersist() {
  return recheck.recheck({
    orgId: ORG, instanceId: "wi-x", stageId: PERSIST.stageId, workflowKey: W029.key,
    capabilityCategory: PERSIST.capabilityCategories[0]!, sideEffect: PERSIST.sideEffect,
    initiatorUserId: MEMBER, agentId: "agent-x", agentVersionId: "v1",
  } as never);
}

async function grantRows() {
  const r = await asOwner((c) => c.query("SELECT capability_category, side_effect_cap, updated_by FROM workflow_capability_grants WHERE org_id = $1", [ORG]));
  return r.rows;
}

async function auditRows(type: string) {
  const r = await asOwner((c) =>
    c.query<{ actor_id: string; target_id: string; detail: Record<string, unknown> }>(
      "SELECT actor_id, target_id, detail FROM provenance_events WHERE org_id = $1 AND type = $2 ORDER BY at", [ORG, type]),
  );
  return r.rows;
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  const provenance = new PgProvenanceRepository(db);
  controller = new WorkflowCapabilityGrantController(new WorkflowCapabilityGrantService({
    identity: new PgIdentityRepository(db),
    store: new PgWorkflowCapabilityGrantStore(db),
    provenanceWriter: provenance,
    provenanceReader: provenance,
  }));
  recheck = new ComposedEffectPermissionRecheck(ALLOW_ACCESS, new PgEffectCapabilityAuthority(db));
}, 60_000);

afterAll(async () => {
  await resetOrgs(ORG);
  await db?.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: `proj-${ORG}` });
  await addOrgMember(ORG, ADMIN, "admin", null);
  await addOrgMember(ORG, MEMBER, "consultant", null);
});

describe("workflow capability grants admin surface", () => {
  it("catalog: W029 needs artifact.write (persist) and notify.inapp (estimate/notify) at write", () => {
    const w = buildCapabilityCatalog().find((e) => e.workflowId === "W029")!;
    expect(w.capabilities).toEqual(expect.arrayContaining([
      { capabilityCategory: "artifact.write", requiredCap: "write", stageIds: ["persist"] },
      { capabilityCategory: "notify.inapp", requiredCap: "write", stageIds: ["estimate", "notify"] },
    ]));
  });

  it("no grant → W029 persist blocked; admin grants write → passes + audit row; revoke → blocked again + audit row", async () => {
    expect(await recheckPersist()).toEqual({ ok: false, reasonCode: "capability_exceeds_side_effect_cap" });

    const granted = await controller.grant("artifact.write", { sideEffectCap: "write" }, principal(ADMIN));
    expect(granted).toMatchObject({ capabilityCategory: "artifact.write", configured: true, authorized: true, sideEffectCap: "write", updatedBy: ADMIN });
    expect(await grantRows()).toEqual([{ capability_category: "artifact.write", side_effect_cap: "write", updated_by: ADMIN }]);
    expect(await recheckPersist()).toEqual({ ok: true });
    const upd = await auditRows("capability-updated");
    expect(upd).toHaveLength(1);
    expect(upd[0]).toMatchObject({ actor_id: ADMIN, target_id: "workflow-capability:artifact.write", detail: { capabilityCategory: "artifact.write", from: "read", to: "write" } });

    const revoked = await controller.revoke("artifact.write", principal(ADMIN));
    expect(revoked).toMatchObject({ configured: false, sideEffectCap: "read" });
    expect(await grantRows()).toEqual([]);
    expect(await recheckPersist()).toEqual({ ok: false, reasonCode: "capability_exceeds_side_effect_cap" });
    const dis = await auditRows("capability-disabled");
    expect(dis).toHaveLength(1);
    expect(dis[0]!.detail).toMatchObject({ from: "write", to: "read" });

    const listed = await controller.list(principal(ADMIN));
    expect(C.operations.listWorkflowCapabilityGrants.out.safeParse(listed).success).toBe(true);
    expect(listed.audit.map((a) => a.action)).toEqual(["revoked", "granted"]);
    expect(listed.grants.find((g) => g.capabilityCategory === "artifact.write")).toMatchObject({ configured: false, sideEffectCap: "read" });
  });

  it("non-admin → 403 NOT_ORG_ADMIN on list/grant/revoke, nothing written, unauthorized-attempt recorded", async () => {
    await expect(controller.list(principal(MEMBER))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.grant("artifact.write", { sideEffectCap: "write" }, principal(MEMBER))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.revoke("artifact.write", principal(MEMBER))).rejects.toBeInstanceOf(ForbiddenException);
    expect(await grantRows()).toEqual([]);
    expect(await auditRows("capability-updated")).toEqual([]);
    const attempts = await auditRows("unauthorized-attempt");
    expect(attempts).toHaveLength(3);
    expect(attempts.every((a) => a.actor_id === MEMBER && a.detail.reasonCode === "NOT_ORG_ADMIN")).toBe(true);
    expect(await recheckPersist()).toEqual({ ok: false, reasonCode: "capability_exceeds_side_effect_cap" });
  });

  it("category outside the built-in catalog → 404 UNKNOWN_CAPABILITY, nothing written", async () => {
    await expect(controller.grant("mail.send.everyone", { sideEffectCap: "external_send" }, principal(ADMIN))).rejects.toBeInstanceOf(NotFoundException);
    expect(await grantRows()).toEqual([]);
    expect(await auditRows("capability-updated")).toEqual([]);
  });
});
