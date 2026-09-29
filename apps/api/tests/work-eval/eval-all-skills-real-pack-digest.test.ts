/**
 * EV05 回写 digest 口径（真实库、真实 starter-pack，不桩 digest）：
 * 导入仓内真实 `skills/starter-packs/work-research` → 用真实 fs 评测器（回环模型 + 门脚本）跑 S003 →
 * 以平台运营凭据走真实 HTTP 回写。门脚本产出的 `subjectVersionDigest` 必须等于导入落库的
 * `skill_versions.content_digest`，否则 EV04 回写一律 `WORK_EVAL_DIGEST_MISMATCH`（修复前本测试即红在这里）。
 */
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { WORK_GATE_OFFICIAL_ORG, type WorkGateOfficialOrg } from "../../src/application/work-eval/work-gate-status";
import type { OrgId } from "../../src/domain/org-id";
import { FsBatchEntityEvaluator, HttpBatchCatalog, runAllSkillsCommand } from "../../src/infrastructure/work-eval/all-skills-eval";
import { EXIT } from "../../src/infrastructure/work-eval/fs-eval-suite";
import { addCredential, addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { importWorkPack } from "../work-skill/support/catalog-fixture";
import { quiet } from "./gates-fixture";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const REPO = resolve(__dirname, "../../../..");
const ORG = "org-ev05-real-digest";
const OPS = "u-ev05-real-digest-ops";
const OPS_EMAIL = "ev05-real-digest-ops@example.test";
const ORIGINAL_WHITELIST = process.env.PLATFORM_SUPERUSER_EMAILS;
const ORIGINAL_PACK_ROOT = process.env.SKILL_STARTER_PACK_ROOT;

let app: NestExpressApplication;
let base = "";
let evalsRoot = "";

beforeAll(async () => {
  process.env.SKILL_STARTER_PACK_ROOT = join(REPO, "skills/starter-packs");
  evalsRoot = mkdtempSync(join(tmpdir(), "ev05-real-digest-evals-"));
  cpSync(join(REPO, "evals/work-stack/S003"), join(evalsRoot, "S003"), { recursive: true });
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  await addCredential(OPS, OPS_EMAIL, "EV05 Real Digest Ops");
  process.env.PLATFORM_SUPERUSER_EMAILS = OPS_EMAIL;
  vi.spyOn(app.get<WorkGateOfficialOrg>(WORK_GATE_OFFICIAL_ORG), "orgId").mockReturnValue(ORG as OrgId);
  await resetOrgs(ORG);
  const fixture = await seedOrg({ orgId: ORG, projectId: `${ORG}-project` });
  await addOrgMember(ORG, OPS, "admin", fixture.teams.energy!);
  await importWorkPack(base, `${OPS}:${ORG}`, "work-research", "1.0.0");
}, 180_000);

afterAll(async () => {
  if (ORIGINAL_WHITELIST === undefined) delete process.env.PLATFORM_SUPERUSER_EMAILS;
  else process.env.PLATFORM_SUPERUSER_EMAILS = ORIGINAL_WHITELIST;
  if (ORIGINAL_PACK_ROOT === undefined) delete process.env.SKILL_STARTER_PACK_ROOT;
  else process.env.SKILL_STARTER_PACK_ROOT = ORIGINAL_PACK_ROOT;
  await app?.close();
  await resetOrgs(ORG);
  if (evalsRoot) rmSync(evalsRoot, { recursive: true, force: true });
});

describe("EV05 write-back digest = imported content_digest (real pack, no digest stub)", () => {
  it("the gate-script digest of a real starter-pack skill is accepted by the EV04 write-back", async () => {
    // 导入本身会为每个带门判定的技能写一条 system:starter-pack-import 记录（#4677）；
    // 回写按 (org_id, skill_version_id) upsert，应覆盖 S003 那条而不是新增行。
    const countRecords = async () => asApp(ORG, async (c) =>
      Number((await c.query<{ n: string }>("SELECT count(*) AS n FROM skill_gate_records WHERE org_id = $1", [ORG])).rows[0]!.n));
    const before = await countRecords();
    const fs = new FsBatchEntityEvaluator({ repoRoot: REPO, evalsRoot });
    const r = await runAllSkillsCommand({
      repoRoot: REPO, evalsRoot, baseline: true, writeBack: true, runId: "real-digest", ...quiet,
      // 只跑有套件的 S003；evaluate 是真实回环评测 + 门脚本，不桩 digest。
      evaluator: { listSkillStableIds: () => ["S003"], evaluate: (id, o) => fs.evaluate(id, o) },
      catalog: new HttpBatchCatalog({ baseUrl: base, headers: { "x-kernel-test-principal": `${OPS}:${ORG}` } }),
    });
    const row = r.summary!.rows[0]!;
    expect(row.error).toBeNull();
    expect(row.writtenBack).toBe(true);
    expect(r.exitCode).toBe(EXIT.OK);

    const stored = await asApp(ORG, async (c) => (await c.query<{ digest: string; recorded: string; written_by: string }>(
      `SELECT 'sha256:' || v.content_digest AS digest, g.subject_version_digest AS recorded, g.written_by
         FROM skill_gate_records g
         JOIN skill_versions v ON v.id = g.skill_version_id
         JOIN skill_catalog_entries e ON e.org_id = g.org_id AND e.skill_id = g.skill_id
        WHERE g.org_id = $1 AND e.stable_id = 'S003'`, [ORG])).rows);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.written_by).toBe(OPS);
    expect(stored[0]!.recorded).toBe(stored[0]!.digest);
    // upsert 覆盖导入时的记录，不新增行；其余记录仍是导入写的。
    expect(await countRecords()).toBe(before);
    const operatorWritten = await asApp(ORG, async (c) => Number((await c.query<{ n: string }>(
      "SELECT count(*) AS n FROM skill_gate_records WHERE org_id = $1 AND written_by <> 'system:starter-pack-import'", [ORG])).rows[0]!.n));
    expect(operatorWritten).toBe(1);
  }, 180_000);
});
