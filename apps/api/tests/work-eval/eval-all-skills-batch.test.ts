/**
 * EV05（Phase 20，04-eval-gates R3.9；契约束 work-eval UC-7 / V14）：
 * `pnpm harness eval --all-skills --baseline --write-back` 批量评测 → 门状态回写 → G5 pass 的 Skill 转 verified。
 *
 * - 批处理对每个 Skill 出一行汇总（subject/baseline 通过数、G5 结论），写 `_batch/<runId>.json`；
 * - 回写走真实 HTTP（平台运营凭据）：每个 Skill 当前版本得到门状态记录；
 * - 不变式：批后目录 verified 数 = 汇总中 G5 pass 数（持平/无基线/必过失败的不转 verified）；
 * - 目录里找不到的 Skill 记 error、不中断；--write-back 缺凭据 → WRITE_BACK_FAILED(4)；重跑幂等。
 * - 评测器（fs 侧）在临时仓上发现 Skill、跑回环评测（含 baseline）并由门脚本产出 WorkGateStatus。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BatchEntityEvaluator } from "../../src/application/work-eval/eval-all-skills";
import { WORK_GATE_OFFICIAL_ORG, type WorkGateOfficialOrg } from "../../src/application/work-eval/work-gate-status";
import type { OrgId } from "../../src/domain/org-id";
import { FsBatchEntityEvaluator, HttpBatchCatalog, runAllSkillsCommand } from "../../src/infrastructure/work-eval/all-skills-eval";
import { EXIT, parseEvalArgs } from "../../src/infrastructure/work-eval/fs-eval-suite";
import { addCredential, addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { CONTRACT, importWorkPack, MEETING, RESEARCH, writeWorkPack } from "../work-skill/support/catalog-fixture";
import { cleanupFixtures, goodRepo, quiet } from "./gates-fixture";
import { currentVersion, gateStatus, type G5Outcome } from "./support/gate-record";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-ev05-batch";
const OPS = "u-ev05-batch-ops";
const OPS_EMAIL = "ev05-batch-ops@example.test";
const MEMBER = "u-ev05-batch-member";
const PACK = "ev05-batch-pack";
const ORIGINAL_WHITELIST = process.env.PLATFORM_SUPERUSER_EMAILS;

let app: NestExpressApplication;
let base = "";
let packRoot = "";
let evalsRoot = "";
let skillIds: Record<string, string> = {};

const catalog = () => new HttpBatchCatalog({ baseUrl: base, headers: { "x-kernel-test-principal": `${OPS}:${ORG}` } });

/** 按 stableId 给定 G5 结论的评测器桩（WorkGateStatus 的 digest 取目录当前版本，和门脚本产出同形）。 */
function stubEvaluator(plan: Record<string, G5Outcome | "unknown-to-catalog">): BatchEntityEvaluator {
  return {
    listSkillStableIds: () => Object.keys(plan),
    async evaluate(stableId, opts) {
      expect(opts.baseline).toBe(true);
      const outcome = plan[stableId]!;
      if (outcome === "unknown-to-catalog") {
        return { status: gateStatus(stableId, `sha256:${"0".repeat(64)}`, "pass") as never, reportPath: null, error: null };
      }
      const v = await currentVersion(ORG, skillIds[stableId]!);
      return { status: gateStatus(stableId, v.digest, outcome) as never, reportPath: `evals/work-stack/${stableId}/reports/r.json`, error: null };
    },
  };
}

async function listed(channel: string) {
  const res = await fetch(`${base}/skills/catalog?channel=${channel}&limit=100`, { headers: { "x-kernel-test-principal": `${MEMBER}:${ORG}` } });
  return ((await res.json()) as { items: Array<{ stableId: string }> }).items.map((i) => i.stableId).sort();
}

async function gateRecords() {
  return asApp(ORG, async (c) => (await c.query<{ skill_id: string }>(
    "SELECT skill_id FROM skill_gate_records WHERE org_id=$1", [ORG])).rows.length);
}

