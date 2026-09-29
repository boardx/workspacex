/**
 * WS03（Phase 20，R3.9 / R7 / E3 E4 E9 / R5）：PATCH /admin/skills/catalog/:skillId 通道与后继变更。
 *
 * 合法转移只有 candidate→verified（须 gateEvidenceRef）、candidate→deprecated、verified→deprecated；
 * 其余 409 并回 allowedTransitions。后继不存在/自指/成环 422。非管理员 403、跨组织 404、未登录 401。
 * 每次成功变更同事务写审计行；拒绝的请求不改行、不写审计。
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { CONTRACT, importWorkPack, MEETING, RESEARCH, writeWorkPack } from "./support/catalog-fixture";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-ws03-channel";
const OTHER_ORG = "org-ws03-channel-other";
const ADMIN = "u-ws03-ch-admin";
const MEMBER = "u-ws03-ch-member";
const OUTSIDER = "u-ws03-ch-outsider";
const PACK = "ws03-channel-pack";

let app: NestExpressApplication;
let base = "";
let packRoot = "";
let S3 = "";
let S4 = "";
let S5 = "";

async function patch(skillId: string, body: Record<string, unknown>, user = ADMIN, org = ORG) {
  const response = await fetch(`${base}/admin/skills/catalog/${skillId}`, {
    method: "PATCH",
    headers: { "x-kernel-test-principal": `${user}:${org}`, "content-type": "application/json" },
    body: JSON.stringify({ idempotencyKey: randomUUID(), ...body }),
  });
  return { status: response.status, body: await response.json() as any };
}

async function entry(skillId: string) {
  return asApp(ORG, async (c) => (await c.query<{ channel: string; successor_skill_id: string | null; updated_by: string }>(
    "SELECT channel, successor_skill_id, updated_by FROM skill_catalog_entries WHERE org_id=$1 AND skill_id=$2", [ORG, skillId])).rows[0]!);
}

async function events() {
  return asApp(ORG, async (c) => (await c.query<{
    skill_id: string; from_channel: string; to_channel: string; to_successor_id: string | null; gate_evidence_ref: string | null; actor_id: string;
  }>(`SELECT skill_id, from_channel, to_channel, to_successor_id, gate_evidence_ref, actor_id
        FROM skill_catalog_channel_events WHERE org_id=$1 ORDER BY created_at, id`, [ORG])).rows);
}

async function listed(query = "") {
  const response = await fetch(`${base}/skills/catalog${query}`, { headers: { "x-kernel-test-principal": `${MEMBER}:${ORG}` } });
  return ((await response.json()) as { items: Array<{ stableId: string; channel: string }> }).items;
}

beforeAll(async () => {
  packRoot = mkdtempSync(join(tmpdir(), "ws03-ch-packs-"));
  process.env.SKILL_STARTER_PACK_ROOT = packRoot;
  writeWorkPack(packRoot, PACK, "1.0.0", [RESEARCH, MEETING, CONTRACT]);
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
  await app?.close();
  await resetOrgs(ORG, OTHER_ORG);
  rmSync(packRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetOrgs(ORG, OTHER_ORG);
  const fixture = await seedOrg({ orgId: ORG, projectId: `${ORG}-project` });
  await addOrgMember(ORG, ADMIN, "admin", fixture.teams.energy!);
  await addOrgMember(ORG, MEMBER, "consultant", fixture.teams.energy!);
  const other = await seedOrg({ orgId: OTHER_ORG, projectId: `${OTHER_ORG}-project` });
  await addOrgMember(OTHER_ORG, OUTSIDER, "admin", other.teams.energy!);
  const imported = await importWorkPack(base, `${ADMIN}:${ORG}`, PACK, "1.0.0");
  [S3, S4, S5] = imported.skillIds as [string, string, string];
});

describe("WS03 legal transitions update the row, write an audit event, and show up in the catalog", () => {
  it("candidate → verified with gateEvidenceRef", async () => {
    const res = await patch(S3, { expectedChannel: "candidate", channel: "verified", gateEvidenceRef: "evals/work-stack/S003/run-1" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ skillId: S3, stableId: "S003", channel: "verified" });
    expect(await entry(S3)).toMatchObject({ channel: "verified", updated_by: ADMIN });
    expect(await events()).toEqual([{
      skill_id: S3, from_channel: "candidate", to_channel: "verified", to_successor_id: null,
      gate_evidence_ref: "evals/work-stack/S003/run-1", actor_id: ADMIN,
    }]);
    expect((await listed("?channel=verified")).map((i) => i.stableId)).toEqual(["S003"]);
  });

  it("verified → deprecated with a successor; deprecated is hidden by default", async () => {
    expect((await patch(S3, { expectedChannel: "candidate", channel: "verified", gateEvidenceRef: "g" })).status).toBe(200);
    const res = await patch(S3, { expectedChannel: "verified", channel: "deprecated", successorSkillId: S4 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ channel: "deprecated", successorSkillId: S4 });
    expect((await listed()).map((i) => i.stableId)).toEqual(["S004", "S005"]);
    expect((await events()).map((e) => `${e.from_channel}->${e.to_channel}`)).toEqual(["candidate->verified", "verified->deprecated"]);
  });

  it("candidate → deprecated", async () => {
    expect((await patch(S5, { expectedChannel: "candidate", channel: "deprecated" })).status).toBe(200);
    expect((await entry(S5)).channel).toBe("deprecated");
  });

  it("replaying the same idempotency key returns the current row without a second audit event", async () => {
    const key = randomUUID();
    const body = { expectedChannel: "candidate", channel: "deprecated", idempotencyKey: key };
    expect((await patch(S5, body)).status).toBe(200);
    const replay = await patch(S5, body);
    expect(replay.status).toBe(200);
    expect(replay.body.channel).toBe("deprecated");
    expect(await events()).toHaveLength(1);
    const clash = await patch(S4, { ...body });
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe("WORK_SKILL_IDEMPOTENCY_CONFLICT");
  });
});

describe("WS03 no-op change", () => {
  it("a PATCH that changes nothing returns 200 and writes no UPDATE and no audit event", async () => {
    const before = await entry(S3);
    const eventsBefore = await events();
    const res = await patch(S3, { expectedChannel: "candidate", channel: "candidate", idempotencyKey: randomUUID() });
    expect(res.status).toBe(200);
    expect(res.body.channel).toBe("candidate");
    expect(await entry(S3)).toEqual(before);
    expect(await events()).toEqual(eventsBefore);
  });
});

describe("WS03 illegal requests are rejected and change nothing", () => {
  async function expectUnchanged(fn: () => Promise<void>) {
    const before = [await entry(S3), await entry(S4), await entry(S5)];
    const eventsBefore = await events();
    await fn();
    expect([await entry(S3), await entry(S4), await entry(S5)]).toEqual(before);
    expect(await events()).toEqual(eventsBefore);
  }

  it("candidate → verified without gate evidence → 409 with allowed transitions (E4)", async () => {
    await expectUnchanged(async () => {
      const res = await patch(S3, { expectedChannel: "candidate", channel: "verified" });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("WORK_SKILL_CHANNEL_TRANSITION_INVALID");
      expect(res.body.allowedTransitions).toEqual(["verified", "deprecated"]);
    });
  });

  it("deprecated → verified / candidate → 409; deprecated is terminal (E4)", async () => {
    expect((await patch(S3, { expectedChannel: "candidate", channel: "deprecated" })).status).toBe(200);
    await expectUnchanged(async () => {
      for (const channel of ["verified", "candidate"]) {
        const res = await patch(S3, { expectedChannel: "deprecated", channel, gateEvidenceRef: "g" });
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("WORK_SKILL_CHANNEL_TRANSITION_INVALID");
        expect(res.body.allowedTransitions).toEqual([]);
      }
    });
  });

  it("verified → candidate → 409; stale expectedChannel → 409", async () => {
    expect((await patch(S3, { expectedChannel: "candidate", channel: "verified", gateEvidenceRef: "g" })).status).toBe(200);
    await expectUnchanged(async () => {
      const back = await patch(S3, { expectedChannel: "verified", channel: "candidate" });
      expect(back.status).toBe(409);
      expect(back.body.allowedTransitions).toEqual(["deprecated"]);
      const stale = await patch(S3, { expectedChannel: "candidate", channel: "deprecated" });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe("WORK_SKILL_CHANNEL_TRANSITION_INVALID");
    });
  });

  it("successor pointing to itself, to a missing skill, or forming a cycle → 422 (E3)", async () => {
    expect((await patch(S4, { expectedChannel: "candidate", successorSkillId: S5 })).status).toBe(200);
    await expectUnchanged(async () => {
      for (const [skillId, successorSkillId] of [[S3, S3], [S3, "skill-missing"], [S5, S4]] as const) {
        const res = await patch(skillId, { expectedChannel: "candidate", channel: "deprecated", successorSkillId });
        expect(res.status).toBe(422);
        expect(res.body.code).toBe("WORK_SKILL_SUCCESSOR_INVALID");
      }
    });
  });

  it("a member (non-admin) gets 403 and cannot see channel controls (E9)", async () => {
    await expectUnchanged(async () => {
      const res = await patch(S3, { expectedChannel: "candidate", channel: "deprecated" }, MEMBER);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("WORK_SKILL_ADMIN_REQUIRED");
    });
  });

  it("an admin of another org gets 404; unauthenticated gets 401; invalid body 422", async () => {
    await expectUnchanged(async () => {
      const cross = await patch(S3, { expectedChannel: "candidate", channel: "deprecated" }, OUTSIDER, OTHER_ORG);
      expect(cross.status).toBe(404);
      expect(cross.body.code).toBe("WORK_SKILL_NOT_FOUND");
      const anon = await fetch(`${base}/admin/skills/catalog/${S3}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedChannel: "candidate", channel: "deprecated", idempotencyKey: randomUUID() }),
      });
      expect(anon.status).toBe(401);
      const empty = await patch(S3, { expectedChannel: "candidate" });
      expect(empty.status).toBe(422);
      expect(empty.body.code).toBe("VALIDATION_FAILED");
      expect((await patch("skill-missing", { expectedChannel: "candidate", channel: "deprecated" })).status).toBe(404);
    });
  });
});
