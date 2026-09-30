/**
 * operations-skill-pack-build.test.ts —— Work Stack v2 第二阶段运营/工程线 Skill 包
 * （S141/S143/S144/S145/S148/S153/S154/S156/S177 → `work-operations`；S179 → `work-engineering`）。
 *
 * 断言：每个实体按 SKILL.md + references/ 产出；构建脚本产出可重复 digest 的 starter-pack；
 * 篡改 / 缺失 / 多出 ⇒ 构建退出非 0 并指名文件；待评审实体只能经显式 `pendingReviewIds` 入包；
 * 导入端的 metadata.work / 能力分类校验通过；EV03 门 G0–G2 对这 10 个实体全部通过；
 * 每个评测套件覆盖实体文档 §12 的全部 case id、含权限拒绝与注入 case，且 grader 对各 case 的
 * outputSample 判 pass、对空输出不空转。
 *
 * 不连接数据库——纯文件系统 / 纯函数验证（同 CT01/CT04/CT07）。G3/G4 需要回环评测报告
 * （loopback subject 尚未为这些实体实现），这里只断言它们不因「能力分类未登记 / 套件缺注入或拒绝用例」而红。
 */
import { describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  buildWorkOperationsPack,
  DEFAULT_ROOT as OPS_ROOT,
  EXPECTED_STABLE_IDS as OPS_IDS,
  PACK_ID as OPS_PACK,
  PENDING_REVIEW_IDS as OPS_PENDING,
  specFor as opsSpec,
} from "../../scripts/build-work-operations-skill-pack";
import {
  buildWorkEngineeringPack,
  DEFAULT_ROOT as ENG_ROOT,
  EXPECTED_STABLE_IDS as ENG_IDS,
  PACK_ID as ENG_PACK,
  specFor as engSpec,
} from "../../scripts/build-work-engineering-skill-pack";
import { buildWorkContentPack, checkCommittedPack, serializePack, WorkContentPackBuildError } from "../../scripts/work-content-pack";
import { checkWorkSkillManifests } from "../../src/domain/skill/work-skill-import-check";
import { REGISTERED_CAPABILITY_CATEGORY_SET } from "../../src/domain/skill/capability-category-registry";
import { collectGateSubjects } from "../../src/infrastructure/work-eval/fs-work-stack-gates";
import { judgeWorkStackGates } from "../../src/application/work-eval/work-stack-gates";

const REPO = resolve(__dirname, "../../../..");
const ALL_IDS = [...OPS_IDS, ...ENG_IDS].sort();

function copy(root: string, label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `${label}-`));
  cpSync(root, dir, { recursive: true });
  return dir;
}

function rejected(fn: () => unknown): WorkContentPackBuildError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(WorkContentPackBuildError);
    return error as WorkContentPackBuildError;
  }
  throw new Error("expected the build to be rejected");
}