beforeAll(async () => {
  packRoot = mkdtempSync(join(tmpdir(), "ev05-batch-packs-"));
  process.env.SKILL_STARTER_PACK_ROOT = packRoot;
  writeWorkPack(packRoot, PACK, "1.0.0", [RESEARCH, MEETING, CONTRACT]);
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  await addCredential(OPS, OPS_EMAIL, "EV05 Ops");
  process.env.PLATFORM_SUPERUSER_EMAILS = OPS_EMAIL;
  vi.spyOn(app.get<WorkGateOfficialOrg>(WORK_GATE_OFFICIAL_ORG), "orgId").mockReturnValue(ORG as OrgId);
}, 180_000);

afterAll(async () => {
  if (ORIGINAL_WHITELIST === undefined) delete process.env.PLATFORM_SUPERUSER_EMAILS;
  else process.env.PLATFORM_SUPERUSER_EMAILS = ORIGINAL_WHITELIST;
  await app?.close();
  await resetOrgs(ORG);
  rmSync(packRoot, { recursive: true, force: true });
  cleanupFixtures();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  const fixture = await seedOrg({ orgId: ORG, projectId: `${ORG}-project` });
  await addOrgMember(ORG, OPS, "admin", fixture.teams.energy!);
  await addOrgMember(ORG, MEMBER, "consultant", fixture.teams.energy!);
  const imported = await importWorkPack(base, `${OPS}:${ORG}`, PACK, "1.0.0");
  skillIds = { S003: imported.skillIds[0]!, S004: imported.skillIds[1]!, S005: imported.skillIds[2]! };
  if (evalsRoot) rmSync(evalsRoot, { recursive: true, force: true });
  evalsRoot = mkdtempSync(join(tmpdir(), "ev05-batch-evals-"));
});

describe("EV05 --all-skills --baseline --write-back", () => {
  it("writes back every skill, verifies exactly the G5-pass ones, and verified count = G5 pass count", async () => {
    const r = await runAllSkillsCommand({
      repoRoot: evalsRoot, evalsRoot, baseline: true, writeBack: true, runId: "batch-1", ...quiet,
      evaluator: stubEvaluator({ S003: "pass", S004: "tie", S005: "no-baseline" }),
      catalog: catalog(),
    });
    const s = r.summary!;
    expect(s.rows.map((x) => x.error)).toEqual([null, null, null]);
    expect(r.exitCode).toBe(EXIT.OK);
    expect(s.rows.map((x) => [x.stableId, x.g5, x.subjectPassed, x.baselinePassed, x.channel, x.writtenBack])).toEqual([
      ["S003", "pass", 7, 5, "verified", true],
      ["S004", "fail", 6, 6, "candidate", true],
      ["S005", "fail", 7, null, "candidate", true],
    ]);
    expect(s.rows.find((x) => x.stableId === "S004")!.g5ReasonCode).toBe("NOT_BETTER_THAN_BASELINE");
    expect(s.totals).toEqual({ skills: 3, g5Pass: 1, verified: 1, errors: 0 });

    // 目录（成员视角）与汇总一致：verified 数 = G5 pass 数。
    expect(await listed("verified")).toEqual(["S003"]);
    expect((await listed("verified")).length).toBe(s.totals.g5Pass);
    expect(await listed("candidate")).toEqual(["S004", "S005"]);
    expect(await gateRecords()).toBe(3);

    // 汇总落盘，可被 CI/人读取。
    const saved = JSON.parse(readFileSync(r.summaryPath!, "utf8"));
    expect(saved.totals).toEqual(s.totals);
    expect(r.summaryPath).toBe(join(evalsRoot, "_batch", "batch-1.json"));
  });

  it("re-running is idempotent: already-verified skills are not re-patched, counts hold", async () => {
    const run = (runId: string) => runAllSkillsCommand({
      repoRoot: evalsRoot, evalsRoot, baseline: true, writeBack: true, runId, ...quiet,
      evaluator: stubEvaluator({ S003: "pass", S004: "must-pass-failed", S005: "pass" }), catalog: catalog(),
    });
    expect((await run("batch-a")).exitCode).toBe(EXIT.OK);
    const second = await run("batch-b");
    expect(second.exitCode).toBe(EXIT.OK);
    expect(second.summary!.totals).toMatchObject({ g5Pass: 2, verified: 2, errors: 0 });
    expect(await listed("verified")).toEqual(["S003", "S005"]);
  });

  it("a skill missing from the catalog is reported as an error without stopping the batch (exit 1)", async () => {
    const r = await runAllSkillsCommand({
      repoRoot: evalsRoot, evalsRoot, baseline: true, writeBack: true, runId: "batch-missing", ...quiet,
      evaluator: stubEvaluator({ S003: "pass", S099: "unknown-to-catalog" }), catalog: catalog(),
    });
    expect(r.exitCode).toBe(EXIT.CASE_FAILED_OR_ERROR);
    expect(r.summary!.rows.find((x) => x.stableId === "S099")).toMatchObject({ writtenBack: false, channel: null, error: expect.stringContaining("not in the official skill catalog") });
    expect(await listed("verified")).toEqual(["S003"]);
  });

  it("server-side rejection of the write-back (non platform operator) → WRITE_BACK_FAILED and nothing verified", async () => {
    const r = await runAllSkillsCommand({
      repoRoot: evalsRoot, evalsRoot, baseline: true, writeBack: true, runId: "batch-denied", ...quiet,
      evaluator: stubEvaluator({ S003: "pass" }),
      catalog: new HttpBatchCatalog({ baseUrl: base, headers: { "x-kernel-test-principal": `${MEMBER}:${ORG}` } }),
    });
    expect(r.exitCode).toBe(EXIT.WRITE_BACK_FAILED);
    expect(r.summary!.rows[0]!.error).toMatch(/^write-back failed/);
    expect(await listed("verified")).toEqual([]);
    expect(await gateRecords()).toBe(0);
  });

  it("--write-back without catalog credentials → WRITE_BACK_FAILED before evaluating anything", async () => {
    const evaluate = vi.fn();
    const r = await runAllSkillsCommand({
      repoRoot: evalsRoot, evalsRoot, baseline: true, writeBack: true, ...quiet,
      evaluator: { listSkillStableIds: () => ["S003"], evaluate },
    });
    expect(r.exitCode).toBe(EXIT.WRITE_BACK_FAILED);
    expect(evaluate).not.toHaveBeenCalled();
    expect(await gateRecords()).toBe(0);
  });
});

