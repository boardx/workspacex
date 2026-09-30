/**
 * executive-skill-pack-build.test.ts —— 高管线 Skill 包构建（work-executive starter-pack） 的 starter-pack 构建（镜像 research-skill-pack-build.test.ts）。
 *
 * 断言：覆盖集合恰为 S195–S199 与 S013；每个文件 digest = sha256；重复构建 digest 不变；
 * 篡改任一 SKILL.md 后整包拒绝并指名文件；已提交的 skills/starter-packs/work-executive/1.0.0.json 与源逐字节一致
 * （源变了必须重跑构建脚本）；导入侧 checkWorkSkillManifests（WS02：manifest 合法 + 依赖分类已登记）通过。
 * 不连接数据库（DB 侧导入由 starter-packs-live-stack.test.ts 覆盖，本机无 DB 时未运行）。
 */
import { describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  buildWorkExecutivePack,
  checkCommittedPack,
  DEFAULT_ROOT,
  EXPECTED_STABLE_IDS,
  PACK_ID,
  PACK_VERSION,
  specFor,
  WorkContentPackBuildError,
} from "../../scripts/build-work-executive-skill-pack";
import { checkWorkSkillManifests } from "../../src/domain/skill/work-skill-import-check";

const LIST = resolve(__dirname, "../../../../requirements/work-stack-v2/WORK-STACK-320-LIST.md");
import { buildWorkContentPack } from "../../scripts/work-content-pack";
import { PENDING_REVIEW_IDS } from "../../scripts/build-work-executive-skill-pack";

const EXPECTED = ["S195", "S196", "S197", "S198", "S199", "S013"];
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function copyRootToTemp(): string {
  const dir = mkdtempSync(join(tmpdir(), "work-executive-pack-"));
  cpSync(DEFAULT_ROOT, dir, { recursive: true });
  return dir;
}

function issuesOf(fn: () => unknown): WorkContentPackBuildError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(WorkContentPackBuildError);
    return error as WorkContentPackBuildError;
  }
  throw new Error("expected the build to be rejected");
}

describe("高管线 Skill 包构建（work-executive starter-pack）", () => {
  it("覆盖集合恰为 S195–S199 与 S013，v2 ID 齐全且不重复", () => {
    const pack = buildWorkExecutivePack();
    expect(pack.packId).toBe(PACK_ID);
    expect(pack.packVersion).toBe(PACK_VERSION);
    expect(pack.skills.map((s) => s.name).sort()).toEqual([...EXPECTED].sort());
    expect([...EXPECTED_STABLE_IDS].sort()).toEqual([...EXPECTED].sort());
  });

  it("每个文件的 digest 都是其字节的 sha256；每个 skill 恰一个根 SKILL.md", () => {
    for (const skill of buildWorkExecutivePack().skills) {
      for (const file of skill.files) expect(file.digest).toBe(sha256(Buffer.from(file.contentBase64, "base64")));
      expect(skill.files.filter((f) => f.path === "SKILL.md")).toHaveLength(1);
    }
  });

  it("同一份源两次构建，packDigest 不变（可重复构建）", () => {
    expect(buildWorkExecutivePack().packDigest).toBe(buildWorkExecutivePack().packDigest);
  });

  it("已提交的 pack JSON 与源重建结果逐字节一致（源变了必须重跑构建脚本）", () => {
    expect(checkCommittedPack(specFor())).toEqual([]);
  });

  it("导入侧校验：manifest 合法、依赖分类全部已登记、provenance 完整（WS02 E6/E8）", () => {
    const check = checkWorkSkillManifests(buildWorkExecutivePack());
    expect(check.kind === "rejected" ? check.issues : []).toEqual([]);
    expect(check.kind).toBe("ok");
  });

  it("每个 SKILL.md 都带内联的、可编译的 input/outputSchema（不是只有 $ref 的占位）", () => {
    const check = checkWorkSkillManifests(buildWorkExecutivePack());
    if (check.kind !== "ok") throw new Error("import check failed");
    for (const [, manifest] of check.manifests) {
      for (const schema of [manifest.inputSchema, manifest.outputSchema]) {
        expect(JSON.stringify(schema)).not.toContain("$ref");
        expect(Object.keys(schema).length).toBeGreaterThan(0);
      }
    }
  });

  it("篡改任一 SKILL.md（stableId 格式坏掉）后拒绝整包并指名该文件", () => {
    const root = copyRootToTemp();
    try {
      const target = resolve(root, "strategy-review", "SKILL.md");
      const original = readFileSync(target, "utf8");
      const tampered = original.replace("stableId: S195", "stableId: NOT-A-VALID-ID");
      expect(tampered).not.toBe(original);
      writeFileSync(target, tampered);
      const build = issuesOf(() => buildWorkExecutivePack(root));
      expect(build.issues.some((i) => i.file === "strategy-review/SKILL.md" && i.fieldPath.includes("stableId"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("删掉一个 skill 的 metadata.work（普通化）后拒绝整包——覆盖集合缺一不可", () => {
    const root = copyRootToTemp();
    try {
      const target = resolve(root, "strategy-review", "SKILL.md");
      const original = readFileSync(target, "utf8");
      const start = original.indexOf("\nmetadata:\n");
      const end = original.indexOf("\n---\n", start);
      expect(start).toBeGreaterThan(-1);
      writeFileSync(target, original.slice(0, start) + original.slice(end));
      const build = issuesOf(() => buildWorkExecutivePack(root));
      expect(build.issues.some((i) => i.file === "strategy-review/SKILL.md")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("S195–S199 仍在清单里标为 ⬜（未评审）：豁免名单只能是这五个；清单一旦标 ✅，构建必须要求删掉豁免", () => {
    const text = readFileSync(LIST, "utf8");
    for (const id of PENDING_REVIEW_IDS) expect(text).toMatch(new RegExp(`\\|\\s*⬜\\s*\\|\\s*${id}\\s*\\|`));
    expect([...PENDING_REVIEW_IDS]).toEqual(["S195", "S196", "S197", "S198", "S199"]);
    // 把 S195 改成 ✅ 的清单副本：构建报 pending-review-stale，而不是悄悄放行。
    const dir = mkdtempSync(join(tmpdir(), "exec-list-"));
    try {
      const list = join(dir, "list.md");
      writeFileSync(list, text.replace(/\|\s*⬜\s*\|\s*S195\s*\|/, "| ✅ 通过 | S195 |"));
      const build = issuesOf(() => buildWorkContentPack({ ...specFor(), entityListPath: list }));
      expect(build.issues.some((i) => i.fieldPath === "pendingReviewIds" && i.message.includes("pending-review-stale") && i.message.includes("S195"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("不在豁免名单、也不是 ✅ 的实体仍被拒绝（豁免不是通配）", () => {
    const build = issuesOf(() => buildWorkContentPack({ ...specFor(), pendingReviewIds: ["S195", "S196", "S197", "S198"] }));
    expect(build.issues.some((i) => i.file === "business-model-analysis/SKILL.md" && i.message.includes("S199"))).toBe(true);
  });
});