describe("运营/工程线 Skill 包构建（work-operations / work-engineering starter-pack）", () => {
  it("work-operations 恰好覆盖 9 个实体，work-engineering 恰好覆盖 S179；v2 ID 齐全且不重复", () => {
    const ops = buildWorkOperationsPack();
    const eng = buildWorkEngineeringPack();
    expect(ops.packId).toBe(OPS_PACK);
    expect(eng.packId).toBe(ENG_PACK);
    expect(ops.skills.map((s) => s.name).sort()).toEqual([...OPS_IDS].sort());
    expect(eng.skills.map((s) => s.name)).toEqual(["S179"]);
    expect(ALL_IDS).toEqual(["S141", "S143", "S144", "S145", "S148", "S153", "S154", "S156", "S177", "S179"]);
  });

  it("每个 Skill 恰一个根 SKILL.md，文件 digest 为字节 sha256；同源两次构建 packDigest 不变", async () => {
    const { createHash } = await import("node:crypto");
    for (const build of [buildWorkOperationsPack, buildWorkEngineeringPack]) {
      const first = build();
      for (const skill of first.skills) {
        expect(skill.files.filter((f) => f.path === "SKILL.md")).toHaveLength(1);
        for (const file of skill.files) {
          expect(file.digest).toBe(createHash("sha256").update(Buffer.from(file.contentBase64, "base64")).digest("hex"));
        }
      }
      expect(build().packDigest).toBe(first.packDigest);
    }
  });

  it("已提交的 starter-pack JSON 与源重建一致；源被改而 JSON 未重建 ⇒ digest 不符", () => {
    expect(checkCommittedPack(opsSpec())).toEqual([]);
    expect(checkCommittedPack(engSpec())).toEqual([]);

    const tempRoot = copy(OPS_ROOT, "ops-pack");
    const committedDir = mkdtempSync(join(tmpdir(), "ops-committed-"));
    const committed = join(committedDir, "1.0.0.json");
    try {
      writeFileSync(committed, serializePack(buildWorkContentPack(opsSpec(tempRoot))));
      expect(checkCommittedPack(opsSpec(tempRoot), committed)).toEqual([]);
      const target = resolve(tempRoot, "execution-plan", "SKILL.md");
      writeFileSync(target, `${readFileSync(target, "utf8")}\n<!-- drift -->\n`);
      const issues = checkCommittedPack(opsSpec(tempRoot), committed);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.message).toContain("digest 不符");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
      rmSync(committedDir, { recursive: true, force: true });
    }
  });

  it("篡改 metadata.work.stableId 格式 / 破坏 YAML ⇒ 整包拒绝并指名该文件", () => {
    const tempRoot = copy(OPS_ROOT, "ops-tamper");
    try {
      const target = resolve(tempRoot, "change-request", "SKILL.md");
      const original = readFileSync(target, "utf8");
      writeFileSync(target, original.replace("stableId: S145", "stableId: NOT-A-VALID-ID"));
      const error = rejected(() => buildWorkOperationsPack(tempRoot));
      expect(error.issues.some((i) => i.file === "change-request/SKILL.md" && i.fieldPath.includes("stableId"))).toBe(true);

      writeFileSync(target, original.replace("required:", "required: [broken"));
      expect(rejected(() => buildWorkOperationsPack(tempRoot)).issues.some((i) => i.file === "change-request/SKILL.md")).toBe(true);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("删掉一个实体目录 ⇒ 拒绝并指名缺失 ID；多出不在覆盖集合的实体（借用 S011）⇒ 拒绝", () => {
    const tempRoot = copy(OPS_ROOT, "ops-coverage");
    try {
      rmSync(resolve(tempRoot, "capacity-planning"), { recursive: true, force: true });
      expect(rejected(() => buildWorkOperationsPack(tempRoot)).issues.some((i) => i.fieldPath === "coverage" && i.message.includes("S144"))).toBe(true);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
    const tempRoot2 = copy(OPS_ROOT, "ops-extra");
    try {
      const target = resolve(tempRoot2, "project-planning", "SKILL.md");
      writeFileSync(target, readFileSync(target, "utf8").replace("stableId: S141", "stableId: S011"));
      const error = rejected(() => buildWorkOperationsPack(tempRoot2));
      expect(error.issues.some((i) => i.file === "project-planning/SKILL.md" && i.message.includes("S011"))).toBe(true);
    } finally {
      rmSync(tempRoot2, { recursive: true, force: true });
    }
  });

  it("待评审实体只能经显式 pendingReviewIds 入包：不带登记时整包按「未 PASS」拒绝（E1 不被悄悄绕过）", () => {
    expect(OPS_PENDING).toEqual([...OPS_IDS]);
    const error = rejected(() => buildWorkContentPack({ ...opsSpec(), pendingReviewIds: [] }));
    const flagged = new Set(error.issues.map((i) => /S\d{3}/.exec(i.message)?.[0]));
    for (const id of OPS_IDS) expect(flagged.has(id), id).toBe(true);
    // 登记了一个不在 320 清单里的 ID 也被拒绝。
    const bogus = rejected(() => buildWorkContentPack({ ...opsSpec(), pendingReviewIds: [...OPS_IDS, "S999"] }));
    expect(bogus.issues.some((i) => i.fieldPath === "pendingReviewIds" && i.message.includes("S999"))).toBe(true);
  });

  it("导入端同一份 metadata.work 校验通过（能力分类全部已登记，不会 WORK_SKILL_CAPABILITY_UNREGISTERED）", () => {
    for (const pack of [buildWorkOperationsPack(), buildWorkEngineeringPack()]) {
      expect(checkWorkSkillManifests(pack).kind).toBe("ok");
      for (const skill of pack.skills) {
        const work = (skill.manifest as { work: { dependencies: { required: string[]; optional: string[] } } }).work;
        for (const dep of [...work.dependencies.required, ...work.dependencies.optional]) {
          expect(REGISTERED_CAPABILITY_CATEGORY_SET.has(dep), `${skill.name} 依赖 ${dep}`).toBe(true);
        }
      }
    }
  });
});

describe("EV03 门：G0–G2 对 10 个实体全部通过（G3/G4 需回环报告，不在此断言通过）", () => {
  const subjects = collectGateSubjects(REPO).filter((s) => ALL_IDS.includes(s.stableId));

  it("10 个实体各被发现一次", () => {
    expect(subjects.map((s) => s.stableId).sort()).toEqual(ALL_IDS);
  });

  for (const id of ALL_IDS) {
    it(`${id}: G0/G1/G2 pass；G3 不因分类未登记或缺注入/拒绝用例而红`, () => {
      const subject = subjects.find((s) => s.stableId === id)!;
      const j = judgeWorkStackGates(subject);
      const byGate = Object.fromEntries(j.gates.map((g) => [g.gate, g]));
      expect(byGate.G0!.outcome, byGate.G0!.reason).toBe("pass");
      expect(byGate.G1!.outcome, byGate.G1!.reason).toBe("pass");
      expect(byGate.G2!.outcome, byGate.G2!.reason).toBe("pass");
      expect(byGate.G3!.reasonCode).not.toBe("CAPABILITY_UNREGISTERED");
      expect(byGate.G3!.reasonCode).not.toBe("INJECTION_OR_DENIAL_CASE_MISSING");
    });
  }
});

describe("评测套件：覆盖实体文档 §12、grader 对样例判 pass 且不空转", () => {
  for (const id of ALL_IDS) {
    it(`${id}: 套件覆盖 §12 的全部 case id、含 permission-denial 与 prompt-injection`, () => {
      const dir = resolve(REPO, "evals/work-stack", id);
      const docDir = resolve(REPO, "requirements/work-stack-v2/skills");
      const doc = readFileSync(join(docDir, readdirSync(docDir).find((n) => n.startsWith(`${id}-`))!), "utf8");
      const section = doc.slice(doc.indexOf("## 12. 评测"), doc.indexOf("## 13."));
      const specIds = [...section.matchAll(/^\|\s*(E\d+[a-z]?)\s*\|/gm)].map((m) => m[1]!);
      expect(specIds.length).toBeGreaterThanOrEqual(8);
      const cases = readFileSync(join(dir, "cases.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { id: string; tags: string[]; fixtureRefs: string[] });
      const have = new Set(cases.map((c) => c.id));
      for (const specId of specIds) expect(have.has(specId), `${id} 缺 ${specId}`).toBe(true);
      const tags = new Set(cases.flatMap((c) => c.tags));
      expect(tags.has("permission-denial")).toBe(true);
      expect(tags.has("prompt-injection")).toBe(true);
      const suite = JSON.parse(readFileSync(join(dir, "suite.json"), "utf8")) as { mustPassCaseIds: string[] };
      for (const m of suite.mustPassCaseIds) expect(have.has(m)).toBe(true);
      for (const c of cases) for (const f of c.fixtureRefs) expect(existsSync(join(dir, "fixtures", f)), f).toBe(true);
    });

    it(`${id}: grader 对每个 case 的 outputSample（或错误码）判 pass；对空输出不空转`, async () => {
      const dir = resolve(REPO, "evals/work-stack", id);
      const grader = (await import(join(dir, "grader.ts"))) as { grade: (a: unknown[], o: unknown) => { outcome: string; reason: string | null } };
      const cases = readFileSync(join(dir, "cases.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { id: string; expect: { assertions: { kind: string; spec: unknown }[]; outputSample?: unknown } });
      let failsOnEmpty = 0;
      for (const c of cases) {
        const code = c.expect.assertions.find((a) => a.kind === "errorCode")?.spec;
        const output = c.expect.outputSample ?? (code ? { error: { code } } : undefined);
        expect(output, `${id} ${c.id} 需要 outputSample 或 errorCode 断言`).toBeDefined();
        const r = grader.grade(c.expect.assertions, output);
        expect(r.outcome, `${id} ${c.id}: ${r.reason}`).toBe("pass");
        if (grader.grade(c.expect.assertions, {}).outcome === "fail") failsOnEmpty += 1;
      }
      // 至少大多数 case 的断言对空输出不成立（断言不是空壳）。
      expect(failsOnEmpty).toBeGreaterThanOrEqual(Math.ceil(cases.length * 0.75));
    });
  }
});