describe("EV05 fs evaluator + CLI arguments", () => {
  it("discovers skills and produces a G5 WorkGateStatus from a real loopback run with baseline", async () => {
    const root = goodRepo();
    const ev = new FsBatchEntityEvaluator({ repoRoot: root });
    expect(ev.listSkillStableIds()).toEqual(["S003"]);
    const res = await ev.evaluate("S003", { baseline: true });
    expect(res.error).toBeNull();
    expect(res.reportPath).toMatch(/^evals\/work-stack\/S003\/reports\/.+\.json$/);
    expect(existsSync(join(root, res.reportPath!))).toBe(true);
    const g5 = res.status!.gates.find((g) => g.gate === "G5")!;
    expect(res.status!.baselinePassed).not.toBeNull();
    expect(g5.outcome).toBe(res.status!.subjectPassed! > res.status!.baselinePassed! ? "pass" : "fail");
    expect(g5.outcome).toBe("pass");

    // 无回写的批处理（本地）：汇总同一结论，退出 0。
    const r = await runAllSkillsCommand({ repoRoot: root, baseline: true, writeBack: false, runId: "local", ...quiet });
    expect(r.exitCode).toBe(EXIT.OK);
    expect(r.summary!.totals).toMatchObject({ skills: 1, g5Pass: 1, verified: 0 });
  });

  it("without --baseline G5 fails NO_BASELINE (E5)", async () => {
    const root = goodRepo();
    const res = await new FsBatchEntityEvaluator({ repoRoot: root }).evaluate("S003", { baseline: false });
    expect(res.status!.gates.find((g) => g.gate === "G5")).toMatchObject({ outcome: "fail", reasonCode: "NO_BASELINE" });
  });

  it("parses --all-skills / --baseline / --write-back", () => {
    expect(parseEvalArgs(["--all-skills", "--baseline", "--write-back"])).toMatchObject({ allSkills: true, baseline: true, writeBack: true, unknown: [] });
    expect(parseEvalArgs(["--entity", "S003"])).toMatchObject({ allSkills: false, writeBack: false });
  });
});
