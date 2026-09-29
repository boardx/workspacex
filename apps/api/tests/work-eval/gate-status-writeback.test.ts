/**
 * EV04（Phase 20，04-eval-gates R5 / R7 / R8；契约束 work-eval UC-5 / UC-6，E9 / A4）：
 * 门状态回写 `POST /admin/skills/catalog/:skillId/gate-status` 与读取 `GET /skills/catalog/:skillId/gate-status`。
 *
 * 真实 HTTP + 真实 PostgreSQL；目录行由真实 starter-pack 导入产生。
 * - 平台运营回写 WorkGateStatus → 当前版本门状态可读；非平台运营（含组织管理员）403 且门状态不变；
 * - 只接受 WorkGateStatus 结构（缺门/多字段 422）；stableId 不符 422；digest 不对应任何版本 409；
 * - 幂等：同键同体重放 200 不重复写，同键异体 409；
 * - 新版本导入后当前门状态「未评测」，旧版本记录保留（?versionId= 可读）。
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addCredential, addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { CONTRACT, importWorkPack, MEETING, RESEARCH, writeWorkPack } from "../work-skill/support/catalog-fixture";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-ev04-gates";
const OTHER_ORG = "org-ev04-gates-other";
const OPS = "u-ev04-ops";
const OPS_EMAIL = "ev04-ops@example.test";
const ADMIN = "u-ev04-admin";
const MEMBER = "u-ev04-member";
const OUTSIDER = "u-ev04-outsider";
const PACK = "ev04-gates-pack";
const ORIGINAL_WHITELIST = process.env.PLATFORM_SUPERUSER_EMAILS;

let app: NestExpressApplication;
let base = "";
let packRoot = "";
let S3 = "";
let S3V1 = "";

const GATES = ["G0", "G1", "G2", "G3", "G4", "G5"] as const;

async function versionDigest(versionId: string): Promise<string> {
  return asApp(ORG, async (c) => `sha256:${(await c.query<{ content_digest: string }>(
    "SELECT content_digest FROM skill_versions WHERE org_id=$1 AND id=$2", [ORG, versionId])).rows[0]!.content_digest}`);
}

function status(digest: string, overrides: Record<string, unknown> = {}) {
  return {
    stableId: "S003",
    subjectVersionDigest: digest,
    gates: GATES.map((gate) => gate === "G5"
      ? { gate, outcome: "fail", reasonCode: "NOT_BETTER_THAN_BASELINE", reason: "6/10 vs 6/10 持平即失败" }
      : { gate, outcome: "pass", reasonCode: "OK", reason: "ok" }),
    evidenceReportPath: "evals/work-stack/S003/reports/run-1.json",
    subjectPassed: 6,
    baselinePassed: 6,
    deterministicTotal: 10,
    decidedAt: "2026-09-29T01:02:03.000Z",
    scriptVersion: "lint-work-stack-gates@1",
    ...overrides,
  };
}

async function post(skillId: string, body: Record<string, unknown>, user = OPS, org = ORG) {
  const response = await fetch(`${base}/admin/skills/catalog/${skillId}/gate-status`, {
    method: "POST",
    headers: { "x-kernel-test-principal": `${user}:${org}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as any };
}

async function get(skillId: string, query = "", user = MEMBER, org = ORG) {
  const response = await fetch(`${base}/skills/catalog/${skillId}/gate-status${query}`, {
    headers: { "x-kernel-test-principal": `${user}:${org}` },
  });
  return { status: response.status, body: await response.json() as any };
}

async function records() {
  return asApp(ORG, async (c) => (await c.query<{ skill_version_id: string; written_by: string }>(
    "SELECT skill_version_id, written_by FROM skill_gate_records WHERE org_id=$1 ORDER BY created_at", [ORG])).rows);
}

async function events() {
  return asApp(ORG, async (c) => (await c.query<{ id: string }>(
    "SELECT id FROM skill_gate_writeback_events WHERE org_id=$1", [ORG])).rows);
}

beforeAll(async () => {
  packRoot = mkdtempSync(join(tmpdir(), "ev04-packs-"));
  process.env.SKILL_STARTER_PACK_ROOT = packRoot;
  writeWorkPack(packRoot, PACK, "1.0.0", [RESEARCH, MEETING, CONTRACT]);
  writeWorkPack(packRoot, PACK, "1.1.0", [{ ...RESEARCH, semanticVersion: "1.1.0", description: "v1.1 brief" }, MEETING, CONTRACT]);
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  await addCredential(OPS, OPS_EMAIL, "EV04 Ops");
  process.env.PLATFORM_SUPERUSER_EMAILS = OPS_EMAIL;
  // I-10：隔离测试把一次性 ORG 当作官方平台组织目录（生产 = PLATFORM_ORG_ID）。
  process.env.WORK_GATE_OFFICIAL_ORG_ID = ORG;
}, 180_000);

afterAll(async () => {
  delete process.env.WORK_GATE_OFFICIAL_ORG_ID;
  if (ORIGINAL_WHITELIST === undefined) delete process.env.PLATFORM_SUPERUSER_EMAILS;
  else process.env.PLATFORM_SUPERUSER_EMAILS = ORIGINAL_WHITELIST;
  await app?.close();
  await resetOrgs(ORG, OTHER_ORG);
  rmSync(packRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetOrgs(ORG, OTHER_ORG);
  const fixture = await seedOrg({ orgId: ORG, projectId: `${ORG}-project` });
  await addOrgMember(ORG, OPS, "admin", fixture.teams.energy!);
  await addOrgMember(ORG, ADMIN, "admin", fixture.teams.energy!);
  await addOrgMember(ORG, MEMBER, "consultant", fixture.teams.energy!);
  const other = await seedOrg({ orgId: OTHER_ORG, projectId: `${OTHER_ORG}-project` });
  await addOrgMember(OTHER_ORG, OUTSIDER, "admin", other.teams.energy!);
  const imported = await importWorkPack(base, `${ADMIN}:${ORG}`, PACK, "1.0.0");
  S3 = imported.skillIds[0]!;
  S3V1 = imported.versionIds[0]!;
});

describe("EV04 GET gate-status before any write-back", () => {
  it("current version with no record → six not_evaluated badges, no counts (A4)", async () => {
    const res = await get(S3);
    expect(res.status).toBe(200);
    expect(res.body.skillVersionId).toBe(S3V1);
    expect(res.body.semanticLabel).toBe("1.0.0");
    expect(res.body.gates.map((g: any) => [g.gate, g.state])).toEqual(GATES.map((g) => [g, "not_evaluated"]));
    expect(res.body).toMatchObject({ subjectPassed: null, baselinePassed: null, decidedAt: null, stale: false, canMarkVerified: false });
  });

  it("outsider (other org) gets 404, not a leak", async () => {
    expect((await get(S3, "", OUTSIDER, OTHER_ORG)).status).toBe(404);
  });
});

describe("EV04 platform operator write-back", () => {
  it("writes the WorkGateStatus for the current version and members see it; report path is not exposed (R5)", async () => {
    const digest = await versionDigest(S3V1);
    const res = await post(S3, { status: status(digest), idempotencyKey: randomUUID() });
    expect(res.status).toBe(200);
    expect(res.body.skillVersionId).toBe(S3V1);
    const view = await get(S3);
    expect(view.status).toBe(200);
    expect(view.body.gates.find((g: any) => g.gate === "G4")).toEqual({ gate: "G4", state: "pass", reasonCode: "OK", reason: "ok" });
    expect(view.body.gates.find((g: any) => g.gate === "G5")).toMatchObject({ state: "fail", reasonCode: "NOT_BETTER_THAN_BASELINE" });
    expect(view.body).toMatchObject({ subjectPassed: 6, baselinePassed: 6, deterministicTotal: 10, decidedAt: "2026-09-29T01:02:03.000Z", stale: false });
    expect(view.body.markVerifiedBlockedReason).toBe("NOT_BETTER_THAN_BASELINE");
    expect(JSON.stringify(view.body)).not.toContain("reports/run-1.json");
    expect(await records()).toEqual([{ skill_version_id: S3V1, written_by: OPS }]);
  });

  it("G5 pass → operator sees canMarkVerified, member does not", async () => {
    const digest = await versionDigest(S3V1);
    const passing = status(digest, {
      subjectPassed: 9,
      gates: GATES.map((gate) => ({ gate, outcome: "pass", reasonCode: "OK", reason: "ok" })),
    });
    expect((await post(S3, { status: passing, idempotencyKey: randomUUID() })).status).toBe(200);
    expect((await get(S3, "", OPS)).body.canMarkVerified).toBe(true);
    expect((await get(S3)).body.canMarkVerified).toBe(false);
  });

  it("idempotent replay returns 200 without a second event; same key with a different body → 409", async () => {
    const digest = await versionDigest(S3V1);
    const key = randomUUID();
    expect((await post(S3, { status: status(digest), idempotencyKey: key })).status).toBe(200);
    expect((await post(S3, { status: status(digest), idempotencyKey: key })).status).toBe(200);
    expect(await events()).toHaveLength(1);
    const clash = await post(S3, { status: status(digest, { subjectPassed: 7 }), idempotencyKey: key });
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe("WORK_EVAL_IDEMPOTENCY_CONFLICT");
  });
});

describe("EV04 rejected write-backs change nothing", () => {
  async function expectUnchanged(fn: () => Promise<void>) {
    const before = await get(S3);
    const recBefore = await records();
    await fn();
    expect(await get(S3)).toEqual(before);
    expect(await records()).toEqual(recBefore);
  }

  it("org admin / member (not platform operator) → 403 WORK_EVAL_PLATFORM_ADMIN_REQUIRED (E9)", async () => {
    const digest = await versionDigest(S3V1);
    await expectUnchanged(async () => {
      for (const user of [ADMIN, MEMBER]) {
        const res = await post(S3, { status: status(digest), idempotencyKey: randomUUID() }, user);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe("WORK_EVAL_PLATFORM_ADMIN_REQUIRED");
      }
    });
  });

  it("platform operator writing into a non-official org's catalog → 403, nothing written (I-10)", async () => {
    const digest = await versionDigest(S3V1);
    const recBefore = await records();
    const res = await post(S3, { status: status(digest), idempotencyKey: randomUUID() }, OPS, OTHER_ORG);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("WORK_EVAL_PLATFORM_ADMIN_REQUIRED");
    expect(await records()).toEqual(recBefore);
    const otherRows = await asApp(OTHER_ORG, async (c) => (await c.query(
      "SELECT 1 FROM skill_gate_records WHERE org_id=$1", [OTHER_ORG])).rows);
    expect(otherRows).toHaveLength(0);
  });

  it("hand-edited gate fields (missing gate / extra field / non-WorkGateStatus) → 422 (R5)", async () => {
    const digest = await versionDigest(S3V1);
    await expectUnchanged(async () => {
      const bad = [
        status(digest, { gates: status(digest).gates.slice(0, 5) }),
        { ...status(digest), channel: "verified" },
        { G5: "pass" },
      ];
      for (const s of bad) {
        const res = await post(S3, { status: s, idempotencyKey: randomUUID() });
        expect(res.status).toBe(422);
        expect(res.body.code).toBe("VALIDATION_FAILED");
      }
    });
  });

  it("stableId mismatch → 422; unknown digest → 409; unknown skill → 404", async () => {
    const digest = await versionDigest(S3V1);
    await expectUnchanged(async () => {
      const wrongId = await post(S3, { status: status(digest, { stableId: "S004" }), idempotencyKey: randomUUID() });
      expect(wrongId.status).toBe(422);
      expect(wrongId.body.code).toBe("WORK_EVAL_STABLE_ID_MISMATCH");
      const wrongDigest = await post(S3, { status: status(`sha256:${"0".repeat(64)}`), idempotencyKey: randomUUID() });
      expect(wrongDigest.status).toBe(409);
      expect(wrongDigest.body.code).toBe("WORK_EVAL_DIGEST_MISMATCH");
      const missing = await post("skill-missing", { status: status(digest), idempotencyKey: randomUUID() });
      expect(missing.status).toBe(404);
    });
  });
});

describe("EV04 new version import (A4 / I-2)", () => {
  it("after importing a new version the current gate status is not_evaluated; the old version's record is kept", async () => {
    const digest = await versionDigest(S3V1);
    expect((await post(S3, { status: status(digest), idempotencyKey: randomUUID() })).status).toBe(200);
    await importWorkPack(base, `${ADMIN}:${ORG}`, PACK, "1.1.0");
    const current = await get(S3);
    expect(current.body.semanticLabel).toBe("1.1.0");
    expect(current.body.skillVersionId).not.toBe(S3V1);
    expect(current.body.gates.every((g: any) => g.state === "not_evaluated")).toBe(true);
    expect(current.body.decidedAt).toBeNull();
    // V16 / E4：服务端产出 stale（当前版本尚未重评），不是只靠 UI 夹具注入。
    expect(current.body.stale).toBe(true);
    const old = await get(S3, `?versionId=${S3V1}`);
    expect(old.status).toBe(200);
    expect(old.body.stale).toBe(true);
    expect(old.body.semanticLabel).toBe("1.0.0");
    expect(old.body.gates.find((g: any) => g.gate === "G4").state).toBe("pass");
    expect(await records()).toHaveLength(1);
  });
});
