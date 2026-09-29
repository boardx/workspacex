/**
 * EV05（Phase 20，04-eval-gates R3.7 / R3.8 / R3.11；契约束 work-eval UC-4 / UC-7，I-6 / I-8，E5 / E6）：
 * G5 对比基线判定 + verified 通道联动。
 *
 * - `decideG5`：subject 确定性通过数**严格大于**基线且必过 case（S003 = E2/E3/E6）全过才 pass；持平即失败、
 *   无基线即失败、G0–G4 未全过即失败（门顺序）。
 * - `PATCH /admin/skills/catalog/:skillId` candidate→verified 以**当前版本**门状态记录为准：
 *   G5 pass → 200；G5 fail / 无记录 / 只有旧版本记录 → 409 WORK_EVAL_G5_NOT_PASSED，行与审计都不变；
 *   客户端自带 gateEvidenceRef 不再能放行（取代 WS03 临时判据）。
 * - 官方 Agent 绑定非 verified Skill → 422 UNRESOLVED_SKILL_REF，无 agent 行；verified 后同一绑定成功。
 *
 * 真实 HTTP + 真实 PostgreSQL；目录行由真实 starter-pack 导入产生。
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { decideG5 } from "@repo/contracts/work-eval";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildOfficialAgentRolePack } from "../../src/domain/agent/official-role-packs";
import { decideCatalogEntryChange } from "../../src/domain/skill/work-skill-catalog";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { CONTRACT, importWorkPack, MEETING, RESEARCH, writeWorkPack } from "../work-skill/support/catalog-fixture";
import { currentVersion, seedGateRecord } from "./support/gate-record";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-ev05-verified";
const ADMIN = "u-ev05-admin";
const MEMBER = "u-ev05-member";
const PACK = "ev05-verified-pack";

let app: NestExpressApplication;
let base = "";
let packRoot = "";
let agentPackRoot = "";
let S3 = "";
let S4 = "";

async function patch(skillId: string, body: Record<string, unknown>, user = ADMIN) {
  const response = await fetch(`${base}/admin/skills/catalog/${skillId}`, {
    method: "PATCH",
    headers: { "x-kernel-test-principal": `${user}:${ORG}`, "content-type": "application/json" },
    body: JSON.stringify({ idempotencyKey: randomUUID(), ...body }),
  });
  return { status: response.status, body: await response.json() as any };
}

async function channelOf(skillId: string) {
  return asApp(ORG, async (c) => (await c.query<{ channel: string }>(
    "SELECT channel FROM skill_catalog_entries WHERE org_id=$1 AND skill_id=$2", [ORG, skillId])).rows[0]!.channel);
}

async function channelEvents() {
  return asApp(ORG, async (c) => (await c.query<{ skill_id: string; to_channel: string }>(
    "SELECT skill_id, to_channel FROM skill_catalog_channel_events WHERE org_id=$1 ORDER BY created_at, id", [ORG])).rows);
}

async function agentCount() {
  return asApp(ORG, async (c) => Number((await c.query<{ n: string }>("SELECT count(*)::text AS n FROM agents WHERE org_id=$1", [ORG])).rows[0]!.n));
}

const toVerified = { expectedChannel: "candidate", channel: "verified" };

beforeAll(async () => {
  packRoot = mkdtempSync(join(tmpdir(), "ev05-packs-"));
  agentPackRoot = mkdtempSync(join(tmpdir(), "ev05-agent-packs-"));
  process.env.SKILL_STARTER_PACK_ROOT = packRoot;
  process.env.AGENT_STARTER_PACK_ROOT = agentPackRoot;
  writeWorkPack(packRoot, PACK, "1.0.0", [RESEARCH, MEETING, CONTRACT]);
  writeWorkPack(packRoot, PACK, "1.1.0", [{ ...RESEARCH, semanticVersion: "1.1.0", description: "v1.1 brief" }, MEETING, CONTRACT]);
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}, 180_000);

afterAll(async () => {
  await app?.close();
  await resetOrgs(ORG);
  rmSync(packRoot, { recursive: true, force: true });
  rmSync(agentPackRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetOrgs(ORG);
  const fixture = await seedOrg({ orgId: ORG, projectId: `${ORG}-project` });
  await addOrgMember(ORG, ADMIN, "admin", fixture.teams.energy!);
  await addOrgMember(ORG, MEMBER, "consultant", fixture.teams.energy!);
  const imported = await importWorkPack(base, `${ADMIN}:${ORG}`, PACK, "1.0.0");
  [S3, S4] = imported.skillIds as [string, string];
});

describe("EV05 decideG5 — strictly better than baseline and every must-pass case passes", () => {
  const ok = { priorGatesPassed: true, mustPassAllPassed: true };
  it("subject > baseline with must-pass all passing → pass", () => {
    expect(decideG5({ ...ok, subjectPassed: 7, baselinePassed: 5 })).toEqual({ outcome: "pass", reasonCode: "OK" });
  });
  it("tie fails (E6: 持平即失败)", () => {
    expect(decideG5({ ...ok, subjectPassed: 6, baselinePassed: 6 })).toEqual({ outcome: "fail", reasonCode: "NOT_BETTER_THAN_BASELINE" });
    expect(decideG5({ ...ok, subjectPassed: 4, baselinePassed: 6 }).reasonCode).toBe("NOT_BETTER_THAN_BASELINE");
  });
  it("no baseline fails (E5)", () => {
    expect(decideG5({ ...ok, subjectPassed: 10, baselinePassed: null })).toEqual({ outcome: "fail", reasonCode: "NO_BASELINE" });
  });
  it("a must-pass case failing fails even when strictly better (E6)", () => {
    expect(decideG5({ ...ok, mustPassAllPassed: false, subjectPassed: 9, baselinePassed: 1 })).toEqual({ outcome: "fail", reasonCode: "MUST_PASS_CASE_FAILED" });
  });
  it("G0–G4 not all passed → G5 fails first (gate order)", () => {
    expect(decideG5({ priorGatesPassed: false, mustPassAllPassed: true, subjectPassed: 9, baselinePassed: 1 }).reasonCode).toBe("PRIOR_GATE_FAILED");
  });
});

describe("EV05 domain rule: verified is decided by the current version's G5, not by client evidence", () => {
  const state = { skillId: "s", channel: "candidate" as const, successorSkillId: null };
  it("gateEvidenceRef alone no longer unlocks verified", () => {
    const d = decideCatalogEntryChange(state, { expectedChannel: "candidate", channel: "verified", gateEvidenceRef: "evals/x" }, new Map([["s", null]]), null);
    expect(d.kind).toBe("g5-not-passed");
  });
  it("G5 fail → g5-not-passed with its reason code; G5 pass → ok", () => {
    const fail = decideCatalogEntryChange(state, { expectedChannel: "candidate", channel: "verified" }, new Map([["s", null]]), { outcome: "fail", reasonCode: "NOT_BETTER_THAN_BASELINE" });
    expect(fail).toMatchObject({ kind: "g5-not-passed", reasonCode: "NOT_BETTER_THAN_BASELINE" });
    const pass = decideCatalogEntryChange(state, { expectedChannel: "candidate", channel: "verified" }, new Map([["s", null]]), { outcome: "pass", reasonCode: "OK" });
    expect(pass).toMatchObject({ kind: "ok", next: { channel: "verified" } });
  });
});

describe("EV05 PATCH candidate→verified reads the gate-status record", () => {
  it("G5 pass on the current version → 200 verified with an audit event", async () => {
    await seedGateRecord(ORG, S3, "S003", "pass", ADMIN);
    const res = await patch(S3, toVerified);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ skillId: S3, channel: "verified" });
    expect(await channelOf(S3)).toBe("verified");
    expect(await channelEvents()).toEqual([{ skill_id: S3, to_channel: "verified" }]);
  });

  for (const g5 of ["tie", "no-baseline", "must-pass-failed"] as const) {
    it(`G5 fail (${g5}) → 409 WORK_EVAL_G5_NOT_PASSED, channel and audit unchanged`, async () => {
      await seedGateRecord(ORG, S3, "S003", g5, ADMIN);
      const res = await patch(S3, { ...toVerified, gateEvidenceRef: "evals/work-stack/S003/reports/run-1.json" });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("WORK_EVAL_G5_NOT_PASSED");
      expect(await channelOf(S3)).toBe("candidate");
      expect(await channelEvents()).toEqual([]);
    });
  }

  it("no gate-status record (not evaluated) → 409", async () => {
    const res = await patch(S4, toVerified);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("WORK_EVAL_G5_NOT_PASSED");
    expect(await channelOf(S4)).toBe("candidate");
  });

  it("G5 pass only on the old version after a new version is imported → 409 (record is per version)", async () => {
    await seedGateRecord(ORG, S3, "S003", "pass", ADMIN);
    await importWorkPack(base, `${ADMIN}:${ORG}`, PACK, "1.1.0");
    const res = await patch(S3, toVerified);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("WORK_EVAL_G5_NOT_PASSED");
    await seedGateRecord(ORG, S3, "S003", "pass", ADMIN);
    expect((await patch(S3, toVerified)).status).toBe(200);
  });

  it("members still cannot change the channel (403 before the gate check)", async () => {
    await seedGateRecord(ORG, S3, "S003", "pass", ADMIN);
    expect((await patch(S3, toVerified, MEMBER)).status).toBe(403);
    expect(await channelOf(S3)).toBe("candidate");
  });
});

describe("EV05 official Agent binding requires a verified Skill (ADR-119 #4, I-8)", () => {
  function writeBindingPack(packId: string, versionId: string, digestHex: string) {
    const real = buildOfficialAgentRolePack();
    const a = real.agents[0]!;
    const agent = {
      stableName: a.stableName, name: a.name, semanticVersion: a.semanticVersion, instructions: a.instructions,
      instructionDigest: a.instructionDigest, skillVersions: [{ versionId, digest: digestHex }],
      modelProvider: a.modelProvider, modelId: a.modelId, toolPolicy: a.toolPolicy, roleRef: a.roleRef, roleLabel: a.roleLabel,
      role: {
        avatar: a.role.avatar, roleCategory: a.role.roleCategory, workflowAllowlist: a.role.workflowAllowlist,
        delegationPolicy: a.role.delegationPolicy, escalationPolicy: a.role.escalationPolicy, kpi: a.role.kpi,
      },
    };
    const unsigned = { schemaVersion: 1 as const, packId, packVersion: "1.0.0", agents: [agent] };
    const dir = join(agentPackRoot, packId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "1.0.0.json"), JSON.stringify({ ...unsigned, packDigest: createHash("sha256").update(JSON.stringify(unsigned)).digest("hex") }));
  }
  const importAgents = (packId: string) => fetch(`${base}/admin/agents/starter-pack-imports`, {
    method: "POST",
    headers: { "x-kernel-test-principal": `${ADMIN}:${ORG}`, "content-type": "application/json" },
    body: JSON.stringify({ packId, packVersion: "1.0.0", idempotencyKey: randomUUID() }),
  });

  it("candidate skill → 422 UNRESOLVED_SKILL_REF and no agent rows; verified → bound", async () => {
    const v = await currentVersion(ORG, S3);
    const packId = `ev05-bind-${randomUUID().slice(0, 8)}`;
    writeBindingPack(packId, v.id, v.digest.slice("sha256:".length));

    const rejected = await importAgents(packId);
    expect(rejected.status).toBe(422);
    const body = await rejected.json() as { reasonCode: string; detail: { missingIds: string[] } };
    expect(body.reasonCode).toBe("UNRESOLVED_SKILL_REF");
    expect(body.detail.missingIds).toEqual([v.id]);
    expect(await agentCount()).toBe(0);

    await seedGateRecord(ORG, S3, "S003", "pass", ADMIN);
    expect((await patch(S3, toVerified)).status).toBe(200);
    const bound = await importAgents(packId);
    expect(bound.status).toBe(201);
    expect(await agentCount()).toBe(1);
  });
});
