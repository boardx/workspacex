/**
 * 客户成功线 Work Skill 包（S187–S194）——构建 + 套件形状 + 门 G0–G2 + grader 自洽。
 *
 * 不连接数据库（纯文件系统 / 纯函数）。验证的是：
 *  · `skills/work-customer-success/` 按 SKILL.md + references/ 产出 starter-pack，digest 可重复、已提交产物与源一致；
 *  · 每个实体的 `metadata.work` 过 WorkSkillManifest，依赖全部在 ADR-120 登记表里（声明但未接线）；
 *  · 评测套件过 `validateWorkEvalSuiteBundle`，含实体文档 §12 的全部 E* case，另含权限拒绝 + 注入 case；
 *  · 门脚本判定 G0/G1/G2 pass（与 `pnpm run lint:work-stack-gates` 同一纯函数）；
 *  · 每个 case 的 `outputSample` 被自带 grader 判 pass，且空输出/写工具调用被判 fail（grader 不是空转）。
 *
 * 不验证的：G3–G5 需要针对当前版本 digest 的回环评测报告；本线没有回环 Agent 实现（S003 之外都没有），所以不在此判。
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { suiteCoverageGaps } from "@repo/contracts/work-eval";
import {
  buildWorkCustomerSuccessPack,
  checkCommittedPack,
  DEFAULT_ROOT,
  EXPECTED_STABLE_IDS,
  PACK_ID,
  PACK_VERSION,
  PENDING_REVIEW_IDS,
  specFor,
  WorkContentPackBuildError,
} from "../../scripts/build-work-customer-success-skill-pack";
import { buildWorkContentPack, serializePack } from "../../scripts/work-content-pack";
import { isRegisteredCapabilityCategory } from "../../src/domain/skill/capability-category-registry";
import { judgeWorkStackGates } from "../../src/application/work-eval/work-stack-gates";
import { scanFixtureForPersonalData } from "../../src/application/work-eval/fixture-privacy";
import { collectGateSubjects } from "../../src/infrastructure/work-eval/fs-work-stack-gates";

const REPO = resolve(__dirname, "../../../..");
const IDS = [...EXPECTED_STABLE_IDS];
const SLUGS: Record<string, string> = {
  S187: "support-triage", S188: "draft-support-response", S189: "customer-escalation", S190: "kb-article",
  S191: "qbr-preparation", S192: "renewal-risk", S193: "voice-of-customer", S194: "support-operations",
};
const SPEC_FILES = readdirSync(join(REPO, "requirements/work-stack-v2/skills"));

type Case = { id: string; tags: string[]; fixtureRefs: string[]; input: unknown; expect: { assertions: { kind: string; spec: unknown }[]; outputSample?: Record<string, unknown> } };
const suiteDir = (id: string) => join(REPO, "evals/work-stack", id);
const casesOf = (id: string): Case[] => readFileSync(join(suiteDir(id), "cases.jsonl"), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l) as Case);
type Grader = { grade: (a: unknown[], o: Record<string, unknown>, t: { toolCalls: { name: string; kind: "read" | "write" }[] }) => { outcome: string; reason: string | null }; GRADER_VERSION: string; ASSERTION_KINDS: string[] };
const graderOf = async (id: string) => (await import(pathToFileURL(join(suiteDir(id), "grader.ts")).href)) as Grader;
const noTrace = { toolCalls: [] as { name: string; kind: "read" | "write" }[] };

describe("客户成功线 · starter-pack 构建（work-customer-success）", () => {
  it("恰好覆盖 S187–S194，每个一份 SKILL.md，目录名 = stableName", () => {
    const pack = buildWorkCustomerSuccessPack();
    expect(pack.packId).toBe(PACK_ID);
    expect(pack.packVersion).toBe(PACK_VERSION);
    expect(pack.skills.map(s => s.name).sort()).toEqual(IDS);
    for (const s of pack.skills) {
      expect(s.stableName).toBe(SLUGS[s.name]);
      expect(s.files.filter(f => f.path === "SKILL.md")).toHaveLength(1);
      expect(s.semanticVersion).toBe("1.0.0");
    }
  });

  it("待评审实体只能经显式 pendingReviewIds 入包：不带登记时整包按「未 PASS」拒绝（E1 不被悄悄绕过）", () => {
    expect([...PENDING_REVIEW_IDS]).toEqual(IDS);
    let caught: unknown;
    try { buildWorkContentPack({ ...specFor(), pendingReviewIds: [] }); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(WorkContentPackBuildError);
    const flagged = new Set((caught as WorkContentPackBuildError).issues.map(i => /S\d{3}/.exec(i.message)?.[0]));
    for (const id of IDS) expect(flagged.has(id), id).toBe(true);
  });

  it("重复构建 packDigest 不变；已提交的 1.0.0.json 与源重建字节一致", () => {
    expect(buildWorkCustomerSuccessPack().packDigest).toBe(buildWorkCustomerSuccessPack().packDigest);
    expect(checkCommittedPack(specFor())).toEqual([]);
  });

  it("源被改而 JSON 未重建 ⇒ digest 不符", () => {
    const temp = mkdtempSync(join(tmpdir(), "work-cs-pack-"));
    const out = join(mkdtempSync(join(tmpdir(), "work-cs-committed-")), "1.0.0.json");
    try {
      cpSync(DEFAULT_ROOT, temp, { recursive: true });
      writeFileSync(out, serializePack(buildWorkCustomerSuccessPack(temp)));
      expect(checkCommittedPack(specFor(temp), out)).toEqual([]);
      const target = join(temp, "support-triage", "SKILL.md");
      writeFileSync(target, `${readFileSync(target, "utf8")}\n<!-- drift -->\n`);
      const issues = checkCommittedPack(specFor(temp), out);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.message).toContain("digest 不符");
    } finally {
      rmSync(temp, { recursive: true, force: true });
      rmSync(resolve(out, ".."), { recursive: true, force: true });
    }
  });

  it("篡改 metadata.work.stableId / 删掉一个 Skill ⇒ 拒绝整包并指名文件或缺失 ID", () => {
    const temp = mkdtempSync(join(tmpdir(), "work-cs-tamper-"));
    try {
      cpSync(DEFAULT_ROOT, temp, { recursive: true });
      const target = join(temp, "kb-article", "SKILL.md");
      writeFileSync(target, readFileSync(target, "utf8").replace("stableId: S190", "stableId: NOT-A-VALID-ID"));
      let caught: unknown;
      try { buildWorkCustomerSuccessPack(temp); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(WorkContentPackBuildError);
      expect((caught as WorkContentPackBuildError).issues.some(i => i.file === "kb-article/SKILL.md")).toBe(true);

      cpSync(DEFAULT_ROOT, temp, { recursive: true, force: true });
      rmSync(join(temp, "renewal-risk"), { recursive: true, force: true });
      caught = undefined;
      try { buildWorkCustomerSuccessPack(temp); } catch (e) { caught = e; }
      expect((caught as WorkContentPackBuildError).issues.some(i => i.fieldPath === "coverage" && i.message.includes("S192"))).toBe(true);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it("stableName 与其他内容线的 pack 不冲突（同名必须逐字节相同，否则导入会 409）", () => {
    const root = join(REPO, "skills/starter-packs");
    const mine = new Set(buildWorkCustomerSuccessPack().skills.map(s => s.stableName));
    for (const packId of readdirSync(root).filter(p => p !== PACK_ID)) {
      const latest = readdirSync(join(root, packId)).filter(f => f.endsWith(".json")).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();
      if (!latest) continue;
      const other = (JSON.parse(readFileSync(join(root, packId, latest), "utf8")) as { skills: { stableName: string }[] }).skills.map(s => s.stableName);
      expect(other.filter(n => mine.has(n)), `${packId} 与 ${PACK_ID} 同名`).toEqual([]);
    }
  });
});

describe("客户成功线 · manifest 与门 G0–G2", () => {
  const subjects = collectGateSubjects(REPO, join(REPO, "evals/work-stack"));
  const now = new Date("2026-09-30T00:00:00Z");

  for (const id of IDS) {
    it(`${id}：G0/G1/G2 pass；依赖全部已登记；G3 只缺回环报告（不是缺套件/缺分类）`, () => {
      const subject = subjects.find(s => s.stableId === id);
      expect(subject, `${id} 包未被门脚本发现`).toBeDefined();
      expect(subject!.sourcePath).toBe(`skills/work-customer-success/${SLUGS[id]}/SKILL.md`);
      const j = judgeWorkStackGates(subject!, now);
      const byGate = Object.fromEntries(j.gates.map(g => [g.gate, g]));
      for (const g of ["G0", "G1", "G2"] as const) expect(byGate[g]!.outcome, `${id} ${g}: ${byGate[g]!.reason}`).toBe("pass");
      expect(byGate.G3!.reasonCode).toBe("INJECTION_OR_DENIAL_CASE_FAILED");
      expect(byGate.G4!.reasonCode).toBe("REPORT_STALE");
      const work = subject!.manifest as { dependencies: { required: string[]; optional: string[] }; provenance: { copied: boolean }[] };
      for (const dep of [...work.dependencies.required, ...work.dependencies.optional]) expect(isRegisteredCapabilityCategory(dep), `${id} 依赖 ${dep} 未登记`).toBe(true);
      expect(work.provenance.every(p => p.copied === false)).toBe(true);
    });
  }

  it("ticket.read 等外部系统能力只声明、不接线：没有任何 S187–S194 的 SKILL.md 声明写能力", () => {
    for (const id of IDS) {
      const work = subjects.find(s => s.stableId === id)!.manifest as { dependencies: { required: string[]; optional: string[] } };
      const all = [...work.dependencies.required, ...work.dependencies.optional];
      expect(all.filter(d => /\.(write|send|publish)$/.test(d)), `${id} 不应声明写能力`).toEqual([]);
    }
  });
});

describe("客户成功线 · 评测套件", () => {
  for (const id of IDS) {
    it(`${id}：覆盖实体文档 §12 的全部 E* case，含权限拒绝与注入 case；夹具合成无真实个人数据`, () => {
      const cases = casesOf(id);
      const spec = readFileSync(join(REPO, "requirements/work-stack-v2/skills", SPEC_FILES.find(f => f.startsWith(`${id}-`))!), "utf8");
      const specCaseIds = [...spec.matchAll(/^\| (E\d+) \|/gm)].map(m => m[1]!);
      expect(specCaseIds.length).toBeGreaterThanOrEqual(8);
      for (const c of specCaseIds) expect(cases.map(x => x.id), `${id} 缺少实体文档的 ${c}`).toContain(c);
      expect(suiteCoverageGaps(cases as never)).toEqual([]);
      const suite = JSON.parse(readFileSync(join(suiteDir(id), "suite.json"), "utf8")) as { mustPassCaseIds: string[]; baseline: { tools: string[] } | null; llmJudge: unknown };
      expect(suite.baseline).not.toBeNull();
      expect(suite.llmJudge).toBeNull();
      for (const m of suite.mustPassCaseIds) expect(cases.map(c => c.id)).toContain(m);
      const fixtureDir = join(suiteDir(id), "fixtures");
      const files = existsSync(fixtureDir) ? readdirSync(fixtureDir) : [];
      for (const c of cases) for (const ref of c.fixtureRefs) expect(files, `${id}/${c.id} 夹具 ${ref}`).toContain(ref);
      const texts = [...files.map(f => [f, readFileSync(join(fixtureDir, f), "utf8")] as const), ["cases.jsonl", readFileSync(join(suiteDir(id), "cases.jsonl"), "utf8")] as const];
      expect(texts.flatMap(([f, t]) => scanFixtureForPersonalData(f, t))).toEqual([]);
    });

    it(`${id}：每个 case 的 outputSample 被自带 grader 判 pass；空输出、写工具调用被判 fail`, async () => {
      const g = await graderOf(id);
      expect(g.GRADER_VERSION).toBe(JSON.parse(readFileSync(join(suiteDir(id), "suite.json"), "utf8")).graderVersion);
      for (const c of casesOf(id)) {
        expect(c.expect.outputSample, `${id}/${c.id} 缺 outputSample`).toBeDefined();
        const ok = g.grade(c.expect.assertions, c.expect.outputSample!, noTrace);
        expect(ok, `${id}/${c.id}: ${ok.reason}`).toEqual({ outcome: "pass", reason: null });
        expect(g.grade(c.expect.assertions, {}, noTrace).outcome, `${id}/${c.id} 空输出不应通过`).toBe("fail");
        if (c.expect.assertions.some(a => a.kind === "noWriteToolCalls")) {
          expect(g.grade(c.expect.assertions, c.expect.outputSample!, { toolCalls: [{ name: "wx_ticket_write", kind: "write" }] }).outcome, `${id}/${c.id} 写工具调用应判 fail`).toBe("fail");
        }
        for (const a of c.expect.assertions) expect(g.ASSERTION_KINDS).toContain(a.kind);
      }
    });
  }

  it("未知断言种类抛异常（由运行器记为 error，永不计作 pass）", async () => {
    const g = await graderOf("S187");
    expect(() => g.grade([{ kind: "nope", spec: null }], {}, noTrace)).toThrow(/unknown assertion kind/);
  });
});
